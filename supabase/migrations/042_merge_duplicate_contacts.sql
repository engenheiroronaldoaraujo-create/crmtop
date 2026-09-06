-- 042_merge_duplicate_contacts.sql
-- Limpeza da duplicação pós-reconexão (set/2026):
--
-- 1. Contatos duplicados (mesma pessoa = contato por telefone + contato só-LID
--    "Contato ••XXXX"). Após reconectar, a Baileys passou a identificar chats
--    por LID; o webhook criou um 2º contato e a reconciliação reimportou o
--    histórico nele. Prova de "mesma pessoa": conversas distintas contendo a
--    mesma mensagem (evolution_message_id). Fundimos o contato LID no contato
--    com telefone, movemos conversas/mensagens com dedup e registramos LIDs
--    alternativos no lid_phone_cache.
-- 2. Respostas do SDR duplicadas: callSDREngine gravava a resposta sem
--    evolution_message_id e o eco do webhook gravava outra com o ID real.
--    Removemos as linhas-fantasma (sem ID) que têm gêmea com ID real, e os
--    retratos gerados por retry do webhook (duas linhas sem ID).
-- 3. Conversas residuais duplicadas para o mesmo contato/instância (corrida
--    de upsert).
--
-- A fusão roda em passes iterativos (fundir um par pode expor o próximo,
-- cadeias A↔B↔C) e os pares são processados dinamicamente: a existência das
-- duas pontas é revalidada a cada movimento, e o webhook segue AO VIVO
-- inserindo mensagens durante a operação — toda exclusão de conversa é
-- precedida de limpeza das sobras.

do $$
declare
  v_changed integer := 0;
  v_pass integer := 0;
  v_keeper uuid;
  v_keeper_lid text;
  v_phone_keeper text;
  v_x record;
  v_inst uuid;
  v_try integer;
