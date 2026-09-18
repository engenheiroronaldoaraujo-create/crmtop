import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import type { Cadence, CadenceEnrollment, CadenceStep } from "@/lib/types"

// ---------------------------------------------------------------------------
// useCadences (admin)
// ---------------------------------------------------------------------------

export function useCadences() {
  const [cadences, setCadences] = useState<Cadence[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("cadences")
      .select("*, pipeline:pipelines(*), trigger_stage:pipeline_stages(*)")
      .order("created_at", { ascending: false })
    setCadences((data as Cadence[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: {
    name: string
    description?: string | null
    pipeline_id: string
    trigger_stage_id: string
    skip_weekends?: boolean
    is_active?: boolean
  }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from("cadences")
      .insert({ ...input, created_by: user?.id ?? null })
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<Cadence>) => {
    const { error } = await supabase.from("cadences").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("cadences").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { cadences, loading, refresh, create, update, remove }
}

// ---------------------------------------------------------------------------
// useCadenceSteps
// ---------------------------------------------------------------------------

export function useCadenceSteps(cadenceId: string | null) {
  const [steps, setSteps] = useState<CadenceStep[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!cadenceId) { setSteps([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from("cadence_steps")
      .select("*, stage:pipeline_stages(*), template:message_templates(*)")
      .eq("cadence_id", cadenceId)
      .order("step_order")
    setSteps((data as CadenceStep[]) ?? [])
    setLoading(false)
  }, [cadenceId])

  useEffect(() => { refresh() }, [refresh])

  const insert = useCallback(async (input: {
    cadence_id: string
    step_order: number
    stage_id: string
    delay_days?: number
    send_message?: boolean
    template_id?: string | null
    message_text?: string | null
  }) => {    const { data, error } = await supabase
      .from("cadence_steps")
      .insert(input)
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<CadenceStep>) => {
    const { error } = await supabase.from("cadence_steps").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("cadence_steps").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { steps, loading, refresh, insert, update, remove }
}

// ---------------------------------------------------------------------------
// useCadenceEnrollments — mapa por opportunity_id p/ badge no kanban
// ---------------------------------------------------------------------------

export function useCadenceEnrollments() {
  const [byOpportunity, setByOpportunity] = useState<Map<string, CadenceEnrollment>>(new Map())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("cadence_enrollments")
      .select("*, cadence:cadences(*)")
      .in("status", ["active", "paused"])
    const map = new Map<string, CadenceEnrollment>()
    for (const e of ((data as CadenceEnrollment[]) ?? [])) {
      const existing = map.get(e.opportunity_id)
      if (!existing || e.updated_at > existing.updated_at) map.set(e.opportunity_id, e)
    }
    setByOpportunity(map)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<CadenceEnrollment>) => {
    const { error } = await supabase.from("cadence_enrollments").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const restart = useCallback(async (opportunity_id: string, cadence_id: string) => {
    // Reativa: cancela/completa anteriores e cria enrollment zerado.
    await supabase
      .from("cadence_enrollments")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), next_run_at: null })
      .eq("opportunity_id", opportunity_id)
      .in("status", ["active", "paused"])
    const { data: { user } } = await supabase.auth.getUser()
    const { data: opp } = await supabase
      .from("opportunities")
      .select("assigned_to")
      .eq("id", opportunity_id)
      .maybeSingle()
    const { error } = await supabase.from("cadence_enrollments").insert({
      cadence_id,
      opportunity_id,
      assigned_to: opp?.assigned_to ?? user?.id ?? null,
      current_step: 0,
      status: "active",
    })
    if (error) throw error
    await refresh()
  }, [refresh])

  return { byOpportunity, loading, refresh, update, restart }
}
