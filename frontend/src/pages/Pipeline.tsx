import { useCallback, useEffect, useMemo, useState } from "react"
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd"
import { toast } from "sonner"
import {
  Plus,
  Search,
  MessageCircle,
  Trophy,
  XCircle,
  RotateCcw,
  Pencil,
  MoreHorizontal,
  User,
  Loader2,
  DollarSign,
  Calendar,
  Check,
  Clock,
  Trash2,
  Settings,
} from "lucide-react"

import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import {
  usePipelines,
  usePipelineStages,
  useOpportunities,
} from "@/hooks/use-commercial"
import { contactDisplayName, cn, formatPhone, isRealPhone } from "@/lib/utils"
import type { Opportunity, PipelineStage, Profile } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Card, CardContent } from "@/components/ui/card"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function formatCurrency(value: number | null): string {
  if (value == null) return ""
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function contactPhone(c: { phone?: string | null; lid?: string | null; jid?: string | null }): string {
  if (c.phone && isRealPhone(c.phone)) return formatPhone(c.phone)
  return "Telefone não identificado"
}

// ---------------------------------------------------------------------------
// Opportunity Card
// ---------------------------------------------------------------------------

function OpportunityCard({
  opportunity,
  index,
  onEdit,
  onWin,
  onLose,
  onReopen,
  onChat,
  onAssign,
  onDelete,
  tags,
  onCreateMeeting,
  onCreateTask,
  onCreateFollowUp,
}: {
  opportunity: Opportunity
  index: number
  onEdit: (o: Opportunity) => void
  onWin: (o: Opportunity) => void
  onLose: (o: Opportunity) => void
  onReopen: (o: Opportunity) => void
  onChat: (o: Opportunity) => void
  onAssign: (o: Opportunity) => void
  onDelete?: (o: Opportunity) => void
  tags?: { tag_id: string; tag?: { name: string; color: string } }[]
  onCreateMeeting?: (o: Opportunity) => void
  onCreateTask?: (o: Opportunity) => void
  onCreateFollowUp?: (o: Opportunity) => void
}) {
  const contact = opportunity.contact
  const assignee = opportunity.assignee

  return (
    <Draggable draggableId={opportunity.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={cn(
            "mb-2",
            snapshot.isDragging && "rotate-2 shadow-lg"
          )}
        >
          <Card
            className="cursor-grab border-border/60 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
            title={opportunity.description ? `Necessidade: ${opportunity.description}` : undefined}
          >
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {contact ? contactDisplayName(contact) : "Sem contato"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {opportunity.title}
                  </p>
                  {opportunity.description && opportunity.description !== opportunity.title && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70 italic">
                      {opportunity.description}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(opportunity)}>
                      <Pencil className="mr-2 h-3 w-3" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAssign(opportunity)}>
                      <User className="mr-2 h-3 w-3" /> Atribuir
                    </DropdownMenuItem>
                    {opportunity.conversation_id && (
                      <DropdownMenuItem onClick={() => onChat(opportunity)}>
                        <MessageCircle className="mr-2 h-3 w-3" /> Abrir Chat
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {onCreateMeeting && (
                      <DropdownMenuItem onClick={() => onCreateMeeting(opportunity)}>
                        <Calendar className="mr-2 h-3 w-3 text-blue-600" /> Agendar reunião
                      </DropdownMenuItem>
                    )}
                    {onCreateTask && (
                      <DropdownMenuItem onClick={() => onCreateTask(opportunity)}>
                        <Check className="mr-2 h-3 w-3 text-green-600" /> Criar tarefa
                      </DropdownMenuItem>
                    )}
                    {onCreateFollowUp && (
                      <DropdownMenuItem onClick={() => onCreateFollowUp(opportunity)}>
                        <Clock className="mr-2 h-3 w-3 text-orange-600" /> Criar follow-up
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {opportunity.status === "open" ? (
                      <>
                        <DropdownMenuItem onClick={() => onWin(opportunity)}>
                          <Trophy className="mr-2 h-3 w-3 text-green-600" /> Ganhar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onLose(opportunity)}>
                          <XCircle className="mr-2 h-3 w-3 text-red-600" /> Perder
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem onClick={() => onReopen(opportunity)}>
                        <RotateCcw className="mr-2 h-3 w-3" /> Reabrir
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(opportunity)} className="text-destructive">
                          <Trash2 className="mr-2 h-3 w-3" /> Excluir
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {opportunity.value != null && (
                <div className="mt-2 flex items-center gap-1 text-sm font-bold text-green-700">
                  <DollarSign className="h-3.5 w-3.5" />
                  {formatCurrency(opportunity.value)}
                </div>
              )}

              {tags && tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tags.slice(0, 3).map((t) => (
                    <span
                      key={t.tag_id}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: t.tag?.color + "20", color: t.tag?.color, border: `1px solid ${t.tag?.color}40` }}
                    >
                      {t.tag?.name}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      +{tags.length - 3}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {assignee && (
                    <Badge variant="outline" className="text-xs">
                      <User className="mr-1 h-3 w-3" />
                      {assignee.full_name ?? "Vendedor"}
                    </Badge>
                  )}
                </div>
                {opportunity.status !== "open" && (
                  <Badge variant={opportunity.status === "won" ? "default" : "destructive"} className="text-xs">
                    {opportunity.status === "won" ? "Ganho" : "Perdido"}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </Draggable>
  )
}

// ---------------------------------------------------------------------------
// Kanban Column
// ---------------------------------------------------------------------------

function KanbanColumn({
  stage,
  opportunities,
  oppTagsMap,
  onEdit,
  onWin,
  onLose,
  onReopen,
  onChat,
  onAssign,
  onDelete,
  onCreateMeeting,
  onCreateTask,
  onCreateFollowUp,
}: {
  stage: PipelineStage
  opportunities: Opportunity[]
  oppTagsMap: Map<string, any[]>
  onEdit: (o: Opportunity) => void
  onWin: (o: Opportunity) => void
  onLose: (o: Opportunity) => void
  onReopen: (o: Opportunity) => void
  onChat: (o: Opportunity) => void
  onAssign: (o: Opportunity) => void
  onDelete?: (o: Opportunity) => void
  onCreateMeeting?: (o: Opportunity) => void
  onCreateTask?: (o: Opportunity) => void
  onCreateFollowUp?: (o: Opportunity) => void
}) {
  const totalValue = useMemo(
    () => opportunities.reduce((sum, o) => sum + (o.value ?? 0), 0),
    [opportunities]
  )

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: (stage.color ?? "#94a3b8") + "15" }}>
        <div
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: stage.color ?? "#94a3b8" }}
        />
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: stage.color ?? "#94a3b8" }}>
          {stage.name}
        </h3>
        <Badge
          className="ml-auto h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px] font-bold"
          style={{ backgroundColor: stage.color ?? "#94a3b8", color: "#fff" }}
        >
          {opportunities.length}
        </Badge>
      </div>
      {totalValue > 0 && (
        <p className="mb-2 px-2 text-xs font-semibold text-foreground">
          {formatCurrency(totalValue)}
        </p>
      )}

      <Droppable droppableId={stage.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "min-h-[120px] flex-1 rounded-lg p-1 transition-colors",
              snapshot.isDraggingOver ? "bg-primary/5" : "bg-muted/30"
            )}
          >
            {opportunities.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                Nenhuma oportunidade
              </p>
            )}
            {opportunities.map((opp, idx) => (
              <OpportunityCard
                key={opp.id}
                opportunity={opp}
                index={idx}
                tags={oppTagsMap.get(opp.id)}
                onEdit={onEdit}
                onWin={onWin}
                onLose={onLose}
                onReopen={onReopen}
                onChat={onChat}
                onAssign={onAssign}
                onDelete={onDelete}
                onCreateMeeting={onCreateMeeting}
                onCreateTask={onCreateTask}
                onCreateFollowUp={onCreateFollowUp}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create/Edit Opportunity Dialog
// ---------------------------------------------------------------------------

function OpportunityDialog({
  open,
  onOpenChange,
  opportunity,
  pipelineId,
  stages,
  contacts,
  profiles,
  onSave,
  defaultContactId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  opportunity: Opportunity | null
  pipelineId: string
  stages: PipelineStage[]
  contacts: any[]
  profiles: Profile[]
  onSave: (data: any) => Promise<void>
  defaultContactId?: string
}) {
  const isEdit = !!opportunity
  const [contactId, setContactId] = useState(opportunity?.contact_id ?? defaultContactId ?? "")
  const [stageId, setStageId] = useState(opportunity?.stage_id ?? stages[0]?.id ?? "")
  const [title, setTitle] = useState(opportunity?.title ?? "")
  const [value, setValue] = useState(opportunity?.value?.toString() ?? "")
  const [assignedTo, setAssignedTo] = useState(opportunity?.assigned_to ?? "")
  const [expectedClose, setExpectedClose] = useState(opportunity?.expected_close_date ?? "")
  const [description, setDescription] = useState(opportunity?.description ?? "")
  const [saving, setSaving] = useState(false)
  const [contactSearch, setContactSearch] = useState("")

  useEffect(() => {
    if (open) {
      setContactId(opportunity?.contact_id ?? defaultContactId ?? "")
      setStageId(opportunity?.stage_id ?? stages[0]?.id ?? "")
      setTitle(opportunity?.title ?? "")
      setValue(opportunity?.value?.toString() ?? "")
      setAssignedTo(opportunity?.assigned_to ?? "")
      setExpectedClose(opportunity?.expected_close_date ?? "")
      setDescription(opportunity?.description ?? "")
      setContactSearch("")
    }
  }, [open, opportunity, stages, defaultContactId])

  const filteredContacts = useMemo(() => {
    if (!contactSearch) return contacts.slice(0, 20)
    const q = contactSearch.toLowerCase()
    return contacts
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.push_name?.toLowerCase().includes(q) ||
          c.phone?.includes(q)
      )
      .slice(0, 20)
  }, [contacts, contactSearch])

  const selectedContact = contacts.find((c) => c.id === contactId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!contactId || !title.trim()) return
    setSaving(true)
    try {
      await onSave({
        contact_id: contactId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: title.trim(),
        value: value ? parseFloat(value) : null,
        assigned_to: assignedTo || null,
        expected_close_date: expectedClose || null,
        description: description.trim() || null,
      })
      onOpenChange(false)
      toast.success(isEdit ? "Oportunidade atualizada" : "Oportunidade criada")
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Oportunidade" : "Nova Oportunidade"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Atualize os dados da oportunidade." : "Crie uma nova oportunidade no funil."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Contact */}
          <div className="space-y-2">
            <Label>Contato *</Label>
            {selectedContact ? (
              <div className="flex items-center justify-between rounded-md border p-2">
                <span className="text-sm">{contactDisplayName(selectedContact)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setContactId("")}
                >
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <Input
                  placeholder="Buscar contato..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                />
                <div className="max-h-40 overflow-auto rounded-md border">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center gap-2 border-b p-2 text-left text-sm last:border-0 hover:bg-muted"
                      onClick={() => {
                        setContactId(c.id)
                        setContactSearch("")
                      }}
                    >
                      <span className="flex-1 truncate">{contactDisplayName(c)}</span>
                      <span className="text-xs text-muted-foreground">{contactPhone(c)}</span>
                    </button>
                  ))}
                  {filteredContacts.length === 0 && (
                    <p className="p-2 text-center text-xs text-muted-foreground">
                      Nenhum contato encontrado
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Stage */}
          <div className="space-y-2">
            <Label>Estágio</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="opp-title">Título *</Label>
            <Input
              id="opp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Serviço de rastreamento"
              required
            />
          </div>

          {/* Value + Assignee row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="opp-value">Valor (R$)</Label>
              <Input
                id="opp-value"
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name ?? "Sem nome"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Expected close date */}
          <div className="space-y-2">
            <Label htmlFor="opp-close-date">Data prevista de fechamento</Label>
            <Input
              id="opp-close-date"
              type="date"
              value={expectedClose}
              onChange={(e) => setExpectedClose(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="opp-desc">Descrição</Label>
            <Textarea
              id="opp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes da oportunidade..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !contactId || !title.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Criar oportunidade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Win/Loss Dialog
// ---------------------------------------------------------------------------

function WinLossDialog({
  open,
  onOpenChange,
  type,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  type: "win" | "lose"
  onConfirm: (reason?: string) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setReason("")
  }, [open])

  const handleConfirm = async () => {
    if (type === "lose" && !reason.trim()) return
    setSaving(true)
    try {
      await onConfirm(type === "lose" ? reason.trim() : undefined)
      onOpenChange(false)
      toast.success(type === "win" ? "Oportunidade ganha!" : "Oportunidade perdida")
    } catch (err: any) {
      toast.error(err.message ?? "Erro")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {type === "win" ? "Ganhar Oportunidade" : "Perder Oportunidade"}
          </DialogTitle>
          <DialogDescription>
            {type === "win"
              ? "Marcar esta oportunidade como ganha?"
              : "Informe o motivo da perda."}
          </DialogDescription>
        </DialogHeader>
        {type === "lose" && (
          <div className="space-y-2">
            <Label htmlFor="lose-reason">Motivo da perda *</Label>
            <Textarea
              id="lose-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Preço alto, concorrência..."
              rows={3}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant={type === "win" ? "default" : "destructive"}
            disabled={saving || (type === "lose" && !reason.trim())}
            onClick={handleConfirm}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {type === "win" ? "Confirmar Ganho" : "Confirmar Perda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Assign Dialog
// ---------------------------------------------------------------------------

function AssignDialog({
  open,
  onOpenChange,
  profiles,
  currentAssignee,
  onAssign,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  profiles: Profile[]
  currentAssignee: string | null
  onAssign: (userId: string | null) => Promise<void>
}) {
  const [selected, setSelected] = useState(currentAssignee ?? "")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setSelected(currentAssignee ?? "")
  }, [open, currentAssignee])

  const handleAssign = async () => {
    setSaving(true)
    try {
      await onAssign(selected || null)
      onOpenChange(false)
      toast.success("Responsável atualizado")
    } catch (err: any) {
      toast.error(err.message ?? "Erro")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Atribuir Responsável</DialogTitle>
        </DialogHeader>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger>
            <SelectValue placeholder="Selecionar..." />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.full_name ?? "Sem nome"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={handleAssign}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Atribuir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Quick Activity Form (from Kanban card)
// ---------------------------------------------------------------------------

function QuickActivityForm({
  type,
  opportunity,
  profiles,
  onSave,
}: {
  type: "meeting" | "task" | "follow_up"
  opportunity: Opportunity | null
  profiles: Profile[]
  onSave: (data: any) => Promise<void>
}) {
  const { user } = useAuth()
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [time, setTime] = useState("09:00")
  const [endTime, setEndTime] = useState("09:30")
  const [assignedTo, setAssignedTo] = useState(opportunity?.assigned_to ?? user?.id ?? "")
  const [priority, setPriority] = useState("normal")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setAssignedTo(opportunity?.assigned_to ?? user?.id ?? "")
  }, [opportunity, user?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      if (type === "meeting") {
        const startAt = new Date(`${date}T${time}:00`).toISOString()
        const endAt = endTime ? new Date(`${date}T${endTime}:00`).toISOString() : null
        await onSave({
          title: title.trim(),
          contact_id: opportunity?.contact_id ?? null,
          opportunity_id: opportunity?.id ?? null,
          assigned_to: assignedTo || null,
          start_at: startAt,
          end_at: endAt,
          created_by: user?.id ?? null,
        })
      } else {
        const dueAt = date && time ? new Date(`${date}T${time}:00`).toISOString() : null
        await onSave({
          title: title.trim(),
          contact_id: opportunity?.contact_id ?? null,
          opportunity_id: opportunity?.id ?? null,
          assigned_to: assignedTo || null,
          task_type: type,
          due_at: dueAt,
          priority,
          created_by: user?.id ?? null,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        <Label>Título *</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={
          type === "meeting" ? "Ex: Reunião de proposta" :
          type === "follow_up" ? "Ex: Confirmar proposta" : "Ex: Enviar documentação"
        } required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Data</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Hora</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      {type === "meeting" && (
        <div className="space-y-2">
          <Label>Hora fim</Label>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      )}
      {type !== "meeting" && (
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
      )}
      <div className="space-y-2">
        <Label>Responsável</Label>
        <Select value={assignedTo} onValueChange={setAssignedTo}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name ?? "—"}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {type === "meeting" ? "Agendar" : "Criar"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Stage Manager Dialog
// ---------------------------------------------------------------------------

function StageManagerDialog({
  open,
  onOpenChange,
  pipelineId,
  stages,
  onRefresh,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pipelineId: string
  stages: any[]
  onRefresh: () => void
}) {
  const [editingStage, setEditingStage] = useState<any>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState("#6b7280")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editingStage) {
      setName(editingStage.name)
      setColor(editingStage.color ?? "#6b7280")
    } else {
      setName("")
      setColor("#6b7280")
    }
  }, [editingStage])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      if (editingStage) {
        const { error } = await supabase
          .from("pipeline_stages")
          .update({ name: name.trim(), color })
          .eq("id", editingStage.id)
        if (error) throw error
        toast.success("Estágio atualizado")
      } else {
        const maxPos = Math.max(...stages.map((s) => s.position), 0)
        const { error } = await supabase
          .from("pipeline_stages")
          .insert({ pipeline_id: pipelineId, name: name.trim(), color, position: maxPos + 1 })
        if (error) throw error
        toast.success("Estágio criado")
      }
      setEditingStage(null)
      setName("")
      setColor("#6b7280")
      onRefresh()
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (stage: any) => {
    // Check if stage has opportunities
    const { count } = await supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stage.id)
    if (count && count > 0) {
      toast.error(`Não é possível excluir: ${count} oportunidade(s) neste estágio`)
      return
    }
    if (!window.confirm(`Excluir o estágio "${stage.name}"?`)) return
    const { error } = await supabase.from("pipeline_stages").delete().eq("id", stage.id)
    if (error) { toast.error(error.message); return }
    toast.success("Estágio excluído")
    onRefresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingStage ? "Editar Estágio" : "Gerenciar Etapas"}</DialogTitle>
        </DialogHeader>

        {/* List of stages */}
        <div className="space-y-2 max-h-60 overflow-auto">
          {stages.map((stage) => (
            <div key={stage.id} className="flex items-center gap-2 rounded border p-2">
              <div className="h-4 w-4 rounded" style={{ backgroundColor: stage.color ?? "#6b7280" }} />
              <span className="flex-1 text-sm">{stage.name}</span>
              <span className="text-xs text-muted-foreground">{stage.position}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingStage(stage)}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(stage)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        <Separator />

        {/* Add/Edit form */}
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-sm font-medium">{editingStage ? "Editar estágio" : "Novo estágio"}</p>
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do estágio"
              required
            />
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 cursor-pointer p-1"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingStage ? "Salvar" : "Adicionar"}
            </Button>
            {editingStage && (
              <Button type="button" variant="outline" onClick={() => setEditingStage(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main Pipeline Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const { profile } = useAuth()
  const { pipelines, loading: loadingPipelines } = usePipelines()
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  const { stages, loading: loadingStages, refresh: refreshStages } = usePipelineStages(selectedPipelineId)
  const {
    opportunities,
    loading: loadingOpps,
    refresh: refreshOpps,
    create: createOpp,
    update: updateOpp,
    moveStage,
    win: winOppFn,
    lose: loseOppFn,
  } = useOpportunities(selectedPipelineId ? { pipeline_id: selectedPipelineId } : undefined)

  // Contacts for create dialog
  const [contacts, setContacts] = useState<any[]>([])
  // Profiles for assign
  const [profiles, setProfiles] = useState<Profile[]>([])

  // Filters
  const [search, setSearch] = useState("")
  const [filterAssignee, setFilterAssignee] = useState("all")
  const [filterStatus, setFilterStatus] = useState("open")

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editOpp, setEditOpp] = useState<Opportunity | null>(null)
  const [winOpen, setWinOpen] = useState(false)
  const [winTarget, setWinTarget] = useState<Opportunity | null>(null)
  const [loseOpen, setLoseOpen] = useState(false)
  const [loseTarget, setLoseTarget] = useState<Opportunity | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignOpp, setAssignOpp] = useState<Opportunity | null>(null)

  // Activity creation from Kanban
  const [actType, setActType] = useState<"meeting" | "task" | "follow_up">("meeting")
  const [actOpen, setActOpen] = useState(false)
  const [actOpp, setActOpp] = useState<Opportunity | null>(null)

  // Stage management
  const [stageDialogOpen, setStageDialogOpen] = useState(false)

  // Load contacts and profiles
  useEffect(() => {
    supabase.from("contacts").select("id, name, push_name, phone, lid, jid").order("name").then(({ data }) => setContacts(data ?? []))
    supabase.from("profiles").select("id, full_name, role").order("full_name").then(({ data }) => setProfiles((data as Profile[]) ?? []))
  }, [])

  // Auto-select first pipeline
  useEffect(() => {
    if (!selectedPipelineId && pipelines.length > 0) {
      setSelectedPipelineId(pipelines[0].id)
    }
  }, [pipelines, selectedPipelineId])

  // Realtime
  useEffect(() => {
    if (!selectedPipelineId) return
    const channel = supabase
      .channel("opportunities-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "opportunities" }, () => {
        refreshOpps()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedPipelineId, refreshOpps])

  // Filtered opportunities
  const filteredOpps = useMemo(() => {
    let result = opportunities
    if (filterStatus !== "all") result = result.filter((o) => o.status === filterStatus)
    if (filterAssignee !== "all") {
      if (filterAssignee === "mine") result = result.filter((o) => o.assigned_to === profile?.id)
      else result = result.filter((o) => o.assigned_to === filterAssignee)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (o) =>
          o.title.toLowerCase().includes(q) ||
          o.contact?.name?.toLowerCase().includes(q) ||
          o.contact?.push_name?.toLowerCase().includes(q) ||
          o.contact?.phone?.includes(q)
      )
    }
    return result
  }, [opportunities, filterStatus, filterAssignee, search, profile?.id])

  // Group by stage
  const oppsByStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>()
    for (const stage of stages) map.set(stage.id, [])
    for (const opp of filteredOpps) {
      const arr = map.get(opp.stage_id)
      if (arr) arr.push(opp)
    }
    return map
  }, [filteredOpps, stages])

  // Load tags for visible opportunities
  const [oppTagsMap, setOppTagsMap] = useState<Map<string, any[]>>(new Map())
  useEffect(() => {
    if (filteredOpps.length === 0) { setOppTagsMap(new Map()); return }
    const ids = filteredOpps.map((o) => o.id)
    supabase.from("opportunity_tags").select("opportunity_id, tag:tags(name, color)").in("opportunity_id", ids).then(({ data }) => {
      const map = new Map<string, any[]>()
      for (const row of data ?? []) {
        const arr = map.get(row.opportunity_id) ?? []
        arr.push(row)
        map.set(row.opportunity_id, arr)
      }
      setOppTagsMap(map)
    })
  }, [filteredOpps])

  // Drag & drop
  const onDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, destination, source } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId && destination.index === source.index) return

      const opp = opportunities.find((o) => o.id === draggableId)
      if (!opp) return

      const oldStageId = opp.stage_id
      const newStageId = destination.droppableId

      // Optimistic update
      updateOpp(draggableId, { stage_id: newStageId })

      try {
        await moveStage(draggableId, newStageId)
      } catch {
        // Revert on error
        updateOpp(draggableId, { stage_id: oldStageId })
        toast.error("Erro ao mover oportunidade")
      }
    },
    [opportunities, moveStage, updateOpp]
  )

  const handleCreate = async (data: any) => {
    await createOpp(data)
    await refreshOpps()
  }

  const handleEdit = async (data: any) => {
    if (!editOpp) return
    await updateOpp(editOpp.id, data)
    await refreshOpps()
  }

  const handleWin = async () => {
    if (!winTarget) return
    await winOppFn(winTarget.id)
    await refreshOpps()
  }

  const handleLose = async (reason?: string) => {
    if (!loseTarget) return
    await loseOppFn(loseTarget.id, reason)
    await refreshOpps()
  }

  const handleReopen = async (opp: Opportunity) => {
    await updateOpp(opp.id, { status: "open", closed_at: null })
    await refreshOpps()
    toast.success("Oportunidade reaberta")
  }

  const handleDeleteOpp = async (opp: Opportunity) => {
    if (!window.confirm(`Excluir a oportunidade "${opp.title}"? O contato será mantido.`)) return
    await supabase.from("opportunities").delete().eq("id", opp.id)
    await refreshOpps()
    toast.success("Oportunidade excluída")
  }

  const handleAssign = async (userId: string | null) => {
    if (!assignOpp) return
    await updateOpp(assignOpp.id, { assigned_to: userId })
    await refreshOpps()
  }

  const handleChat = (opp: Opportunity) => {
    if (opp.conversation_id) {
      window.location.href = `/?conversation=${opp.conversation_id}`
    }
  }

  const loading = loadingPipelines || loadingStages || loadingOpps

  return (
    <>
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-4 border-b px-6">
        <h1 className="text-xl font-semibold">Funil de Vendas</h1>

        {/* Pipeline selector */}
        {pipelines.length > 1 && (
          <Select value={selectedPipelineId ?? ""} onValueChange={setSelectedPipelineId}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-48 pl-9"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filters */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Em aberto</SelectItem>
              <SelectItem value="won">Ganhos</SelectItem>
              <SelectItem value="lost">Perdidos</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterAssignee} onValueChange={setFilterAssignee}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="mine">Minhas</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name ?? "Sem nome"}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" onClick={() => setStageDialogOpen(true)}>
            <Settings className="mr-2 h-4 w-4" /> Etapas
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Oportunidade
          </Button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="w-72 shrink-0">
                <Skeleton className="mb-4 h-6 w-32" />
                <Skeleton className="mb-2 h-40 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ))}
          </div>
        ) : stages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-muted-foreground">Nenhum pipeline configurado.</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4">
              {stages.map((stage) => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  opportunities={oppsByStage.get(stage.id) ?? []}
                  oppTagsMap={oppTagsMap}
                  onEdit={(o) => { setEditOpp(o); setEditOpen(true) }}
                  onWin={(o) => { setWinTarget(o); setWinOpen(true) }}
                  onLose={(o) => { setLoseTarget(o); setLoseOpen(true) }}
                  onReopen={handleReopen}
                  onChat={handleChat}
                  onAssign={(o) => { setAssignOpp(o); setAssignOpen(true) }}
                  onDelete={handleDeleteOpp}
                  onCreateMeeting={(o) => { setActOpp(o); setActType("meeting"); setActOpen(true) }}
                  onCreateTask={(o) => { setActOpp(o); setActType("task"); setActOpen(true) }}
                  onCreateFollowUp={(o) => { setActOpp(o); setActType("follow_up"); setActOpen(true) }}
                />
              ))}
            </div>
          </DragDropContext>
        )}
      </div>

      {/* Dialogs */}
      <OpportunityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        opportunity={null}
        pipelineId={selectedPipelineId ?? ""}
        stages={stages}
        contacts={contacts}
        profiles={profiles}
        onSave={handleCreate}
      />

      <OpportunityDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        opportunity={editOpp}
        pipelineId={selectedPipelineId ?? ""}
        stages={stages}
        contacts={contacts}
        profiles={profiles}
        onSave={handleEdit}
      />

      <WinLossDialog
        open={winOpen}
        onOpenChange={setWinOpen}
        type="win"
        onConfirm={handleWin}
      />

      <WinLossDialog
        open={loseOpen}
        onOpenChange={setLoseOpen}
        type="lose"
        onConfirm={handleLose}
      />

      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        profiles={profiles}
        currentAssignee={assignOpp?.assigned_to ?? null}
        onAssign={handleAssign}
      />

      {/* Quick activity creation from Kanban */}
      <Dialog open={actOpen} onOpenChange={setActOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actType === "meeting" ? "Agendar Reunião" : actType === "follow_up" ? "Criar Follow-up" : "Criar Tarefa"}
            </DialogTitle>
          </DialogHeader>
          <QuickActivityForm
            type={actType}
            opportunity={actOpp}
            profiles={profiles}
            onSave={async (data) => {
              const table = actType === "meeting" ? "meetings" : "opportunity_tasks"
              await supabase.from(table).insert(data)
              setActOpen(false)
              toast.success(actType === "meeting" ? "Reunião agendada" : actType === "follow_up" ? "Follow-up criado" : "Tarefa criada")
            }}
          />
        </DialogContent>
      </Dialog>

      <StageManagerDialog
        open={stageDialogOpen}
        onOpenChange={setStageDialogOpen}
        pipelineId={selectedPipelineId ?? ""}
        stages={stages}
        onRefresh={refreshStages}
      />
    </div>
    </>
  )
}
