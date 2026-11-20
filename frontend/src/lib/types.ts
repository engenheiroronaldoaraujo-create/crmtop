export type Profile = {
  id: string
  full_name: string | null
  role: "admin" | "vendedor"
  is_platform_admin: boolean
  avatar_url: string | null
  created_at: string
}

export type Workspace = {
  id: string
  name: string
  slug: string
  plan: "base" | "pro" | "scale"
  status: "active" | "suspended" | "cancelled"
  max_users: number
  max_instances: number
  msg_mensal: number
  ai_credits_mensal: number
  feat_sdr: boolean
  feat_transcription: boolean
  created_at: string
  updated_at: string
}

export type WorkspaceMember = {
  workspace_id: string
  user_id: string
  role: "owner" | "admin" | "vendedor"
  created_at: string
  workspace?: Workspace | null
}

export type WorkspaceInvite = {
  id: string
  workspace_id: string
  email: string
  role: "admin" | "vendedor"
  token: string
  accepted_at: string | null
  expires_at: string
  created_at: string
}

export type Contact = {
  id: string
  phone: string | null
  lid: string | null
  name: string | null
  push_name: string | null
  email: string | null
  notes: string | null
  opted_out: boolean
  source: "whatsapp" | "manual"
  jid: string | null
  business_type?: string | null
  team_size?: number | null
  extra_info?: string | null
  created_at: string
  updated_at: string
}

export type WhatsAppInstance = {
  id: string
  instance_name: string
  status: "disconnected" | "connecting" | "connected"
  phone_number: string | null
  created_at: string
}

export type ConversationSource = "organic" | "ad" | "campaign" | "landing" | "manual"

export type Conversation = {
  id: string
  contact_id: string
  instance_id: string
  assigned_to: string | null
  status: "open" | "closed"
  source: ConversationSource
  source_meta: Record<string, unknown> | null
  last_message_at: string | null
  last_message_preview: string | null
  last_message_inbound?: boolean | null
  unread_count: number
  created_at: string
  contact: Contact | null
  assignee: Pick<Profile, "id" | "full_name"> | null
}

export type Message = {
  id: string
  conversation_id: string
  evolution_message_id: string | null
  direction: "inbound" | "outbound"
  sender_profile_id: string | null
  type:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "sticker"
    | "unknown"
  content: string | null
  media_url: string | null
  transcription?: string | null
  send_error?: string | null
  status: "pending" | "sent" | "delivered" | "read" | "failed"
  sent_at: string
  created_at: string
}

export type MessageTemplate = {
  id: string
  title: string
  body: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type AdminUser = {
  id: string
  email: string
  banned: boolean
  full_name: string | null
  role: "admin" | "vendedor"
  is_platform_admin: boolean
  created_at: string | null
}

// ---------------------------------------------------------------------------
// Commercial module
// ---------------------------------------------------------------------------

export type Pipeline = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  is_default: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type PipelineStage = {
  id: string
  pipeline_id: string
  name: string
  description: string | null
  position: number
  color: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Opportunity = {
  id: string
  contact_id: string
  pipeline_id: string
  stage_id: string
  assigned_to: string | null
  conversation_id: string | null
  title: string
  description: string | null
  value: number | null
  currency: string
  probability: number
  expected_close_date: string | null
  status: "open" | "won" | "lost"
  lost_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  closed_at: string | null
  metadata: Record<string, string | null> | null
  temperature?: "cold" | "warm" | "hot" | null
  qualified_at?: string | null
  // Joined fields
  contact?: Contact | null
  pipeline?: Pipeline | null
  stage?: PipelineStage | null
  assignee?: Pick<Profile, "id" | "full_name"> | null
}

export type OpportunityTask = {
  id: string
  opportunity_id: string
  contact_id: string | null
  assigned_to: string | null
  title: string
  description: string | null
  task_type: "task" | "follow_up"
  due_at: string | null
  status: "pending" | "completed" | "cancelled"
  priority: "low" | "normal" | "high" | "urgent"
  completed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type Meeting = {
  id: string
  opportunity_id: string | null
  contact_id: string | null
  assigned_to: string | null
  title: string
  description: string | null
  start_at: string
  end_at: string | null
  location: string | null
  meeting_url: string | null
  status: "scheduled" | "completed" | "cancelled" | "no_show"
  created_by: string | null
  created_at: string
  updated_at: string
}

export type OpportunityStageHistory = {
  id: string
  opportunity_id: string
  old_stage_id: string | null
  new_stage_id: string | null
  changed_by: string | null
  changed_at: string
}

export type ActivityLog = {
  id: string
  entity_type: string
  entity_id: string
  action: string
  actor_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export type Tag = {
  id: string
  name: string
  description: string | null
  color: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ContactTag = {
  id: string
  contact_id: string
  tag_id: string
  created_at: string
  tag?: Tag
}

export type OpportunityTag = {
  id: string
  opportunity_id: string
  tag_id: string
  created_at: string
  tag?: Tag
}

// ---------------------------------------------------------------------------
// Watchdog de oportunidades paradas (emissor OPPORTUNITY_IDLE)
// ---------------------------------------------------------------------------

export type IdleWatchdogSettings = {
  id: string
  is_active: boolean
  idle_days_min: number
  period_start: string | null
  period_end: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type AIConversationSummary = {
  summary: string
  client_want: string
  needs: string
  objections: string
  mentioned_value: string
  next_step: string
}

export type AILeadAnalysis = {
  intent: string
  temperature: "cold" | "warm" | "hot"
  temperature_reason: string
  confidence: number
  suggested_stage: string
  suggested_tags: string[]
  next_action: string
}

export type AISuggestedReply = {
  reply: string
  tone: string
  confidence: number
}

// ---------------------------------------------------------------------------
// SDR IA
// ---------------------------------------------------------------------------

export type SDRSettings = {
  id: string
  enabled: boolean
  test_mode: boolean
  timezone: string
  instance_id: string | null
  schedule_monday: boolean
  schedule_tuesday: boolean
  schedule_wednesday: boolean
  schedule_thursday: boolean
  schedule_friday: boolean
  schedule_saturday: boolean
  schedule_sunday: boolean
  schedule_start_time: string
  schedule_end_time: string
  after_hours_enabled: boolean
  callback_enabled: boolean
  silence_start: string | null
  silence_end: string | null
  meeting_duration_minutes: number
  meeting_minimum_notice_min: number
  meeting_interval_min: number
  max_messages_per_conversation: number
  cooldown_seconds: number
  tone: string
  system_prompt: string | null
  code_prompt: string | null
  primary_model: string | null
  fallback_model: string | null
  created_at: string
  updated_at: string
}

export type SDRConversation = {
  id: string
  conversation_id: string
  contact_id: string | null
  opportunity_id: string | null
  status: "active" | "paused_human" | "paused_limit" | "paused_schedule" | "completed" | "transferred" | "error"
  auto_messages_count: number
  last_auto_reply_at: string | null
  handoff_reason: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type SDRLog = {
  id: string
  conversation_id: string | null
  contact_id: string | null
  opportunity_id: string | null
  message_id: string | null
  model: string | null
  status: "pending" | "completed" | "failed" | "skipped"
  action: string | null
  latency_ms: number | null
  tokens_used: number | null
  error: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type SDRMetrics = {
  leads_today: number
  qualified: number
  demos_scheduled: number
  callbacks_scheduled: number
  transfers: number
}
