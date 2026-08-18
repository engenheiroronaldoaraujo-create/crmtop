export type Profile = {
  id: string
  full_name: string | null
  role: "admin" | "vendedor"
  is_platform_admin: boolean
  avatar_url: string | null
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

export type Conversation = {
  id: string
  contact_id: string
  instance_id: string
  assigned_to: string | null
  status: "open" | "closed"
  last_message_at: string | null
  last_message_preview: string | null
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
  status: "pending" | "sent" | "delivered" | "read" | "failed"
  sent_at: string
  created_at: string
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
  new_stage_id: string
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
