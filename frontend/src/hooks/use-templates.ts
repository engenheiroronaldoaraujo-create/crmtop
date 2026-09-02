import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import type { MessageTemplate } from "@/lib/types"

export function useTemplates(activeOnly = true) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    let query = supabase.from("message_templates").select("*").order("title")
    if (activeOnly) query = query.eq("is_active", true)
    const { data } = await query
    setTemplates((data as MessageTemplate[]) ?? [])
    setLoading(false)
  }, [activeOnly])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: { title: string; body: string }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from("message_templates")
      .insert({ ...input, created_by: user?.id ?? null })
    if (error) throw error
    await refresh()
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<MessageTemplate>) => {
    const { error } = await supabase.from("message_templates").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from("message_templates").delete().eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  return { templates, loading, refresh, create, update, remove }
}
