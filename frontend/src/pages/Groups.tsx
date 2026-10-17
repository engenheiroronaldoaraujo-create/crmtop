import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowLeft, CalendarClock, Loader2, Plus, RefreshCw, Send, Users, X } from "lucide-react"

import { supabase } from "@/lib/supabase"
import { groupPostCancel, groupPostCreate, groupPostDmCancel, proxyListGroups } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type GroupPost = {
  id: string
  instance_id: string
  group_jid: string
  group_name: string | null
  content: string
  media_url: string | null
  media_type: string | null
  scheduled_at: string
  window_hours: number
  dm_delay_min_s: number
  dm_delay_max_s: number
  dm_template: string
  pacing_seconds: number
  status: string
  published_at: string | null
  engaged_count: number
  dm_sent_count: number
  dm_failed_count: number
  dm_pending_count: number
  last_error: string | null
  instance?: { instance_name: string } | null
}

type Engagement = {
  id: string
  contact_id: string | null
  commented_at: string
  via: string
  dm_status: string
  dm_due_at: string
  dm_sent_at: string | null
  dm_attempts: number
  dm_error: string | null
  contact?: { name: string | null; push_name: string | null; phone: string | null } | null
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  publishing: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400",
  published: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  expired: "bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
}

const DM_STATUS_STYLE: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  sending: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400",
  waiting: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  sent: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  skipped_optout: "bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
  skipped_no_phone: "bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400",
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function contactName(e: Engagement): string {
  return e.contact?.name ?? e.contact?.push_name ?? "Sem nome"
}

