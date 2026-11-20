-- 075_backfill_ad_network.sql
-- Conversas `ad` criadas antes da migracao 073 nao tinham a chave `network`
-- no source_meta (o codigo antigo so detectava Meta CTWA e gravava
-- detected_via='padrao_ctwa'). Sem o backfill, o filtro "Meta Ads" do chat
-- nao encontrava esse historico.
--
-- So preenche onde nao ha rede e nao ha indicio de Google (UTM/gclid), para
-- nao classificar erroneamente um anuncio do Google como Meta.

update public.conversations
   set source_meta = coalesce(source_meta, '{}'::jsonb) || jsonb_build_object(
         'network', 'meta',
         'network_raw', coalesce(source_meta->>'network_raw', source_meta->>'cta_source_url')
       )
 where source = 'ad'
   and coalesce(source_meta->>'network', '') = ''
   and lower(coalesce(source_meta->>'utm_source', '')) not like '%google%'
   and source_meta->>'gclid' is null
   and (
     source_meta->>'detected_via' in ('padrao_ctwa', 'meta_attribution')
     or coalesce(source_meta->>'cta_source_url', '') ~ '(facebook|instagram|fb\\.com|ig\\.com)'
     or source_meta->>'detected_via' is null
   );

comment on column public.conversations.source_meta is
  'Atribuicao de origem: ad_id, click_id, network (meta|google), network_raw, cta_source_url, detected_via (meta_attribution|google_attribution|padrao_ctwa|padrao_ctwa_meta|padrao_ctwa_google|utm), utm_*. Historico legado padrao_ctwa recebeu network=meta na migration 075.';
