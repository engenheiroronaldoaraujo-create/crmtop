-- 070_tenant_columns.sql
-- Multi-tenant: workspace_id em todas as tabelas operacionais + backfill p/
-- o workspace default (00000000-0000-0000-0000-000000000001) + RLS por workspace.
-- Evolution e IA seguem centralizados (sem segredo por workspace).

-- 1. Colunas ---------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'contacts', 'conversations', 'messages', 'whatsapp_instances',
    'tags', 'contact_tags', 'opportunity_tags',
    'pipelines', 'pipeline_stages', 'opportunities', 'opportunity_tasks',
    'meetings', 'opportunity_stage_history',
    'activity_log', 'automation_rules', 'automation_executions',
    'sdr_settings', 'sdr_conversations', 'sdr_logs', 'sdr_schedule',
    'cadences', 'cadence_steps', 'cadence_enrollments', 'cadence_executions',
    'message_templates', 'business_hours', 'campaigns', 'campaign_recipients',
    'group_posts', 'group_post_engagements',
    'noreply_settings', 'noreply_attempts', 'noreply_pipeline_configs',
    'noreply_states', 'noreply_events',
    'deal_insights', 'idle_watchdog_settings', 'presentation_slots',
    'zernio_connections', 'zernio_templates', 'zernio_webhook_events',
    'audio_recordings'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass(('public.' || t)) is not null then
      execute format('alter table public.%I add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade', t);
    end if;
  end loop;
end $$;

-- Token de webhook por instância (resolve workspace sem expor segredo global).
alter table public.whatsapp_instances
  add column if not exists webhook_token text unique default encode(gen_random_bytes(24), 'hex');

-- 2. Backfill --------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'contacts', 'conversations', 'messages', 'whatsapp_instances',
    'tags', 'contact_tags', 'opportunity_tags',
    'pipelines', 'pipeline_stages', 'opportunities', 'opportunity_tasks',
    'meetings', 'opportunity_stage_history',
    'activity_log', 'automation_rules', 'automation_executions',
    'sdr_settings', 'sdr_conversations', 'sdr_logs', 'sdr_schedule',
    'cadences', 'cadence_steps', 'cadence_enrollments', 'cadence_executions',
    'message_templates', 'business_hours', 'campaigns', 'campaign_recipients',
    'group_posts', 'group_post_engagements',
    'noreply_settings', 'noreply_attempts', 'noreply_pipeline_configs',
    'noreply_states', 'noreply_events',
    'deal_insights', 'idle_watchdog_settings', 'presentation_slots',
    'zernio_connections', 'zernio_templates', 'zernio_webhook_events',
    'audio_recordings'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass(('public.' || t)) is not null then
      execute format(
        'update public.%I set workspace_id = %L where workspace_id is null',
        t, '00000000-0000-0000-0000-000000000001'
      );
    end if;
  end loop;
end $$;

-- 3. Constraints: contacts.phone/lid deixam de ser globalmente únicos --------
do $$
begin
  if to_regclass('public.contacts') is not null then
    -- Remove unique global em phone (nome varia por versão: tenta os conhecidos).
    begin
      alter table public.contacts drop constraint if exists contacts_phone_key;
    exception when others then null; end;
    -- LID unique (018) — idem.
    begin
      alter table public.contacts drop constraint if exists contacts_lid_key;
    exception when others then null; end;
    -- Recria como composto por workspace (parcial p/ lidar com nulls).
    begin
      alter table public.contacts add constraint contacts_workspace_phone_unique unique (workspace_id, phone);
    exception when duplicate_table then null; when others then null; end;
  end if;
end $$;

