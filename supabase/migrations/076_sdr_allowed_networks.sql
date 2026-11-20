-- 076_sdr_allowed_networks.sql
-- Alinha as "Origens que o SDR responde" com os filtros do Chat:
-- o chat filtra Anuncios por rede (Google Ads / Meta Ads) via
-- source_meta->>'network'; o SDR agora pode fazer o mesmo.
--
-- `allowed_sources` continua controlando source='ad' (Todos os anuncios) e
-- `allowed_networks` filtra dentro dele. Conversa sem rede (legado) é
-- tratada como 'meta' — unico suporte existente antes da migracao 073.

alter table public.sdr_settings
  add column if not exists allowed_networks text[] not null default array['google', 'meta'];

comment on column public.sdr_settings.allowed_networks is
  'Redes de anuncio que o SDR responde quando allowed_sources inclui ad: google | meta. Vazio = nenhuma rede de anuncio.';

-- Instalacoes que restringiram apenas a anuncios continuam restritas a
-- anuncios; as redes padrao sao as duas.
update public.sdr_settings
   set allowed_networks = array['google', 'meta']
 where allowed_networks is null;
