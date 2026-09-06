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

export function proxySendText(instance_id: string, phone: string, text: string, instance_name?: string) {
  return postJson("evolution-proxy", { action: "send-text", instance_id, instance_name, phone, text })
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

// ---------------------------------------------------------------------------
// SDR Engine
// ---------------------------------------------------------------------------

export function sdrGetSettings() {
  return postJson("sdr-engine", { action: "get_settings", data: {} })
}

export function sdrUpdateSettings(settings: Record<string, unknown>) {
  return postJson("sdr-engine", { action: "update_settings", data: settings })
}

export function sdrGetMetrics() {
  return postJson("sdr-engine", { action: "get_metrics", data: {} })
}

export function sdrTestSDR(message: string) {
  return postJson("sdr-engine", { action: "test_sdr", data: { message } })
}

// ---------------------------------------------------------------------------
// Zernio (WhatsApp oficial / Meta Cloud API)
// ---------------------------------------------------------------------------

export function zernioSetApiKey(api_key: string) {
  return postJson("zernio-proxy", { action: "set-api-key", api_key })
}

export function zernioGetConfig() {
  return postJson("zernio-proxy", { action: "get-config" })
}

export function zernioConnectStart(redirect_url: string) {
  return postJson("zernio-proxy", { action: "connect-start", redirect_url })
}

export function zernioConnectComplete(input: {
  account_id: string
  profile_id?: string
  username?: string
}) {
  return postJson("zernio-proxy", { action: "connect-complete", ...input })
}

export function zernioConnectResync() {
  return postJson("zernio-proxy", { action: "connect-resync" })
}

export function zernioDisconnect() {
  return postJson("zernio-proxy", { action: "disconnect" })
}

export function zernioSetupWebhook() {
  return postJson("zernio-proxy", { action: "setup-webhook" })
}

export function zernioSyncTemplates() {
  return postJson("zernio-proxy", { action: "sync-templates" })
}

export function zernioCreateTemplate(input: {
  name: string
  category: string
  language: string
  body_text: string
  footer_text?: string
}) {
  return postJson("zernio-proxy", { action: "create-template", ...input })
}

export function zernioCampaignCreate(input: {
  name: string
  description?: string
  template_name: string
  template_language: string
  variable_mapping: Record<string, unknown>
  scheduled_at?: string | null
  recipients: Array<{ contact_id?: string | null; phone: string; name?: string | null; email?: string | null }>
}) {
  return postJson("zernio-proxy", { action: "campaign-create", ...input })
}

export function zernioCampaignSend(campaign_id: string) {
  return postJson("zernio-proxy", { action: "campaign-send", campaign_id })
}

export function zernioCampaignSchedule(campaign_id: string, scheduled_at: string) {
  return postJson("zernio-proxy", { action: "campaign-schedule", campaign_id, scheduled_at })
}

export function zernioCampaignCancel(campaign_id: string) {
  return postJson("zernio-proxy", { action: "campaign-cancel", campaign_id })
}

export function zernioCampaignSync(campaign_id: string) {
  return postJson("zernio-proxy", { action: "campaign-sync", campaign_id })
}

export function zernioCampaignTest(campaign_id: string, phone: string) {
  return postJson("zernio-proxy", { action: "campaign-test", campaign_id, phone })
}