-- NOT NULL após backfill (idempotente, ignora se ainda houver nulos).
do $$
declare
  t text;
  tenant_tables text[] := array[
    'contacts', 'conversations', 'messages', 'whatsapp_instances',
    'tags', 'pipelines', 'pipeline_stages', 'opportunities',
    'message_templates', 'automation_rules',
    'sdr_settings', 'cadences', 'campaigns', 'group_posts',
    'noreply_settings', 'business_hours'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass(('public.' || t)) is not null then
      begin
        execute format('alter table public.%I alter column workspace_id set not null', t);
      exception when others then null; end;
    end if;
  end loop;
end $$;

create index if not exists contacts_workspace_id_idx on public.contacts (workspace_id);
create index if not exists conversations_workspace_id_idx on public.conversations (workspace_id);
create index if not exists messages_workspace_id_idx on public.messages (workspace_id);
create index if not exists opportunities_workspace_id_idx on public.opportunities (workspace_id);
create index if not exists whatsapp_instances_workspace_id_idx on public.whatsapp_instances (workspace_id);

-- 4. Trigger de compat: preenche workspace_id quando o client antigo não manda.
-- Permite o frontend legado funcionar durante a transição; o código novo deve
-- sempre enviar workspace_id explícito.
create or replace function public.set_workspace_id_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  if new.workspace_id is not null then return new; end if;
  -- Tenta herdar do pai (cada bloco ignora coluna ausente).
  begin
    if (to_jsonb(new) ? 'instance_id') and (new.instance_id is not null) then
      select workspace_id into v_ws from public.whatsapp_instances where id = new.instance_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  begin
    if (to_jsonb(new) ? 'conversation_id') and (new.conversation_id is not null) then
      select workspace_id into v_ws from public.conversations where id = new.conversation_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  begin
    if (to_jsonb(new) ? 'contact_id') and (new.contact_id is not null) then
      select workspace_id into v_ws from public.contacts where id = new.contact_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  begin
    if (to_jsonb(new) ? 'opportunity_id') and (new.opportunity_id is not null) then
      select workspace_id into v_ws from public.opportunities where id = new.opportunity_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  begin
    if (to_jsonb(new) ? 'pipeline_id') and (new.pipeline_id is not null) then
      select workspace_id into v_ws from public.pipelines where id = new.pipeline_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  begin
    if (to_jsonb(new) ? 'campaign_id') and (new.campaign_id is not null) then
      select workspace_id into v_ws from public.campaigns where id = new.campaign_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  begin
    if (to_jsonb(new) ? 'post_id') and (new.post_id is not null) then
      select workspace_id into v_ws from public.group_posts where id = new.post_id;
      if v_ws is not null then new.workspace_id := v_ws; return new; end if;
    end if;
  exception when others then null; end;
  -- Fallback: primeiro workspace do usuário, senão o default.
  select workspace_id into v_ws from public.workspace_members where user_id = auth.uid() limit 1;
  if v_ws is null then v_ws := '00000000-0000-0000-0000-000000000001'; end if;
  new.workspace_id := v_ws;
  return new;
end;
$$;

do $$
declare
  t text;
  tenant_tables text[] := array[
    'contacts', 'conversations', 'messages', 'whatsapp_instances',
    'tags', 'contact_tags', 'opportunity_tags',
    'pipelines', 'pipeline_stages', 'opportunities', 'opportunity_tasks',
    'meetings', 'opportunity_stage_history',
    'activity_log', 'automation_rules', 'automation_executions',
    'sdr_settings', 'sdr_conversations', 'sdr_logs', 'sdr_schedule',
    'cadences', 'cadence_steps', 'cadence_enrollments', 'cadence_executions',
    'message_templates', 'business_hours', 'campaigns', 'campaign_recipients',
    'group_posts', 'group_post_engagements',
    'noreply_settings', 'noreply_attempts', 'noreply_pipeline_configs',
    'noreply_states', 'noreply_events',
    'deal_insights', 'idle_watchdog_settings', 'presentation_slots',
    'zernio_connections', 'zernio_templates', 'zernio_webhook_events',
    'audio_recordings'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass(('public.' || t)) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_set_workspace', t);
      execute format(
        'create trigger %I before insert on public.%I for each row execute function public.set_workspace_id_default()',
        t || '_set_workspace', t
      );
    end if;
  end loop;
end $$;

-- 5. RLS: remove policies permissivas antigas e recria por workspace ---------
do $$
declare
  r record;
  tenant_tables text[] := array[
    'contacts', 'conversations', 'messages', 'whatsapp_instances',
    'tags', 'contact_tags', 'opportunity_tags',
    'pipelines', 'pipeline_stages', 'opportunities', 'opportunity_tasks',
    'meetings', 'opportunity_stage_history',
    'activity_log', 'automation_rules', 'automation_executions',
    'sdr_settings', 'sdr_conversations', 'sdr_logs', 'sdr_schedule',
    'cadences', 'cadence_steps', 'cadence_enrollments', 'cadence_executions',
    'message_templates', 'business_hours', 'campaigns', 'campaign_recipients',
    'group_posts', 'group_post_engagements',
    'noreply_settings', 'noreply_attempts', 'noreply_pipeline_configs',
    'noreply_states', 'noreply_events',
    'deal_insights', 'idle_watchdog_settings', 'presentation_slots',
    'zernio_connections', 'zernio_templates', 'zernio_webhook_events',
    'audio_recordings'
  ];
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename = any (tenant_tables)
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Recria padrão: SELECT/INSERT/UPDATE p/ membro; DELETE p/ workspace admin.
-- (service_role bypassa RLS — Edge Functions/cron seguem validação em app.)
do $$
declare
  t text;
  open_tables text[] := array[
    'contacts', 'conversations', 'messages',
    'opportunities', 'opportunity_tasks', 'meetings', 'opportunity_stage_history',
    'activity_log', 'automation_executions',
    'sdr_conversations', 'cadence_enrollments', 'cadence_executions',
    'group_post_engagements', 'noreply_states', 'noreply_events',
    'deal_insights', 'campaign_recipients', 'contact_tags', 'opportunity_tags'
  ];
  admin_tables text[] := array[
    'pipelines', 'pipeline_stages', 'tags', 'message_templates',
    'automation_rules', 'sdr_settings', 'sdr_schedule',
    'cadences', 'cadence_steps', 'business_hours',
    'campaigns', 'group_posts',
    'noreply_settings', 'noreply_attempts', 'noreply_pipeline_configs',
    'idle_watchdog_settings', 'presentation_slots', 'whatsapp_instances',
    'zernio_connections'
  ];
  log_tables text[] := array[
    'sdr_logs', 'zernio_templates', 'zernio_webhook_events', 'audio_recordings'
  ];
begin
  foreach t in array open_tables loop
    if to_regclass(('public.' || t)) is null then continue; end if;
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_platform_admin() or public.is_workspace_member(workspace_id))',
      t || '_ws_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_platform_admin() or public.is_workspace_member(workspace_id))',
      t || '_ws_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_platform_admin() or public.is_workspace_member(workspace_id)) with check (public.is_platform_admin() or public.is_workspace_member(workspace_id))',
      t || '_ws_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_platform_admin() or public.is_workspace_admin(workspace_id))',
      t || '_ws_delete', t);
  end loop;
  foreach t in array admin_tables loop
    if to_regclass(('public.' || t)) is null then continue; end if;
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_platform_admin() or public.is_workspace_member(workspace_id))',
      t || '_ws_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_platform_admin() or public.is_workspace_admin(workspace_id))',
      t || '_ws_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_platform_admin() or public.is_workspace_admin(workspace_id)) with check (public.is_platform_admin() or public.is_workspace_admin(workspace_id))',
      t || '_ws_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_platform_admin() or public.is_workspace_admin(workspace_id))',
      t || '_ws_delete', t);
  end loop;
  foreach t in array log_tables loop
    if to_regclass(('public.' || t)) is null then continue; end if;
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_platform_admin() or public.is_workspace_member(workspace_id))',
      t || '_ws_select', t);
  end loop;
