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
  phone: string
  name: string | null
  push_name: string | null
  email: string | null
  notes: string | null
  opted_out: boolean
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
