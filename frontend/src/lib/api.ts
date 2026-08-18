import { supabase, getSupabaseUrl } from "./supabase"

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ""
}

async function postJson(name: string, body: unknown): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }
  return data
}

async function postForm(name: string, formData: FormData): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`${getSupabaseUrl()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }
  return data
}

// ----- admin-users (admin role, validated server-side) -----

export function adminUsersCreate(payload: {
  email: string
  full_name: string
  role: "admin" | "vendedor"
  temp_password: string
}) {
  return postJson("admin-users", { action: "create", ...payload })
}

export function adminUsersList() {
  return postJson("admin-users", { action: "list" })
}

export function adminUsersDeactivate(user_id: string) {
  return postJson("admin-users", { action: "deactivate", user_id })
}

export function adminUsersReactivate(user_id: string) {
  return postJson("admin-users", { action: "reactivate", user_id })
}

export function adminUsersResetPassword(user_id: string, temp_password: string) {
  return postJson("admin-users", { action: "reset-password", user_id, temp_password })
}

export function adminUsersSetRole(user_id: string, role: "admin" | "vendedor") {
  return postJson("admin-users", { action: "set-role", user_id, role })
}

// ----- evolution-proxy (any authenticated user) -----

export function proxyCreateInstance(instance_name: string, phone_number?: string) {
  return postJson("evolution-proxy", {
    action: "create-instance",
    instance_name,
    phone_number,
  })
}

export function proxyGetQr(instance_id: string) {
  return postJson("evolution-proxy", { action: "get-qr", instance_id })
}

export function proxyGetStatus(instance_id: string) {
  return postJson("evolution-proxy", { action: "get-status", instance_id })
}

export function proxySendText(instance_id: string, phone: string, text: string) {
  return postJson("evolution-proxy", { action: "send-text", instance_id, phone, text })
}

export function proxySendMedia(
  instance_id: string,
  phone: string,
  caption: string,
  fileName: string,
  file: Blob,
) {
  const formData = new FormData()
  formData.append("action", "send-media")
  formData.append("instance_id", instance_id)
  formData.append("phone", phone)
  formData.append("caption", caption)
  formData.append("fileName", fileName)
  formData.append("file", file, fileName)
  return postForm("evolution-proxy", formData)
}

export function proxyLogoutInstance(instance_id: string) {
  return postJson("evolution-proxy", { action: "logout-instance", instance_id })
}

export function proxyDeleteInstance(instance_id: string) {
  return postJson("evolution-proxy", { action: "delete-instance", instance_id })
}

export function proxySetWebhook(instance_id: string) {
  return postJson("evolution-proxy", { action: "set-webhook", instance_id })
}

export function proxySyncHistory(instance_id: string) {
  return postJson("evolution-proxy", { action: "sync-history", instance_id })
}

export function proxySyncContacts(instance_id: string) {
  return postJson("evolution-proxy", { action: "sync-contacts", instance_id })
}

export function proxySyncMessages(instance_id: string) {
  return postJson("evolution-proxy", { action: "sync-messages", instance_id })
}

export function proxySyncNames(instance_id: string) {
  return postJson("evolution-proxy", { action: "sync-names", instance_id, reset: true })
}

export function proxyLinkConversationPhone(conversation_id: string, phone: string) {
  return postJson("evolution-proxy", {
    action: "link-conversation-phone",
    conversation_id,
    phone,
  })
}

// ---------------------------------------------------------------------------
// AI Service
// ---------------------------------------------------------------------------

export function aiSummarizeConversation(conversation_id: string) {
  return postJson("ai-service", { action: "summarize_conversation", data: { conversation_id } })
}

export function aiAnalyzeLead(conversation_id: string) {
  return postJson("ai-service", { action: "analyze_lead", data: { conversation_id } })
}

export function aiSuggestReply(conversation_id: string, tone?: string) {
  return postJson("ai-service", { action: "suggest_reply", data: { conversation_id, tone } })
}

export function aiSummarizeClient(contact_id: string) {
  return postJson("ai-service", { action: "summarize_client", data: { contact_id } })
}

export function aiAnalyzeOpportunity(opportunity_id: string) {
  return postJson("ai-service", { action: "analyze_opportunity", data: { opportunity_id } })
}
