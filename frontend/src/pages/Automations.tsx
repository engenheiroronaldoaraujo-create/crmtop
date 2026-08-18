import { useCallback, useEffect, useState } from "react"
import {
  Zap,
  ZapOff,
  History,
  ChevronDown,
  ChevronUp,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  MoreHorizontal,
} from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import type { AutomationRule, AutomationExecution } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const TRIGGER_LABELS: Record<string, string> = {
  NEW_CONTACT: "Novo contato",
  FIRST_MESSAGE_RECEIVED: "Primeira mensagem recebida",
  MESSAGE_RECEIVED: "Mensagem recebida",
  MESSAGE_SENT: "Mensagem enviada",
  OPPORTUNITY_CREATED: "Oportunidade criada",
  OPPORTUNITY_STAGE_CHANGED: "Estágio alterado",
  OPPORTUNITY_ASSIGNED: "Oportunidade atribuída",
  OPPORTUNITY_WON: "Oportunidade ganha",
  OPPORTUNITY_LOST: "Oportunidade perdida",
  TASK_CREATED: "Tarefa criada",
  TASK_COMPLETED: "Tarefa concluída",
  TASK_OVERDUE: "Tarefa atrasada",
  MEETING_CREATED: "Reunião criada",
  MEETING_COMPLETED: "Reunião concluída",
  MEETING_CANCELLED: "Reunião cancelada",
  TAG_ADDED_TO_CONTACT: "Etiqueta adicionada ao contato",
  TAG_ADDED_TO_OPPORTUNITY: "Etiqueta adicionada à oportunidade",
  OPPORTUNITY_IDLE: "Oportunidade parada",
  TASK_DUE: "Tarefa próxima",
  FOLLOWUP_DUE: "Follow-up próximo",
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_OPPORTUNITY: "Criar oportunidade",
  MOVE_OPPORTUNITY_STAGE: "Mover estágio",
  ASSIGN_OPPORTUNITY: "Atribuir vendedor",
  ADD_CONTACT_TAG: "Adicionar etiqueta ao contato",
  REMOVE_CONTACT_TAG: "Remover etiqueta do contato",
  ADD_OPPORTUNITY_TAG: "Adicionar etiqueta à oportunidade",
  REMOVE_OPPORTUNITY_TAG: "Remover etiqueta da oportunidade",
  CREATE_TASK: "Criar tarefa",
  CREATE_FOLLOWUP: "Criar follow-up",
  CREATE_MEETING: "Criar reunião",
  UPDATE_OPPORTUNITY: "Atualizar oportunidade",
  CREATE_ACTIVITY_LOG: "Registrar atividade",
  NOTIFY_USER: "Notificar usuário",
  SEND_WHATSAPP_MESSAGE: "Enviar WhatsApp",
}

// ---------------------------------------------------------------------------
// Automation Card
// ---------------------------------------------------------------------------

