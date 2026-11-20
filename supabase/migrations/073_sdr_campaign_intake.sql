-- 073_sdr_campaign_intake.sql
-- SDR autônomo para leads de anúncio (Google/Meta) e landing.
--
-- 1. Ativação automática: o webhook chama `sdr_auto_activate` quando a
--    conversa é 'ad'/'landing' e ainda não existe linha em sdr_conversations.
--    Linha existente = decisão humana (pausa/transferência) preservada.
-- 2. Atribuição mesclável: índice em (source, created_at) para a visão de
--    leads de campanha e comentário documentando os campos de source_meta.
-- 3. Defaults de fábrica: SDR ligado e fora do modo teste em instalações
--    novas. Em instalações existentes, só é tocado o estado ainda de fábrica
--    (enabled=false + test_mode=true) — se você desligou de propósito,
--    reative manualmente em Configurações → SDR IA.

-- ---------------------------------------------------------------------------
-- 1. RPC de ativação atômica
-- ---------------------------------------------------------------------------

create or replace function public.sdr_auto_activate(p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_contact_id uuid;
  v_rows int;
begin
  select c.source, c.contact_id
    into v_source, v_contact_id
    from public.conversations c
   where c.id = p_conversation_id;

  if v_contact_id is null then
    return 'no_conversation';
  end if;

  if v_source not in ('ad', 'landing') then
    return 'source_not_eligible';
  end if;

  insert into public.sdr_conversations (conversation_id, contact_id, status)
  values (p_conversation_id, v_contact_id, 'active')
  on conflict (conversation_id) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return 'activated';
  end if;
  return 'existing_preserved';
end $$;

revoke execute on function public.sdr_auto_activate(uuid) from public;
grant execute on function public.sdr_auto_activate(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Atribuição de campanha
-- ---------------------------------------------------------------------------

create index if not exists conversations_source_created_idx
  on public.conversations (source, created_at desc);

comment on column public.conversations.source_meta is
  'Atribuição de origem: ad_id, click_id, network (meta|google), network_raw, cta_source_url, detected_via (meta_attribution|google_attribution|padrao_ctwa_meta|padrao_ctwa_google|utm), utm_*. Mesclada em mensagens seguintes; origem manual nunca é sobrescrita.';

-- ---------------------------------------------------------------------------
-- 3. Defaults do SDR
-- ---------------------------------------------------------------------------

alter table public.sdr_settings
  alter column enabled set default true,
  alter column test_mode set default false,
  alter column allowed_sources set default array['organic', 'ad', 'campaign', 'landing', 'manual'];

-- Somente installations que nunca saíram do estado de fábrica.
update public.sdr_settings
   set enabled = true,
       test_mode = false
 where enabled = false
   and test_mode = true;