begin
  -- Serializa contra o tráfego ao vivo (webhook/automation-engine): sem
  -- locks de tabela, a migração longa compete por linhas em ordem diferente
  -- e o Postgres aborta por deadlock. Escritas concorrentes ficam na fila
  -- até o commit (webhook cobre retries com o dedup por evolution_message_id).
  lock table
    public.contacts,
    public.conversations,
    public.messages,
    public.opportunities,
    public.sdr_conversations,
    public.deal_insights,
    public.contact_tags,
    public.meetings,
    public.opportunity_tasks,
    public.lid_phone_cache
    in share row exclusive mode;

  loop
    v_pass := v_pass + 1;
    exit when v_pass > 5;

    -- ---------------------------------------------------------------
    -- 1) Componentes conexos de conversas que compartilham mensagens
    -- ---------------------------------------------------------------
    drop table if exists dup_e;
    create temp table dup_e on commit drop as
      select distinct a.conversation_id as a, b.conversation_id as b
      from public.messages a
      join public.messages b
        on a.evolution_message_id = b.evolution_message_id
       and a.conversation_id < b.conversation_id
      where a.evolution_message_id is not null;

    exit when not exists (select 1 from dup_e);

    drop table if exists dup_ebi;
    create temp table dup_ebi on commit drop as
      select a, b from dup_e
      union
      select b, a from dup_e;

    drop table if exists dup_c;
    create temp table dup_c on commit drop as
      select s.node, s.node as label
      from (
        select a as node from dup_ebi
        union
        select b as node from dup_ebi
      ) s;

    loop
      update dup_c c
      set label = least(c.label, m.mn)
      from (
        select z.node, min(z.label::text)::uuid as mn
        from (
          select e.b as node, c.label as label
          from dup_ebi e
          join dup_c c on c.node = e.a
          union all
          select node, label from dup_c
        ) z
        group by z.node
      ) m
      where c.node = m.node and c.label > m.mn;
      get diagnostics v_changed = row_count;
      exit when v_changed = 0;
    end loop;

    -- -------------------------------------------------------------
    -- 2) Contato "mantido" por componente (telefone > nome real > msgs)
    -- -------------------------------------------------------------
    drop table if exists dup_keep;
    create temp table dup_keep on commit drop as
      select distinct on (dc.label)
        dc.label as comp,
        cv.contact_id
      from dup_c dc
      join public.conversations cv on cv.id = dc.node
      join public.contacts ct on ct.id = cv.contact_id
      left join lateral (
        select count(*) as n
        from public.conversations c2
        join public.messages m on m.conversation_id = c2.id
        where c2.contact_id = cv.contact_id
      ) s on true
      order by
        dc.label,
        (ct.phone is not null) desc,
        (ct.name is not null and ct.name !~ '^[0-9]+$' and ct.name not like 'lid:%') desc,
        s.n desc,
        cv.contact_id;

    -- -------------------------------------------------------------
    -- 3) Funde cada contato não-mantido no mantido (atributos/referenciais;
    --    conversas nos passos 4/5, exclusão do contato no 5b)
    -- -------------------------------------------------------------
    drop table if exists merges_todo;
    create temp table merges_todo on commit drop as
      select null::uuid as keeper, null::uuid as dup where false;

    for v_x in
      select distinct
        k.contact_id as keeper_id,
        cv.contact_id as dup_id,
        ct.lid,
        ct.name,
        ct.push_name,
        ct.jid
      from dup_c dc
      join public.conversations cv on cv.id = dc.node
      join dup_keep k on k.comp = dc.label
      join public.contacts ct on ct.id = cv.contact_id
      where cv.contact_id <> k.contact_id
    loop
      v_keeper := v_x.keeper_id;
      if not exists (select 1 from public.contacts where id = v_keeper) then
        continue; -- mantido já fundido em passe anterior
      end if;
      if not exists (select 1 from public.contacts where id = v_x.dup_id) then
        continue; -- fundido já absorvido em passe anterior
      end if;

      select lid, phone into v_keeper_lid, v_phone_keeper
      from public.contacts where id = v_keeper;

      -- LID: transfere para o mantido ou registra o mapeamento no cache
      if v_x.lid is not null then
        if v_keeper_lid is null then
          begin
            update public.contacts set lid = v_x.lid where id = v_keeper;
            v_keeper_lid := v_x.lid;
          exception
            when unique_violation then
              -- outro contato vivo já detém esse LID; preserva o mapeamento
              -- no cache para as próximas resoluções
              raise notice 'LID_TRANSFER_CONFLICT dup=% lid=% keeper=%',
                v_x.dup_id, v_x.lid, v_keeper;
              insert into public.lid_phone_cache (lid, phone, resolved_at, last_attempt_at, updated_at)
              values (v_x.lid, v_phone_keeper, now(), now(), now())
              on conflict (lid) do update
                set phone = coalesce(excluded.phone, lid_phone_cache.phone),
                    resolved_at = now(),
                    updated_at = now();
          end;
        elsif v_x.lid <> v_keeper_lid then
          insert into public.lid_phone_cache (lid, phone, resolved_at, last_attempt_at, updated_at)
          values (v_x.lid, v_phone_keeper, now(), now(), now())
          on conflict (lid) do update
            set phone = coalesce(excluded.phone, lid_phone_cache.phone),
                resolved_at = now(),
                updated_at = now();
        end if;
      end if;

      -- referenciais do contato fundido
      delete from public.contact_tags t
      using public.contact_tags k
      where k.contact_id = v_keeper
        and t.contact_id = v_x.dup_id
        and t.tag_id = k.tag_id;
      update public.contact_tags set contact_id = v_keeper where contact_id = v_x.dup_id;
      update public.opportunities set contact_id = v_keeper where contact_id = v_x.dup_id;
      update public.meetings set contact_id = v_keeper where contact_id = v_x.dup_id;
      update public.opportunity_tasks set contact_id = v_keeper where contact_id = v_x.dup_id;
      update public.sdr_conversations set contact_id = v_keeper where contact_id = v_x.dup_id;
      update public.deal_insights set contact_id = v_keeper where contact_id = v_x.dup_id;

      -- enriquece o mantido com nome/jid do fundido
      update public.contacts k
      set name = case
            when k.name is not null and k.name <> ''
                 and k.name !~ '^[0-9]+$' and k.name not like 'lid:%'
              then k.name
            else coalesce(nullif(v_x.name, ''), k.name)
          end,
          push_name = case
            when k.push_name is not null and k.push_name <> ''
                 and k.push_name !~ '^[0-9]+$'
              then k.push_name
            else coalesce(nullif(v_x.push_name, ''), k.push_name)
          end,
          jid = coalesce(k.jid, v_x.jid)
      where k.id = v_keeper;

      insert into merges_todo (keeper, dup) values (v_keeper, v_x.dup_id);
    end loop;

    -- -------------------------------------------------------------
    -- 4) Pares de conversas do componente: conversa do fundido → do mantido.
    --    Cadeias (conversa destino de um par e origem de outro) exigem
    --    revalidar as pontas a cada movimento; pares cujo destino já foi
    --    movido ficam para o passe seguinte (passo 5 reassocia a órfã).
    -- -------------------------------------------------------------
    drop table if exists merge_pairs;
    create temp table merge_pairs on commit drop as
      select distinct on (cx.id)
        cx.id as src, ck.id as tgt
      from dup_c dc
      join public.conversations cx on cx.id = dc.node
      join dup_keep k on k.comp = dc.label
      join public.conversations ck
        on ck.contact_id = k.contact_id
       and ck.instance_id is not distinct from cx.instance_id
      order by cx.id, ck.last_message_at desc nulls last;

    loop
      select p.src, p.tgt into v_x
      from merge_pairs p
      where exists (select 1 from public.conversations where id = p.src)
        and exists (select 1 from public.conversations where id = p.tgt)
      order by
        exists (select 1 from merge_pairs q where q.tgt = p.src) desc,
        p.src
      limit 1;
      exit when not found;
      delete from merge_pairs where src = v_x.src and tgt = v_x.tgt;

      delete from public.deal_insights di
      using public.deal_insights dk
      where dk.conversation_id = v_x.tgt and di.conversation_id = v_x.src;
      update public.deal_insights set conversation_id = v_x.tgt where conversation_id = v_x.src;

      delete from public.messages m
      where m.conversation_id = v_x.src
        and m.evolution_message_id is not null
        and exists (
          select 1 from public.messages t
          where t.conversation_id = v_x.tgt
            and t.evolution_message_id = m.evolution_message_id
        );

      if exists (select 1 from public.sdr_conversations where conversation_id = v_x.tgt) then
        delete from public.sdr_conversations where conversation_id = v_x.src;
      else
        update public.sdr_conversations set conversation_id = v_x.tgt where conversation_id = v_x.src;
      end if;

      update public.opportunities set conversation_id = v_x.tgt where conversation_id = v_x.src;
      update public.messages set conversation_id = v_x.tgt where conversation_id = v_x.src;
      begin
        delete from public.conversations where id = v_x.src;
      exception
        when foreign_key_violation then
          -- tráfego ao vivo (webhook/automation-engine) inseriu referências
          -- entre o movimento e o delete: reexecuta os movimentos e tenta de novo
          raise notice 'CONV_DELETE_RETRY src=% tgt=%', v_x.src, v_x.tgt;
          update public.opportunities set conversation_id = v_x.tgt where conversation_id = v_x.src;
          update public.opportunities set conversation_id = null where conversation_id = v_x.src;
          if exists (select 1 from public.sdr_conversations where conversation_id = v_x.tgt) then
            delete from public.sdr_conversations where conversation_id = v_x.src;
          else
            update public.sdr_conversations set conversation_id = v_x.tgt where conversation_id = v_x.src;
          end if;
          delete from public.messages where conversation_id = v_x.src;
          delete from public.conversations where id = v_x.src;
      end;

      update public.conversations c
      set last_message_at = agg.mx,
          last_message_preview = coalesce(agg.pv, c.last_message_preview)
      from (
        select max(sent_at) as mx,
               (array_agg(coalesce(content, '[' || type || ']') order by sent_at desc))[1] as pv
        from public.messages where conversation_id = v_x.tgt
      ) agg
      where c.id = v_x.tgt;
    end loop;

    -- -------------------------------------------------------------
    -- 5) Conversas restantes do contato fundido sem alvo na instância
    --    (também resgata órfãs cujo destino foi movido no passo 4)
    -- -------------------------------------------------------------
    update public.conversations c
    set contact_id = k.contact_id
    from dup_c dc
    join dup_keep k on k.comp = dc.label
    where c.id = dc.node
      and c.contact_id <> k.contact_id
      and exists (select 1 from public.contacts where id = k.contact_id);

    -- -------------------------------------------------------------
    -- 5b) Exclui os contatos fundidos (conversas já movidas/reassociadas)
    -- -------------------------------------------------------------
    for v_x in select keeper, dup from merges_todo loop
      if not exists (select 1 from public.contacts where id = v_x.dup) then
        continue; -- já absorvido
      end if;
      if not exists (select 1 from public.contacts where id = v_x.keeper) then
        -- mantido sumiu (fundido em outro passe): assume as conversas dele
        update public.conversations c
        set contact_id = v_x.dup
        where c.contact_id = v_x.keeper
          and not exists (
            select 1 from public.conversations c2
            where c2.contact_id = v_x.dup
              and c2.instance_id is not distinct from c.instance_id
          );
        update public.conversations set contact_id = v_x.dup where contact_id = v_x.keeper;
        v_keeper := v_x.dup;
      else
        v_keeper := v_x.keeper;
      end if;
      -- sobras de conversas (edge/tráfego ao vivo): reassocia e confirma
      for v_try in 1..3 loop
        update public.conversations set contact_id = v_keeper where contact_id = v_x.dup;
        exit when not exists (
          select 1 from public.conversations where contact_id = v_x.dup
        );
      end loop;
      begin
        delete from public.contacts where id = v_x.dup;
      exception
        when foreign_key_violation then
          -- o webhook criou conversa para o contato fundido no meio da operação
          raise notice 'CONTACT_DELETE_RETRY dup=%', v_x.dup;
          update public.conversations set contact_id = v_keeper where contact_id = v_x.dup;
          delete from public.contacts where id = v_x.dup;
      end;
    end loop;

    -- -------------------------------------------------------------
    -- 6) Duplicatas residuais (mesmo contato + instância, corrida de upsert)
    -- -------------------------------------------------------------
    loop
      select least(c1.id, c2.id) as src, greatest(c1.id, c2.id) as tgt into v_x
      from public.conversations c1
      join public.conversations c2
        on c1.contact_id = c2.contact_id
       and c1.instance_id is not distinct from c2.instance_id
       and c1.id < c2.id
      limit 1;
      exit when not found;

      delete from public.deal_insights di
      using public.deal_insights dk
      where dk.conversation_id = v_x.tgt and di.conversation_id = v_x.src;
      update public.deal_insights set conversation_id = v_x.tgt where conversation_id = v_x.src;

      delete from public.messages m
      where m.conversation_id = v_x.src
        and m.evolution_message_id is not null
        and exists (
          select 1 from public.messages t
          where t.conversation_id = v_x.tgt
            and t.evolution_message_id = m.evolution_message_id
        );

      if exists (select 1 from public.sdr_conversations where conversation_id = v_x.tgt) then
        delete from public.sdr_conversations where conversation_id = v_x.src;
      else
        update public.sdr_conversations set conversation_id = v_x.tgt where conversation_id = v_x.src;
      end if;

      update public.opportunities set conversation_id = v_x.tgt where conversation_id = v_x.src;
      update public.messages set conversation_id = v_x.tgt where conversation_id = v_x.src;
      begin
        delete from public.conversations where id = v_x.src;
      exception
        when foreign_key_violation then
          -- tráfego ao vivo: reexecuta os movimentos e tenta de novo
          raise notice 'CONV_DELETE_RETRY2 src=% tgt=%', v_x.src, v_x.tgt;
          update public.opportunities set conversation_id = v_x.tgt where conversation_id = v_x.src;
          update public.opportunities set conversation_id = null where conversation_id = v_x.src;
          if exists (select 1 from public.sdr_conversations where conversation_id = v_x.tgt) then
            delete from public.sdr_conversations where conversation_id = v_x.src;
          else
            update public.sdr_conversations set conversation_id = v_x.tgt where conversation_id = v_x.src;
          end if;
          delete from public.messages where conversation_id = v_x.src;
          delete from public.conversations where id = v_x.src;
      end;

      update public.conversations c
      set last_message_at = agg.mx,
          last_message_preview = coalesce(agg.pv, c.last_message_preview)
      from (
        select max(sent_at) as mx,
               (array_agg(coalesce(content, '[' || type || ']') order by sent_at desc))[1] as pv
        from public.messages where conversation_id = v_x.tgt
      ) agg
      where c.id = v_x.tgt;
    end loop;

    -- Mais pares provados por mensagem compartilhada? Repete o passe.
    select count(*) into v_changed
    from public.messages a
    join public.messages b
      on a.evolution_message_id = b.evolution_message_id
     and a.conversation_id < b.conversation_id
    where a.evolution_message_id is not null;
    exit when v_changed = 0;
  end loop;

  -- =====================================================================
  -- 7) Respostas do SDR duplicadas
  -- =====================================================================
  -- a) linha sem ID (gravada antes do envio) com gêmea que tem ID real (eco)
  delete from public.messages a
  using public.messages b
  where a.evolution_message_id is null
    and b.evolution_message_id is not null
    and a.conversation_id = b.conversation_id
    and a.direction = b.direction
    and a.content = b.content
    and a.content is not null
    and a.sender_profile_id is null
    and a.id <> b.id
    and abs(extract(epoch from (a.sent_at - b.sent_at))) < 600;

  -- b) retrato por retry do webhook (duas linhas sem ID, mesmo texto)
  delete from public.messages a
  using public.messages b
  where a.evolution_message_id is null
    and b.evolution_message_id is null
    and a.conversation_id = b.conversation_id
    and a.direction = b.direction
    and a.content = b.content
    and a.content is not null
    and a.sender_profile_id is null
    and (a.sent_at, a.id) > (b.sent_at, b.id)
    and abs(extract(epoch from (a.sent_at - b.sent_at))) < 600;

  -- =====================================================================
  -- 8) Recalcula previews/última mensagem de todas as conversas
  -- =====================================================================
  for v_inst in select distinct instance_id from public.conversations loop
    perform public.refresh_conversation_previews(v_inst);
  end loop;
end $$;
