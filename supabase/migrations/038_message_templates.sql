-- 038_message_templates.sql
-- Templates de resposta pronta usados no chat (disparo manual pelo vendedor).
-- Leitura: toda a equipe. Escrita: admin (mesmo padrão de tags).
-- Placeholders suportados no corpo: {{nome}} (nome do contato).

create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null unique,
  body        text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.message_templates enable row level security;

drop policy if exists "message_templates_select" on public.message_templates;
create policy "message_templates_select" on public.message_templates
  for select to authenticated using (true);

drop policy if exists "message_templates_insert_admin" on public.message_templates;
create policy "message_templates_insert_admin" on public.message_templates
  for insert to authenticated with check (public.is_admin());

drop policy if exists "message_templates_update_admin" on public.message_templates;
create policy "message_templates_update_admin" on public.message_templates
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "message_templates_delete_admin" on public.message_templates;
create policy "message_templates_delete_admin" on public.message_templates
  for delete to authenticated using (public.is_admin());

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

create index if not exists message_templates_is_active_idx
  on public.message_templates (is_active);

-- Seed: exemplos iniciais (podem ser editados/desativados pelo admin).
insert into public.message_templates (title, body) values
  ('Saudação', 'Olá {{nome}}! Tudo bem? Como posso ajudar?'),
  ('Orçamento', '{{nome}}, vou verificar o orçamento e já te retorno por aqui.'),
  ('Follow-up', 'Oi {{nome}}! Conseguiu avaliar nossa proposta? Fico à disposição.')
on conflict (title) do nothing;
