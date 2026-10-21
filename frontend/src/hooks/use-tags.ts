import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { escapePostgrestSearch } from "@/lib/utils"
import type { Tag } from "@/lib/types"

// ---------------------------------------------------------------------------
// useTags — all active tags
// ---------------------------------------------------------------------------

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: queryError } = await supabase
      .from("tags")
      .select("*")
      .eq("is_active", true)
      .order("name")
    // Erro descartado = lista vazia silenciosa (o usuário não distingue
    // "sem etiquetas" de "a query falhou").
    if (queryError) {
      console.error("useTags failed", queryError)
      setError(queryError.message)
    } else {
      setError(null)
      setTags((data as Tag[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: { name: string; color?: string; description?: string }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from("tags")
      .insert({ ...input, created_by: user?.id ?? null })
      .select()
      .single()
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const update = useCallback(async (id: string, patch: Partial<Tag>) => {
    const { error } = await supabase.from("tags").update(patch).eq("id", id)
    if (error) throw error
    await refresh()
  }, [refresh])

  const deactivate = useCallback(async (id: string) => {
    await update(id, { is_active: false })
  }, [update])

  const reactivate = useCallback(async (id: string) => {
    await update(id, { is_active: true })
  }, [update])

  return { tags, loading, error, refresh, create, update, deactivate, reactivate }
}

// ---------------------------------------------------------------------------
// useContactTags
// ---------------------------------------------------------------------------

export function useContactTags(contactId: string | null) {
  const [contactTags, setContactTags] = useState<(any)[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!contactId) { setContactTags([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from("contact_tags")
      .select("*, tag:tags(*)")
      .eq("contact_id", contactId)
    setContactTags(data ?? [])
    setLoading(false)
  }, [contactId])

  useEffect(() => { refresh() }, [refresh])

  const addTag = useCallback(async (tagId: string) => {
    if (!contactId) return
    const { error } = await supabase
      .from("contact_tags")
      .insert({ contact_id: contactId, tag_id: tagId })
    if (error && error.code !== "23505") throw error // ignore duplicate
    await refresh()
  }, [contactId, refresh])

  const removeTag = useCallback(async (tagId: string) => {
    if (!contactId) return
    const { error } = await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", contactId)
      .eq("tag_id", tagId)
    if (error) throw error
    await refresh()
  }, [contactId, refresh])

  const setTags = useCallback(async (tagIds: string[]) => {
    if (!contactId) return
    // Delete all existing
    await supabase.from("contact_tags").delete().eq("contact_id", contactId)
    // Insert new
    if (tagIds.length > 0) {
      const rows = tagIds.map((tag_id) => ({ contact_id: contactId, tag_id }))
      await supabase.from("contact_tags").insert(rows)
    }
    await refresh()
  }, [contactId, refresh])

  return { contactTags, loading, refresh, addTag, removeTag, setTags }
}

// ---------------------------------------------------------------------------
// useOpportunityTags
// ---------------------------------------------------------------------------

export function useOpportunityTags(opportunityId: string | null) {
  const [oppTags, setOppTags] = useState<(any)[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!opportunityId) { setOppTags([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from("opportunity_tags")
      .select("*, tag:tags(*)")
      .eq("opportunity_id", opportunityId)
    setOppTags(data ?? [])
    setLoading(false)
  }, [opportunityId])

  useEffect(() => { refresh() }, [refresh])

  const addTag = useCallback(async (tagId: string) => {
    if (!opportunityId) return
    const { error } = await supabase
      .from("opportunity_tags")
      .insert({ opportunity_id: opportunityId, tag_id: tagId })
    if (error && error.code !== "23505") throw error
    await refresh()
  }, [opportunityId, refresh])

  const removeTag = useCallback(async (tagId: string) => {
    if (!opportunityId) return
    const { error } = await supabase
      .from("opportunity_tags")
      .delete()
      .eq("opportunity_id", opportunityId)
      .eq("tag_id", tagId)
    if (error) throw error
    await refresh()
  }, [opportunityId, refresh])

  return { oppTags, loading, refresh, addTag, removeTag }
}

// ---------------------------------------------------------------------------
// useGlobalSearch
// ---------------------------------------------------------------------------

export function useGlobalSearch() {
  const [query, setQuery] = useState("")
  const searchSeq = useRef(0)
  const [results, setResults] = useState<{
    contacts: any[]
    opportunities: any[]
    conversations: any[]
  }>({ contacts: [], opportunities: [], conversations: [] })
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (q: string) => {
    const raw = q.trim()
    if (!raw) {
      setResults({ contacts: [], opportunities: [], conversations: [] })
      return
    }
    // PostgREST `or=` usa vírgula/parênteses como separadores e `%`/`_` como
    // curingas: sanitize para não quebrar a query nem virar wildcard.
    // O mesmo escape é usado na busca de contatos (escapePostgrestSearch).
    const sanitized = escapePostgrestSearch(raw).replace(/\s+/g, " ")
    if (!sanitized) {
      setResults({ contacts: [], opportunities: [], conversations: [] })
      return
    }
    const reqId = ++searchSeq.current
    setLoading(true)
    const pattern = `%${sanitized}%`

    const [contactsRes, oppsRes, convsRes] = await Promise.all([
      supabase.from("contacts").select("id, name, push_name, phone, lid").or(`name.ilike.${pattern},push_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`).limit(5),
      supabase.from("opportunities").select("id, title, status, contact:contacts(name, phone)").ilike("title", pattern).limit(5),
      supabase.from("conversations").select("id, contact:contacts(name, phone, push_name)").ilike("contact.name", pattern).limit(5),
    ])
    if (reqId !== searchSeq.current) return

    setResults({
      contacts: contactsRes.data ?? [],
      opportunities: oppsRes.data ?? [],
      conversations: convsRes.data ?? [],
    })
    setLoading(false)
  }, [])

  return { query, setQuery, results, loading, search }
}
