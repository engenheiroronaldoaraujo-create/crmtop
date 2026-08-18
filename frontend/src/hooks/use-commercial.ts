import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import type {
  Pipeline,
  PipelineStage,
  Opportunity,
  OpportunityTask,
  Meeting,
  OpportunityStageHistory,
} from "@/lib/types"

// ---------------------------------------------------------------------------
// usePipelines
// ---------------------------------------------------------------------------

export function usePipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("pipelines")
      .select("*")
      .eq("is_active", true)
      .order("name")
    setPipelines(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { pipelines, loading, refresh }
}

// ---------------------------------------------------------------------------
// usePipelineStages
// ---------------------------------------------------------------------------

export function usePipelineStages(pipelineId: string | null) {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!pipelineId) { setStages([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .eq("is_active", true)
      .order("position")
    setStages(data ?? [])
    setLoading(false)
  }, [pipelineId])

  useEffect(() => { refresh() }, [refresh])

  return { stages, loading, refresh }
}

// ---------------------------------------------------------------------------
// useOpportunities
// ---------------------------------------------------------------------------

export function useOpportunities(filters?: {
  assigned_to?: string
  pipeline_id?: string
  status?: string
}) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("opportunities")
      .select("*, contact:contacts(*), pipeline:pipelines(*), stage:pipeline_stages(*), assignee:profiles(id, full_name)")
      .order("created_at", { ascending: false })

    if (filters?.assigned_to) q = q.eq("assigned_to", filters.assigned_to)
    if (filters?.pipeline_id) q = q.eq("pipeline_id", filters.pipeline_id)
    if (filters?.status) q = q.eq("status", filters.status)

    const { data } = await q
    setOpportunities((data as Opportunity[]) ?? [])
    setLoading(false)
  }, [filters?.assigned_to, filters?.pipeline_id, filters?.status])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: {
    contact_id: string
    pipeline_id: string
    stage_id: string
    title: string
    description?: string
    value?: number
    assigned_to?: string
    conversation_id?: string
    expected_close_date?: string
  }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from("opportunities")
      .insert({
        ...input,
        created_by: user?.id ?? null,
      })
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<Opportunity>) => {
    const { error } = await supabase
      .from("opportunities")
      .update(patch)
      .eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const moveStage = useCallback(async (id: string, newStageId: string) => {
    const { error } = await supabase.rpc("move_opportunity_stage", {
      p_opportunity_id: id,
      p_new_stage_id: newStageId,
    })
    if (error) throw error
    await refresh()
  }, [refresh])

  const win = useCallback(async (id: string) => {
    await update(id, { status: "won", closed_at: new Date().toISOString() })
  }, [update])

  const lose = useCallback(async (id: string, reason?: string) => {
    await update(id, { status: "lost", lost_reason: reason ?? null, closed_at: new Date().toISOString() })
  }, [update])

  return { opportunities, loading, refresh, create, update, moveStage, win, lose }
}

// ---------------------------------------------------------------------------
// useOpportunityTasks
// ---------------------------------------------------------------------------

export function useOpportunityTasks(opportunityId: string | null) {
  const [tasks, setTasks] = useState<OpportunityTask[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!opportunityId) { setTasks([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from("opportunity_tasks")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
    setTasks((data as OpportunityTask[]) ?? [])
    setLoading(false)
  }, [opportunityId])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: {
    opportunity_id: string
    title: string
    description?: string
    task_type?: "task" | "follow_up"
    due_at?: string
    assigned_to?: string
    contact_id?: string
    priority?: "low" | "normal" | "high" | "urgent"
  }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from("opportunity_tasks")
      .insert({ ...input, created_by: user?.id ?? null })
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const complete = useCallback(async (taskId: string) => {
    const { error } = await supabase.rpc("complete_task", { p_task_id: taskId })
    if (error) throw error
    await refresh()
  }, [refresh])

  const cancel = useCallback(async (taskId: string) => {
    const { error } = await supabase
      .from("opportunity_tasks")
      .update({ status: "cancelled" })
      .eq("id", taskId)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { tasks, loading, refresh, create, complete, cancel }
}

// ---------------------------------------------------------------------------
// useMeetings
// ---------------------------------------------------------------------------

export function useMeetings(filters?: { opportunity_id?: string; assigned_to?: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("meetings")
      .select("*")
      .order("start_at", { ascending: false })

    if (filters?.opportunity_id) q = q.eq("opportunity_id", filters.opportunity_id)
    if (filters?.assigned_to) q = q.eq("assigned_to", filters.assigned_to)

    const { data } = await q
    setMeetings((data as Meeting[]) ?? [])
    setLoading(false)
  }, [filters?.opportunity_id, filters?.assigned_to])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: {
    title: string
    start_at: string
    end_at?: string
    description?: string
    opportunity_id?: string
    contact_id?: string
    assigned_to?: string
    location?: string
    meeting_url?: string
  }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from("meetings")
      .insert({ ...input, created_by: user?.id ?? null })
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<Meeting>) => {
    const { error } = await supabase
      .from("meetings")
      .update(patch)
      .eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { meetings, loading, refresh, create, update }
}

// ---------------------------------------------------------------------------
// useStageHistory
// ---------------------------------------------------------------------------

export function useStageHistory(opportunityId: string | null) {
  const [history, setHistory] = useState<OpportunityStageHistory[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!opportunityId) { setHistory([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from("opportunity_stage_history")
      .select("*")
      .eq("opportunity_id", opportunityId)
      .order("changed_at", { ascending: false })
    setHistory((data as OpportunityStageHistory[]) ?? [])
    setLoading(false)
  }, [opportunityId])

  useEffect(() => { refresh() }, [refresh])

  return { history, loading, refresh }
}
