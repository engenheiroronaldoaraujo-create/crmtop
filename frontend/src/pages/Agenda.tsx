import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Calendar,
  Check,
  Clock,
  Loader2,
  MessageCircle,
  Plus,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { contactDisplayName, cn } from "@/lib/utils"
import type { Opportunity, Profile } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setDate(r.getDate() - r.getDay() + 1)
  r.setHours(0, 0, 0, 0)
  return r
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

const DAY_NAMES = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"]
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]

type ActivityItem = {
  id: string
  type: "meeting" | "task" | "follow_up"
  title: string
  start_at: string
  end_at?: string | null
  status: string
  priority?: string
  contact?: any
  opportunity?: any
  assignee?: any
}

// ---------------------------------------------------------------------------
// Activity Detail Dialog
// ---------------------------------------------------------------------------

function ActivityDetailDialog({
  open,
  onOpenChange,
  activity,
  onComplete,
  onCancel,
  onDelete,
  onChat,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  activity: ActivityItem | null
  onComplete: (id: string, type: string) => Promise<void>
  onCancel: (id: string, type: string) => Promise<void>
  onDelete: (id: string, type: string) => Promise<void>
  onChat: (contactId: string) => void
}) {
  if (!activity) return null
  const isMeeting = activity.type === "meeting"
  const isPending = activity.status === "pending" || activity.status === "scheduled"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isMeeting ? (
              <Calendar className="h-4 w-4 text-blue-600" />
            ) : activity.type === "follow_up" ? (
              <Clock className="h-4 w-4 text-orange-600" />
            ) : (
              <Check className="h-4 w-4 text-green-600" />
            )}
            {activity.title}
          </DialogTitle>
          <DialogDescription>
            {isMeeting ? "Reuniao" : activity.type === "follow_up" ? "Follow-up" : "Tarefa"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Data:</span>
            <span>{fmtDate(activity.start_at)} as {fmtTime(activity.start_at)}</span>
            {activity.end_at && <span> - {fmtTime(activity.end_at)}</span>}
          </div>

          {activity.contact && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Contato:</span>
              <span>{contactDisplayName(activity.contact)}</span>
            </div>
          )}

          {activity.assignee && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Responsavel:</span>
              <span>{activity.assignee.full_name ?? "-"}</span>
            </div>
          )}

          {activity.priority && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Prioridade:</span>
              <Badge variant={activity.priority === "urgent" ? "destructive" : activity.priority === "high" ? "default" : "secondary"}>
                {activity.priority === "urgent" ? "Urgente" : activity.priority === "high" ? "Alta" : activity.priority === "low" ? "Baixa" : "Normal"}
              </Badge>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <Badge variant={isPending ? "secondary" : activity.status === "completed" ? "default" : "destructive"}>
              {activity.status === "completed" ? "Concluido" : activity.status === "cancelled" ? "Cancelado" : activity.status === "scheduled" ? "Agendado" : "Pendente"}
            </Badge>
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 sm:flex-row">
          {isPending && (
            <>
              <Button size="sm" onClick={() => onComplete(activity.id, activity.type)}>
                <Check className="mr-1 h-3 w-3" /> Concluir
              </Button>
              <Button size="sm" variant="outline" onClick={() => onCancel(activity.id, activity.type)}>
                Cancelar
              </Button>
            </>
          )}
          {activity.contact && (
            <Button size="sm" variant="outline" onClick={() => onChat(activity.contact.id)}>
              <MessageCircle className="mr-1 h-3 w-3" /> Chat
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => onDelete(activity.id, activity.type)}>
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Create Meeting Dialog
// ---------------------------------------------------------------------------

function CreateMeetingDialog({
  open,
  onOpenChange,
  onSave,
  profiles,
  opportunities,
  defaultContactId,
  defaultOpportunityId,
  defaultAssignee,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (data: any) => Promise<void>
  profiles: Profile[]
  opportunities: Opportunity[]
  defaultContactId?: string
  defaultOpportunityId?: string
  defaultAssignee?: string
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState("")
  const [opportunityId, setOpportunityId] = useState(defaultOpportunityId ?? "")
  const [assignedTo, setAssignedTo] = useState(defaultAssignee ?? user?.id ?? "")
  const [date, setDate] = useState("")
  const [startTime, setStartTime] = useState("09:00")
  const [endTime, setEndTime] = useState("09:30")
  const [location, setLocation] = useState("")
  const [meetingUrl, setMeetingUrl] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  const selectedOpp = opportunities.find((o) => o.id === opportunityId)
  const contactId = selectedOpp?.contact_id ?? defaultContactId ?? ""

  useEffect(() => {
    if (open) {
      setTitle("")
      setOpportunityId(defaultOpportunityId ?? "")
      setAssignedTo(defaultAssignee ?? user?.id ?? "")
      setDate(new Date().toISOString().split("T")[0])
      setStartTime("09:00")
      setEndTime("09:30")
      setLocation("")
      setMeetingUrl("")
      setDescription("")
    }
  }, [open, defaultOpportunityId, defaultAssignee, user?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !date || !startTime) return
    setSaving(true)
    try {
      const startAt = new Date(`${date}T${startTime}:00`).toISOString()
      const endAt = endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null
      await onSave({
        title: title.trim(),
        contact_id: contactId || null,
        opportunity_id: opportunityId || null,
        assigned_to: assignedTo || null,
        start_at: startAt,
        end_at: endAt,
        location: location.trim() || null,
        meeting_url: meetingUrl.trim() || null,
        description: description.trim() || null,
        created_by: user?.id ?? null,
      })
      onOpenChange(false)
      toast.success("Reuniao agendada")
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao agendar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agendar Reuniao</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Titulo *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Reuniao de proposta" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Responsavel</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? "-"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Hora inicio *</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Hora fim</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Oportunidade</Label>
            <Select value={opportunityId} onValueChange={setOpportunityId}>
              <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Nenhuma</SelectItem>
                {opportunities.filter((o) => o.status === "open").map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {selectedOpp?.contact && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Contato: </span>
              <span className="font-medium">{contactDisplayName(selectedOpp.contact)}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label>Local</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Escritorio, Google Meet..." />
          </div>
          <div className="space-y-2">
            <Label>Link da reuniao</Label>
            <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-2">
            <Label>Descricao</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Agendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Create Task/Follow-up Dialog
// ---------------------------------------------------------------------------

function CreateTaskDialog({
  open,
  onOpenChange,
  onSave,
  profiles,
  opportunities,
  defaultContactId,
  defaultOpportunityId,
  defaultAssignee,
  taskType,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (data: any) => Promise<void>
  profiles: Profile[]
  opportunities: Opportunity[]
  defaultContactId?: string
  defaultOpportunityId?: string
  defaultAssignee?: string
  taskType: "task" | "follow_up"
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState("")
  const [opportunityId, setOpportunityId] = useState(defaultOpportunityId ?? "")
  const [assignedTo, setAssignedTo] = useState(defaultAssignee ?? user?.id ?? "")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("09:00")
  const [priority, setPriority] = useState("normal")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  const selectedOpp = opportunities.find((o) => o.id === opportunityId)
  const contactId = selectedOpp?.contact_id ?? defaultContactId ?? ""

  useEffect(() => {
    if (open) {
      setTitle("")
      setOpportunityId(defaultOpportunityId ?? "")
      setAssignedTo(defaultAssignee ?? user?.id ?? "")
      setDate(new Date().toISOString().split("T")[0])
      setTime("09:00")
      setPriority("normal")
      setDescription("")
    }
  }, [open, defaultOpportunityId, defaultAssignee, user?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const dueAt = date && time ? new Date(`${date}T${time}:00`).toISOString() : null
      await onSave({
        title: title.trim(),
        contact_id: contactId || null,
        opportunity_id: opportunityId || null,
        assigned_to: assignedTo || null,
        task_type: taskType,
        due_at: dueAt,
        priority,
        description: description.trim() || null,
        created_by: user?.id ?? null,
      })
      onOpenChange(false)
      toast.success(taskType === "follow_up" ? "Follow-up criado" : "Tarefa criada")
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao criar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {taskType === "follow_up" ? "Criar Follow-up" : "Criar Tarefa"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Titulo *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={taskType === "follow_up" ? "Ex: Confirmar proposta" : "Ex: Enviar documentacao"}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Responsavel</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? "-"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Oportunidade</Label>
            <Select value={opportunityId} onValueChange={setOpportunityId}>
              <SelectTrigger><SelectValue placeholder="Nenhuma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Nenhuma</SelectItem>
                {opportunities.filter((o) => o.status === "open").map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {selectedOpp?.contact && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Contato: </span>
              <span className="font-medium">{contactDisplayName(selectedOpp.contact)}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label>Descricao</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {taskType === "follow_up" ? "Criar Follow-up" : "Criar Tarefa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Agenda Page
// ---------------------------------------------------------------------------

export default function AgendaPage() {
  const { user } = useAuth()
  const [meetings, setMeetings] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [filterAssignee, setFilterAssignee] = useState<string>("mine")
  const [filterType, setFilterType] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("pending")

  const [profiles, setProfiles] = useState<any[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])

  const [meetingOpen, setMeetingOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskType, setTaskType] = useState<"task" | "follow_up">("task")
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null)

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  const loadData = useCallback(async () => {
    setLoading(true)
    const from = weekStart.toISOString()
    const to = addDays(weekStart, 7).toISOString()

    let mtgQ = supabase.from("meetings").select("*, contact:contacts(*), assignee:profiles!meetings_assigned_to_fkey(id, full_name), opportunity:opportunities(id, title)").gte("start_at", from).lt("start_at", to).order("start_at")
    let taskQ = supabase.from("opportunity_tasks").select("*, contact:contacts(*), assignee:profiles!opportunity_tasks_assigned_to_fkey(id, full_name), opportunity:opportunities(id, title)").or(`and(due_at.gte.${from},due_at.lt.${to}),due_at.is.null`).order("due_at", { nullsFirst: true })

    if (filterAssignee === "mine") {
      mtgQ = mtgQ.eq("assigned_to", user?.id)
      taskQ = taskQ.eq("assigned_to", user?.id)
    } else if (filterAssignee !== "all") {
      mtgQ = mtgQ.eq("assigned_to", filterAssignee)
      taskQ = taskQ.eq("assigned_to", filterAssignee)
    }

    if (filterStatus !== "all") {
      if (filterStatus === "pending") {
        mtgQ = mtgQ.in("status", ["scheduled"])
        taskQ = taskQ.eq("status", "pending")
      } else if (filterStatus === "completed") {
        mtgQ = mtgQ.in("status", ["completed"])
        taskQ = taskQ.eq("status", "completed")
      }
    }

    const [mtgRes, taskRes] = await Promise.all([mtgQ, taskQ])
    setMeetings((mtgRes.data as any[]) ?? [])
    setTasks((taskRes.data as any[]) ?? [])
    setLoading(false)
  }, [weekStart, filterAssignee, filterStatus, user?.id])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    supabase.from("profiles").select("id, full_name, role").order("full_name").then(({ data }) => setProfiles((data as any[]) ?? []))
    supabase.from("opportunities").select("id, title, status, contact_id").eq("status", "open").order("title").then(({ data }) => setOpportunities((data as Opportunity[]) ?? []))
  }, [])

  useEffect(() => {
    const ch1 = supabase.channel("agenda-meetings").on("postgres_changes", { event: "*", schema: "public", table: "meetings" }, () => loadData()).subscribe()
    const ch2 = supabase.channel("agenda-tasks").on("postgres_changes", { event: "*", schema: "public", table: "opportunity_tasks" }, () => loadData()).subscribe()
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2) }
  }, [loadData])

  const activities = useMemo(() => {
    const items: ActivityItem[] = []
    for (const m of meetings) {
      if (filterType !== "all" && filterType !== "meeting") continue
      items.push({ id: m.id, type: "meeting", title: m.title, start_at: m.start_at, end_at: m.end_at, status: m.status, contact: m.contact, opportunity: m.opportunity, assignee: m.assignee })
    }
    for (const t of tasks) {
      if (filterType !== "all" && filterType !== t.task_type) continue
      items.push({ id: t.id, type: t.task_type as "task" | "follow_up", title: t.title, start_at: t.due_at ?? t.created_at, status: t.status, priority: t.priority, contact: t.contact, opportunity: t.opportunity, assignee: t.assignee })
    }
    items.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    return items
  }, [meetings, tasks, filterType])

  const byDay = useMemo(() => {
    const map = new Map<string, ActivityItem[]>()
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i)
      const key = d.toISOString().split("T")[0]
      map.set(key, [])
    }
    for (const item of activities) {
      const key = new Date(item.start_at).toISOString().split("T")[0]
      const arr = map.get(key)
      if (arr) arr.push(item)
    }
    return map
  }, [activities, weekStart])

  const overdueCount = useMemo(() => {
    const now = new Date()
    return tasks.filter((t) => t.status === "pending" && t.due_at && new Date(t.due_at) < now).length
  }, [tasks])

  const todayCount = useMemo(() => {
    const today = new Date().toISOString().split("T")[0]
    return activities.filter((a) => new Date(a.start_at).toISOString().split("T")[0] === today).length
  }, [activities])

  const handleComplete = async (id: string, type: string) => {
    if (type === "meeting") {
      await supabase.from("meetings").update({ status: "completed" }).eq("id", id)
    } else {
      await supabase.rpc("complete_task", { p_task_id: id })
    }
    toast.success("Concluido")
    setDetailOpen(false)
    loadData()
  }

  const handleCancel = async (id: string, type: string) => {
    if (type === "meeting") {
      await supabase.from("meetings").update({ status: "cancelled" }).eq("id", id)
    } else {
      await supabase.from("opportunity_tasks").update({ status: "cancelled" }).eq("id", id)
    }
    toast.success("Cancelado")
    setDetailOpen(false)
    loadData()
  }

  const handleDelete = async (id: string, type: string) => {
    if (!window.confirm("Excluir esta atividade?")) return
    if (type === "meeting") {
      await supabase.from("meetings").delete().eq("id", id)
    } else {
      await supabase.from("opportunity_tasks").delete().eq("id", id)
    }
    toast.success("Excluido")
    setDetailOpen(false)
    loadData()
  }

  const handleChat = (contactId: string) => {
    window.location.href = `/?contactId=${contactId}`
  }

  const typeIcon = (type: string) => {
    if (type === "meeting") return <Calendar className="h-3 w-3 text-blue-600" />
    if (type === "follow_up") return <Clock className="h-3 w-3 text-orange-600" />
    return <Check className="h-3 w-3 text-green-600" />
  }

  const statusColor = (s: string) => {
    if (s === "completed" || s === "cancelled") return "text-muted-foreground line-through"
    return ""
  }

  return (
    <>
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-6">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <div className="ml-auto flex items-center gap-2">
          {overdueCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {overdueCount} atrasada{overdueCount > 1 ? "s" : ""}
            </Badge>
          )}
          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Minhas</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
              {profiles.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? "-"}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="meeting">Reunioes</SelectItem>
              <SelectItem value="task">Tarefas</SelectItem>
              <SelectItem value="follow_up">Follow-ups</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="completed">Concluidos</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Atividade</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setTaskType("task"); setTaskOpen(true) }}>
                <Check className="mr-2 h-4 w-4" /> Tarefa
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setTaskType("follow_up"); setTaskOpen(true) }}>
                <Clock className="mr-2 h-4 w-4" /> Follow-up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMeetingOpen(true)}>
                <Calendar className="mr-2 h-4 w-4" /> Reuniao
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 md:px-6">
        <Button variant="ghost" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span className="text-sm font-medium">
            {MONTH_NAMES[weekStart.getMonth()]} {weekStart.getFullYear()}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {fmtDate(weekStart.toISOString())} - {fmtDate(weekEnd.toISOString())}
          </span>
          <Badge variant="secondary">{todayCount} hoje</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-2 h-12 w-full" />
                <Skeleton className="mb-1 h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-w-[900px] grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => {
              const d = addDays(weekStart, i)
              const key = d.toISOString().split("T")[0]
              const isToday = sameDay(d, new Date())
              const dayActivities = byDay.get(key) ?? []

              return (
                <div key={i} className={cn("flex flex-col", isToday && "rounded-lg bg-primary/5")}>
                  <div className={cn("mb-2 flex flex-col items-center rounded-t-lg py-2", isToday ? "bg-primary text-primary-foreground" : "bg-muted/50")}>
                    <span className="text-xs font-medium uppercase">{DAY_NAMES[i]}</span>
                    <span className="text-lg font-bold">{d.getDate()}</span>
                  </div>
                  <div className="flex-1 space-y-1 p-1">
                    {dayActivities.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted-foreground">Vazio</p>
                    )}
                    {dayActivities.map((item) => (
                      <button
                        key={item.id}
                        className={cn(
                          "w-full rounded border p-1.5 text-left text-xs transition-colors hover:bg-muted",
                          statusColor(item.status)
                        )}
                        onClick={() => { setSelectedActivity(item); setDetailOpen(true) }}
                      >
                        <div className="flex items-center gap-1">
                          {typeIcon(item.type)}
                          <span className="truncate font-medium">{fmtTime(item.start_at)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px]">{item.title}</p>
                        {item.contact && (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {contactDisplayName(item.contact)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CreateMeetingDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        onSave={async (data) => { await supabase.from("meetings").insert(data); loadData() }}
        profiles={profiles}
        opportunities={opportunities}
      />

      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        onSave={async (data) => { await supabase.from("opportunity_tasks").insert(data); loadData() }}
        profiles={profiles}
        opportunities={opportunities}
        taskType={taskType}
      />

      <ActivityDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        activity={selectedActivity}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onDelete={handleDelete}
        onChat={handleChat}
      />
    </div>
    </>
  )
}