export default function GroupsPage() {
  const [instances, setInstances] = useState<any[]>([])
  const [instanceId, setInstanceId] = useState("")
  const [groups, setGroups] = useState<{ id: string; name: string | null; size: number | null }[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [posts, setPosts] = useState<GroupPost[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<GroupPost | null>(null)
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [engLoading, setEngLoading] = useState(false)

  // form
  const [groupJid, setGroupJid] = useState("")
  const [content, setContent] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [scheduledAt, setScheduledAt] = useState("")
  const [windowHours, setWindowHours] = useState("72")
  const [delayMin, setDelayMin] = useState("5")
  const [delayMax, setDelayMax] = useState("15")
  const [dmTemplate, setDmTemplate] = useState(
    "Oi {{contact.name}}! Vi que você comentou no grupo e quis te chamar aqui no privado. Como posso te ajudar?",
  )

  const loadInstances = useCallback(async () => {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, phone_number, status")
      .order("instance_name")
    setInstances(data ?? [])
    const connected = (data ?? []).find((i: any) => i.status === "connected")
    if (connected) setInstanceId((prev) => prev || connected.id)
  }, [])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("group_posts")
      .select("*, instance:whatsapp_instances(instance_name)")
      .order("scheduled_at", { ascending: false })
      .limit(100)
    setPosts((data as GroupPost[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadInstances()
    loadPosts()
  }, [loadInstances, loadPosts])

  const loadGroups = useCallback(async (id: string) => {
    if (!id) return
    setGroupsLoading(true)
    try {
      const data = await proxyListGroups(id)
      setGroups(data?.groups ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao listar grupos")
      setGroups([])
    } finally {
      setGroupsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (instanceId) loadGroups(instanceId)
  }, [instanceId, loadGroups])

  const loadEngagements = useCallback(async (postId: string) => {
    setEngLoading(true)
    const { data } = await supabase
      .from("group_post_engagements")
      .select("*, contact:contacts(name, push_name, phone)")
      .eq("post_id", postId)
      .order("commented_at", { ascending: false })
      .limit(200)
    setEngagements((data as Engagement[]) ?? [])
    setEngLoading(false)
  }, [])

  useEffect(() => {
    if (detail) loadEngagements(detail.id)
    else setEngagements([])
  }, [detail, loadEngagements])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!instanceId || !groupJid) {
      toast.error("Escolha a instância e o grupo")
      return
    }
    if (!content.trim() && !file) {
      toast.error("Informe o texto ou anexe uma mídia")
      return
    }
    if (!scheduledAt) {
      toast.error("Informe data e hora da publicação")
      return
    }
    const minS = Math.max(0, parseInt(delayMin || "0", 10) * 60)
    const maxS = Math.max(0, parseInt(delayMax || "0", 10) * 60)
    if (maxS < minS) {
      toast.error("Delay máximo deve ser maior que o mínimo")
      return
    }
    setSaving(true)
    try {
      const group = groups.find((g) => g.id === groupJid)
      await groupPostCreate({
        instance_id: instanceId,
        group_jid: groupJid,
        group_name: group?.name ?? null,
        content: content.trim(),
        scheduled_at: new Date(scheduledAt).toISOString(),
        window_hours: Math.min(720, Math.max(1, parseInt(windowHours || "72", 10))),
        dm_delay_min_s: minS,
        dm_delay_max_s: maxS,
        dm_template: dmTemplate,
        pacing_seconds: 20,
        file,
      })
      toast.success("Post agendado")
      setDialogOpen(false)
      setContent("")
      setFile(null)
      setScheduledAt("")
      setGroupJid("")
      await loadPosts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao agendar post")
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelPost(id: string) {
    if (!window.confirm("Cancelar este post? DMs pendentes também serão canceladas.")) return
    try {
      await groupPostCancel(id)
      toast.success("Post cancelado")
      setDetail(null)
      await loadPosts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cancelar")
    }
  }

  async function handleCancelDm(engId: string, postId: string) {
    try {
      await groupPostDmCancel(engId)
      toast.success("DM cancelada")
      await loadEngagements(postId)
      await loadPosts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao cancelar DM")
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Posts em Grupos</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadPosts} title="Recarregar">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Agendar post
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-auto p-6">
        <p className="text-sm text-muted-foreground">
          Publica no grupo via Evolution e chama no privado (mesma instância) quem comentar em até{" "}
          <strong>72h</strong>, após delay de <strong>5–15 min</strong>. A DM respeita opt-out, horário
          comercial e SDR IA — nunca envia junto.
        </p>

        {loading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : posts.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nenhum post agendado. Clique em “Agendar post” para começar.
            </CardContent>
          </Card>
        ) : (
          posts.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {p.group_name ?? p.group_jid}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {p.instance?.instance_name ?? ""}
                  </span>
                </CardTitle>
                <Badge className={STATUS_STYLE[p.status] ?? ""}>{p.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="line-clamp-2">{p.content || "(mídia)"}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" /> {fmtDateTime(p.scheduled_at)}
                  </span>
                  <span>Janela {p.window_hours}h</span>
                  <span>
                    {p.engaged_count} comentaram · {p.dm_sent_count} DMs enviadas ·{" "}
                    {p.dm_pending_count} pendentes · {p.dm_failed_count} falhas
                  </span>
                </div>
                {p.last_error && <p className="text-xs text-red-500">{p.last_error}</p>}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setDetail(p)}>
                    Ver engajados
                  </Button>
                  {["scheduled", "publishing", "published", "failed"].includes(p.status) && (
                    <Button variant="outline" size="sm" onClick={() => handleCancelPost(p.id)}>
                      <X className="mr-1 h-3 w-3" /> Cancelar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Agendar post em grupo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Instância</Label>
              <Select value={instanceId} onValueChange={(v) => { setInstanceId(v); setGroupJid("") }}>
                <SelectTrigger><SelectValue placeholder="Escolha a instância" /></SelectTrigger>
                <SelectContent>
                  {instances.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.instance_name} {i.status !== "connected" ? "(desconectada)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Grupo {groupsLoading && <Loader2 className="inline h-3 w-3 animate-spin" />}</Label>
              <Select value={groupJid} onValueChange={setGroupJid}>
                <SelectTrigger><SelectValue placeholder={groups.length ? "Escolha o grupo" : "Carregue os grupos da instância"} /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name ?? g.id}{g.size ? ` (${g.size})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="Texto que será publicado no grupo..."
              />
            </div>
            <div className="space-y-2">
              <Label>Mídia (opcional)</Label>
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Publicar em</Label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Janela (horas)</Label>
                <Input
                  type="number" min={1} max={720} value={windowHours}
                  onChange={(e) => setWindowHours(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Delay mín (min)</Label>
                <Input type="number" min={0} value={delayMin} onChange={(e) => setDelayMin(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Delay máx (min)</Label>
                <Input type="number" min={0} value={delayMax} onChange={(e) => setDelayMax(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mensagem da DM (use {"{{contact.name}}"})</Label>
              <Textarea value={dmTemplate} onChange={(e) => setDmTemplate(e.target.value)} rows={3} />
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Agendar
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.group_name ?? detail?.group_jid}
              {detail && <Badge className={STATUS_STYLE[detail.status] ?? ""}>{detail.status}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {engLoading ? (
            <p className="text-sm text-muted-foreground">Carregando engajados...</p>
          ) : engagements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém comentou ainda dentro da janela.</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-auto">
              {engagements.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{contactName(e)}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.via === "reply" ? "respondeu o post" : "comentou no grupo"} · {fmtDateTime(e.commented_at)}
                      {e.dm_error && ` · ${e.dm_error}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={cn(DM_STATUS_STYLE[e.dm_status] ?? "")}>{e.dm_status}</Badge>
                    {["pending", "waiting"].includes(e.dm_status) && detail && (
                      <Button variant="outline" size="sm" onClick={() => handleCancelDm(e.id, detail.id)}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {detail && ["scheduled", "publishing", "published", "failed"].includes(detail.status) && (
            <Button variant="outline" onClick={() => handleCancelPost(detail.id)}>
              <ArrowLeft className="mr-2 hidden h-4 w-4" /> Cancelar post e DMs pendentes
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
