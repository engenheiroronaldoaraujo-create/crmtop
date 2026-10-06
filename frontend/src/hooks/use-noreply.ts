import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import type {
  NoreplyAttempt,
  NoreplyPipelineConfig,
  NoreplySettings,
  NoreplyState,
} from "@/lib/types"

// ---------------------------------------------------------------------------
// useNoreplySettings (admin) — singleton de configuração
// ---------------------------------------------------------------------------

export function useNoreplySettings() {
  const [settings, setSettings] = useState<NoreplySettings | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("noreply_settings")
      .select("*")
      .order("created_at")
      .limit(1)
      .maybeSingle()
    setSettings((data as NoreplySettings) ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const update = useCallback(async (patch: Partial<NoreplySettings>) => {
    if (!settings) return
    const { data, error } = await supabase
      .from("noreply_settings")
      .update(patch)
      .eq("id", settings.id)
      .select()
      .single()
    if (error) throw error
    setSettings(data as NoreplySettings)
    return data
  }, [settings])

  return { settings, loading, refresh, update }
}

// ---------------------------------------------------------------------------
// useNoreplyAttempts (admin) — mensagens por tentativa
// ---------------------------------------------------------------------------

export function useNoreplyAttempts() {
  const [attempts, setAttempts] = useState<NoreplyAttempt[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("noreply_attempts")
      .select("*, template:message_templates(*)")
      .order("attempt_number")
    setAttempts((data as NoreplyAttempt[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const insert = useCallback(async (input: {
    attempt_number: number
    delay_hours: number
    message_text?: string | null
    template_id?: string | null
  }) => {
    const { data, error } = await supabase
      .from("noreply_attempts")
      .insert(input)
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<NoreplyAttempt>) => {
    const { error } = await supabase.from("noreply_attempts").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("noreply_attempts").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { attempts, loading, refresh, insert, update, remove }
}

// ---------------------------------------------------------------------------
// useNoreplyPipelineConfigs (admin) — estágio de destino por funil
// ---------------------------------------------------------------------------

export function useNoreplyPipelineConfigs() {
  const [configs, setConfigs] = useState<NoreplyPipelineConfig[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("noreply_pipeline_configs")
      .select("*, pipeline:pipelines(*), target_stage:pipeline_stages(*)")
      .order("created_at")
    setConfigs((data as NoreplyPipelineConfig[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<NoreplyPipelineConfig>) => {
    const { error } = await supabase.from("noreply_pipeline_configs").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { configs, loading, refresh, update }
}

// ---------------------------------------------------------------------------
// useNoreplyActiveStates — réguas ativas (badge no chat + cancelar)
// ---------------------------------------------------------------------------

export function useNoreplyActiveStates() {
  const [states, setStates] = useState<NoreplyState[]>([])
  const [maxAttempts, setMaxAttempts] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [statesRes, attemptsRes] = await Promise.all([
      supabase
        .from("noreply_states")
        .select("*")
        .eq("status", "active")
        .order("next_check_at")
        .limit(500),
      supabase
        .from("noreply_attempts")
        .select("attempt_number", { count: "exact", head: true })
        .eq("is_active", true),
    ])
    setStates((statesRes.data as NoreplyState[]) ?? [])
    setMaxAttempts(attemptsRes.count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const cancel = useCallback(async (stateId: string) => {
    // Encerra a régua + evento de auditoria (quem cancelou vê no histórico).
    const { error } = await supabase
      .from("noreply_states")
      .update({ status: "cancelled", ended_at: new Date().toISOString(), next_check_at: null })
      .eq("id", stateId)
      .eq("status", "active")
    if (error) throw error
    await supabase.from("noreply_events").insert({
      state_id: stateId,
      event_type: "cancelled",
      details: { reason: "manual" },
    })
    await refresh()
  }, [refresh])

  const byConversation = new Map(states.map((s) => [s.conversation_id, s]))

  return { states, byConversation, maxAttempts, loading, refresh, cancel }
}
