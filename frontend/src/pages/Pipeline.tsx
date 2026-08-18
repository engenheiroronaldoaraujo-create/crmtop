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
}: {
  opportunity: Opportunity
  index: number
  onEdit: (o: Opportunity) => void
  onWin: (o: Opportunity) => void
  onLose: (o: Opportunity) => void
  onReopen: (o: Opportunity) => void
  onChat: (o: Opportunity) => void
  onAssign: (o: Opportunity) => void
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
          <Card className="cursor-grab active:cursor-grabbing">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {contact ? contactDisplayName(contact) : "Sem contato"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {opportunity.title}
                  </p>
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {opportunity.value != null && (
                <div className="mt-2 flex items-center gap-1 text-xs font-medium text-green-700">
                  <DollarSign className="h-3 w-3" />
                  {formatCurrency(opportunity.value)}
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
  onEdit,
  onWin,
  onLose,
  onReopen,
  onChat,
  onAssign,
}: {
  stage: PipelineStage
  opportunities: Opportunity[]
  onEdit: (o: Opportunity) => void
  onWin: (o: Opportunity) => void
  onLose: (o: Opportunity) => void
  onReopen: (o: Opportunity) => void
  onChat: (o: Opportunity) => void
  onAssign: (o: Opportunity) => void
}) {
  const totalValue = useMemo(
    () => opportunities.reduce((sum, o) => sum + (o.value ?? 0), 0),
    [opportunities]
  )

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: stage.color ?? "#94a3b8" }}
        />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {stage.name}
        </h3>
        <Badge variant="secondary" className="ml-auto text-xs">
          {opportunities.length}
        </Badge>
      </div>
      {totalValue > 0 && (
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">
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
                onEdit={onEdit}
                onWin={onWin}
                onLose={onLose}
                onReopen={onReopen}
                onChat={onChat}
                onAssign={onAssign}
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
// Main Pipeline Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const { profile } = useAuth()
  const { pipelines, loading: loadingPipelines } = usePipelines()
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  const { stages, loading: loadingStages } = usePipelineStages(selectedPipelineId)
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
                  onEdit={(o) => { setEditOpp(o); setEditOpen(true) }}
                  onWin={(o) => { setWinTarget(o); setWinOpen(true) }}
                  onLose={(o) => { setLoseTarget(o); setLoseOpen(true) }}
                  onReopen={handleReopen}
                  onChat={handleChat}
                  onAssign={(o) => { setAssignOpp(o); setAssignOpen(true) }}
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
    </div>
  )
}
