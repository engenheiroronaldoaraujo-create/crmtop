-- 040_merge_lid_duplicates.sql
-- Unifica contatos LID órfãos (sem telefone) com o contato por telefone da
-- mesma pessoa, usando os pares remoteJid(LID)→remoteJidAlt(telefone) que o
-- webhook registrou em webhook_lid_log. Depois move mensagens/conversas com
-- dedup por evolution_message_id e remove a tabela de diagnóstico temporária.

do $$
declare
  p record;
  lid_contact bigint;
  phone_contact bigint;
  lidc uuid;
  phonc uuid;
  cv record;
  tgt uuid;
begin
  for p in
    select distinct
      split_part(key->>'remoteJid', '@', 1) as lid_digits,
      split_part(key->>'remoteJidAlt', '@', 1) as phone_digits
    from public.webhook_lid_log
    where key->>'remoteJid' like '%@lid'
      and key->>'remoteJidAlt' like '%@s.whatsapp.net'
      and coalesce(key->>'fromMe', 'false') = 'false'
  loop
    begin
      select id into lidc
      from public.contacts
      where lid = 'lid:' || p.lid_digits
        and (phone is null or phone = '')
      limit 1;

      select id into phonc
      from public.contacts
      where phone = p.phone_digits
      limit 1;

      if lidc is null or phonc is null or lidc = phonc then
        continue;
      end if;

      raise notice 'MERGE lid:% -> phone:%', p.lid_digits, p.phone_digits;

      for cv in select c.id, c.instance_id from public.conversations c where c.contact_id = lidc loop
        select c2.id into tgt
        from public.conversations c2
        where c2.contact_id = phonc and c2.instance_id = cv.instance_id
        order by c2.last_message_at desc nulls last
        limit 1;

        if tgt is null then
          -- Sem conversa alvo: a conversa do LID passa a pertencer ao contato
          -- com telefone (mantém id — mensagens não precisam se mover).
          update public.conversations set contact_id = phonc where id = cv.id;
        else
          -- Move o que não duplica; descarta duplicatas exatas.
          delete from public.messages m
          where m.conversation_id = cv.id
            and m.evolution_message_id is not null
            and exists (
              select 1 from public.messages t
              where t.conversation_id = tgt
                and t.evolution_message_id = m.evolution_message_id
            );
          update public.messages set conversation_id = tgt where conversation_id = cv.id;
          delete from public.sdr_conversations where conversation_id = cv.id;
          update public.opportunities set conversation_id = tgt where conversation_id = cv.id;
          delete from public.conversations where id = cv.id;

          update public.conversations c
          set last_message_at = agg.mx,
              last_message_preview = coalesce(agg.pv, c.last_message_preview)
          from (
            select max(sent_at) as mx,
                   (array_agg(content order by sent_at desc))[1] as pv
            from public.messages where conversation_id = tgt
          ) agg
          where c.id = tgt;
        end if;
      end loop;

      -- Enriquece o contato com telefone e remove o órfão.
      update public.contacts
      set lid = coalesce(lid, 'lid:' || p.lid_digits),
          jid = coalesce(jid, (select jid from public.contacts where id = lidc)),
          name = coalesce(name, (select name from public.contacts where id = lidc))
      where id = phonc;

      insert into public.contact_tags (contact_id, tag_id)
      select phonc, tag_id from public.contact_tags where contact_id = lidc
      on conflict (contact_id, tag_id) do nothing;
      delete from public.contact_tags where contact_id = lidc;

      update public.opportunities set contact_id = phonc where contact_id = lidc;
      update public.meetings set contact_id = phonc where contact_id = lidc;
      update public.opportunity_tasks set contact_id = phonc where contact_id = lidc;
      update public.sdr_conversations set contact_id = phonc where contact_id = lidc;
      update public.conversations set contact_id = phonc where contact_id = lidc;
      delete from public.contacts where id = lidc;
    exception when others then
      raise notice 'MERGE lid:% ignorado: %', p.lid_digits, sqlerrm;
    end;
  end loop;
end $$;

-- Fim da fase de diagnóstico LID: remove a tabela temporária da migration 025.
drop table if exists public.webhook_lid_log;