end $$;

-- 6. profiles: team read passa a ser "mesmo workspace" (antes using(true)) --
drop policy if exists "profiles_select_team" on public.profiles;
create policy "profiles_select_team" on public.profiles
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.workspace_members m1
      join public.workspace_members m2 on m1.workspace_id = m2.workspace_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );

-- 7. Uso diário: helper de incremento (chamado pelas Edge Functions) ---------
create or replace function public.bump_workspace_usage(
  p_workspace_id uuid, p_dia date,
  p_in int default 0, p_out int default 0,
  p_transcricoes int default 0, p_tokens int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_usage_daily (workspace_id, dia, msgs_in, msgs_out, transcricoes, ai_tokens)
  values (p_workspace_id, p_dia, p_in, p_out, p_transcricoes, p_tokens)
  on conflict (workspace_id, dia) do update set
    msgs_in = workspace_usage_daily.msgs_in + excluded.msgs_in,
    msgs_out = workspace_usage_daily.msgs_out + excluded.msgs_out,
    transcricoes = workspace_usage_daily.transcricoes + excluded.transcricoes,
    ai_tokens = workspace_usage_daily.ai_tokens + excluded.ai_tokens;
end;
$$;

revoke execute on function public.bump_workspace_usage(uuid, date, int, int, int, int) from public;
grant execute on function public.bump_workspace_usage(uuid, date, int, int, int, int) to service_role;
grant execute on function public.set_workspace_id_default() to authenticated, service_role;