function AutomationCard({
  rule,
  onToggle,
  onDelete,
  onViewHistory,
}: {
  rule: AutomationRule
  onToggle: (rule: AutomationRule) => void
  onDelete: (rule: AutomationRule) => void
  onViewHistory: (rule: AutomationRule) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className={cn("transition-colors", !rule.is_active && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-full", rule.is_active ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400")}>
              {rule.is_active ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
            </div>
            <div>
              <p className="font-medium">{rule.name}</p>
              <p className="text-xs text-muted-foreground">
                Quando: {TRIGGER_LABELS[rule.trigger_type] ?? rule.trigger_type}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={rule.is_active ? "success" : "secondary"}>
              {rule.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onToggle(rule)}>
                  {rule.is_active ? <ZapOff className="mr-2 h-3 w-3" /> : <Zap className="mr-2 h-3 w-3" />}
                  {rule.is_active ? "Desativar" : "Ativar"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onViewHistory(rule)}>
                  <History className="mr-2 h-3 w-3" /> Histórico
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete(rule)} className="text-destructive">
                  <Trash2 className="mr-2 h-3 w-3" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Summary */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {rule.conditions.length > 0 && (
            <span className="rounded bg-muted px-2 py-1">
              Se: {rule.conditions.length} condição(ões) ({rule.condition_logic})
            </span>
          )}
          <span className="rounded bg-muted px-2 py-1">
            Então: {rule.actions.length} ação(ões)
          </span>
        </div>

        {/* Expand details */}
        <button
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Ocultar" : "Detalhes"}
        </button>

        {expanded && (
          <div className="mt-3 space-y-2 text-xs">
            {rule.description && <p className="text-muted-foreground">{rule.description}</p>}

            {rule.conditions.length > 0 && (
              <div>
                <p className="font-medium">Condições ({rule.condition_logic}):</p>
                <ul className="ml-4 list-disc">
                  {rule.conditions.map((c, i) => (
                    <li key={i}>{c.field} {c.operator} {String(c.value)}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="font-medium">Ações:</p>
              <ul className="ml-4 list-disc">
                {rule.actions.map((a, i) => (
                  <li key={i}>{ACTION_LABELS[a.type] ?? a.type}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Execution History Dialog
// ---------------------------------------------------------------------------

function ExecutionHistoryDialog({
  open,
  onOpenChange,
  executions,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  executions: AutomationExecution[]
}) {
  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="h-4 w-4 text-green-600" />
    if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" />
    if (status === "skipped") return <AlertTriangle className="h-4 w-4 text-yellow-600" />
    return <Clock className="h-4 w-4 text-muted-foreground" />
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Histórico de Execuções</DialogTitle>
        </DialogHeader>
        {executions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma execução registrada.</p>
        ) : (
          <div className="space-y-2">
            {executions.map((exec) => (
              <div key={exec.id} className="flex items-start gap-3 rounded-lg border p-3">
                {statusIcon(exec.status)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{exec.trigger_event}</span>
                    <Badge variant={exec.status === "completed" ? "success" : exec.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                      {exec.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(exec.started_at).toLocaleString("pt-BR")}
                  </p>
                  {exec.actions_log && exec.actions_log.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {exec.actions_log.map((log, i) => (
                        <Badge key={i} variant={log.status === "completed" ? "success" : "destructive"} className="text-[10px]">
                          {log.type}: {log.status}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {exec.error && (
                    <p className="mt-1 text-xs text-destructive">{exec.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main Automations Page
// ---------------------------------------------------------------------------

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyExecutions, setHistoryExecutions] = useState<AutomationExecution[]>([])

  const loadRules = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from("automation_rules")
      .select("*")
      .order("created_at", { ascending: false })
    setRules((data as AutomationRule[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const handleToggle = async (rule: AutomationRule) => {
    const { error } = await supabase
      .from("automation_rules")
      .update({ is_active: !rule.is_active })
      .eq("id", rule.id)
    if (error) { toast.error(error.message); return }
    toast.success(rule.is_active ? "Automação desativada" : "Automação ativada")
    loadRules()
  }

  const handleDelete = async (rule: AutomationRule) => {
    if (!window.confirm(`Excluir a automação "${rule.name}"?`)) return
    const { error } = await supabase.from("automation_rules").delete().eq("id", rule.id)
    if (error) { toast.error(error.message); return }
    toast.success("Automação excluída")
    loadRules()
  }

  const handleViewHistory = async (rule: AutomationRule) => {
    const { data } = await supabase
      .from("automation_executions")
      .select("*")
      .eq("automation_id", rule.id)
      .order("created_at", { ascending: false })
      .limit(50)
    setHistoryExecutions((data as AutomationExecution[]) ?? [])
    setHistoryOpen(true)
  }

  const activeCount = rules.filter((r) => r.is_active).length

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Automações</h1>
          <Badge variant="secondary">{rules.length} regra(s)</Badge>
          {activeCount > 0 && <Badge variant="success">{activeCount} ativa(s)</Badge>}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Zap className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Nenhuma automação</p>
            <p className="text-sm text-muted-foreground">Automações aparecerão aqui quando configuradas.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <AutomationCard
                key={rule.id}
                rule={rule}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onViewHistory={handleViewHistory}
              />
            ))}
          </div>
        )}
      </div>

      <ExecutionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        executions={historyExecutions}
      />
    </div>
  )
}
