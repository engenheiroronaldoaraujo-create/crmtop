import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  Search,
  Loader2,
  MessageCircle,
  Check,
  Copy,
  Eye,
  ChevronUp,
} from "lucide-react"

import { supabase } from "@/lib/supabase"
import type { PipelineStage } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InspectorParams {
  stalled_days: number
  history_days: number
  include_closed: boolean
  stage_ids: string[]
  stall_reasons: string[]
  action_mode: "report_only" | "create_task" | "suggest_message"
}

interface InsightResult {
  insight_id: string
  opportunity_id: string | null
  conversation_id: string
  contact_id: string
  contact_name: string
  contact_phone: string | null
  opp_title: string | null
  stage_name: string | null
  type: "opportunity" | "orphan"
  assigned_to: string | null
  status: string
  stall_reason: string
  priority: "high" | "medium" | "low"
  days_stalled: number
  ai_summary: string
  ai_suggestion: string
  suggested_message: string | null
}

const STALL_REASONS: Record<string, string> = {
  meeting_no_feedback: "Reuniao/demo sem feedback",
  proposal_no_response: "Proposta sem resposta",
  interest_no_next_step: "Interesse sem proximo passo",
  unhandled_objection: "Objecao nao tratada",
  ghost: "Cliente sumiu",
  no_human_followup: "Handoff da Sofia sem follow-up humano",
  unknown: "Outro motivo",
}

const PRIORITY_LABEL: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baixa",
}

const PRIORITY_COLOR: Record<string, string> = {
  high: "text-red-600 bg-red-50 border-red-200",
  medium: "text-yellow-600 bg-yellow-50 border-yellow-200",
  low: "text-blue-600 bg-blue-50 border-blue-200",
}

// ---------------------------------------------------------------------------
// Toggle chip component
// ---------------------------------------------------------------------------

function ToggleChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string
  active: boolean
  onClick: () => void
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: active ? color : "#d1d5db" }}
        />
      )}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export function DealInspectorDialog({
  open,
  onOpenChange,
  stages,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  stages: PipelineStage[]
}) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<"config" | "loading" | "results">("config")
  const [loadingMsg, setLoadingMsg] = useState("")
  const [results, setResults] = useState<InsightResult[]>([])
  const [summary, setSummary] = useState({ total: 0, analyzed: 0, errors: 0 })

  // Config state
  const [stalledDays, setStalledDays] = useState(3)
  const [historyDays, setHistoryDays] = useState(30)
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [selectedReasons, setSelectedReasons] = useState<string[]>(Object.keys(STALL_REASONS))
  const [actionMode, setActionMode] = useState<"report_only" | "create_task" | "suggest_message">("report_only")

  // Result detail
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPhase("config")
      setResults([])
      setSummary({ total: 0, analyzed: 0, errors: 0 })
      setExpandedId(null)
    }
  }, [open])

  const toggleStage = (id: string) => {
    setSelectedStages((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const toggleReason = (key: string) => {
    setSelectedReasons((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]
    )
  }

  const handleSearch = useCallback(async () => {
    setPhase("loading")
    setLoadingMsg("Buscando candidatos...")

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        toast.error("Sessao expirada")
        setPhase("config")
        return
      }

      const params: InspectorParams = {
        stalled_days: stalledDays,
        history_days: historyDays,
        include_closed: includeClosed,
        stage_ids: selectedStages,
        stall_reasons: selectedReasons,
        action_mode: actionMode,
      }

      setLoadingMsg(`Analisando conversas...`)

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deal-inspector`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(params),
        }
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json()
      setResults(data.insights ?? [])
      setSummary(data.summary ?? { total: 0, analyzed: 0, errors: 0 })
      setPhase("results")
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao executar Deal Inspector")
      setPhase("config")
    }
  }, [stalledDays, historyDays, includeClosed, selectedStages, selectedReasons, actionMode])

  const handleCreateTask = async (insight: InsightResult) => {
    const dueAt = new Date()
    dueAt.setHours(dueAt.getHours() + 24)

    const { error } = await supabase.from("opportunity_tasks").insert({
      opportunity_id: insight.opportunity_id,
      contact_id: insight.contact_id,
      assigned_to: insight.assigned_to,
      title: insight.ai_suggestion,
      task_type: "follow_up",
      due_at: dueAt.toISOString(),
      priority: insight.priority === "high" ? "high" : "normal",
    })

    if (error) {
      toast.error("Erro ao criar tarefa")
      return
    }

    // Mark insight as actioned
    await supabase
      .from("deal_insights")
      .update({ action_taken: "task_created", actioned_at: new Date().toISOString() })
      .eq("id", insight.insight_id)

    toast.success("Tarefa criada")
  }

  const handleDismiss = async (insight: InsightResult) => {
    await supabase
      .from("deal_insights")
      .update({ action_taken: "dismissed", actioned_at: new Date().toISOString() })
      .eq("id", insight.insight_id)

    setResults((prev) => prev.filter((r) => r.insight_id !== insight.insight_id))
    toast.success("Dispensado")
  }

  const handleCopyMessage = (msg: string) => {
    navigator.clipboard.writeText(msg)
    toast.success("Mensagem copiada")
  }

  const highInsights = results.filter((r) => r.priority === "high")
  const mediumInsights = results.filter((r) => r.priority === "medium")
  const lowInsights = results.filter((r) => r.priority === "low")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {phase === "results" ? "Resultados da Busca" : "Vasculhar Oportunidades"}
          </DialogTitle>
        </DialogHeader>

        {/* ---- CONFIG PHASE ---- */}
        {phase === "config" && (
          <div className="flex-1 overflow-auto space-y-5 pr-1">
            {/* Period */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Periodo</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Paradas ha mais de (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={stalledDays}
                    onChange={(e) => setStalledDays(parseInt(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Janela de historico (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={historyDays}
                    onChange={(e) => setHistoryDays(parseInt(e.target.value) || 30)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Options */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Opcoes</h4>
              <ToggleCheck label="Incluir oportunidades encerradas (ganhos/perdidos)" active={includeClosed} onClick={() => setIncludeClosed(!includeClosed)} />
            </div>

            <Separator />

            {/* Stages */}
            {stages.length > 0 && (
              <>
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Estagios</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {stages.map((s) => (
                      <ToggleChip
                        key={s.id}
                        label={s.name}
                        active={selectedStages.length === 0 || selectedStages.includes(s.id)}
                        color={s.color ?? undefined}
                        onClick={() => toggleStage(s.id)}
                      />
                    ))}
                  </div>
                  {selectedStages.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setSelectedStages([])}
                    >
                      Limpar selecao (todos)
                    </button>
                  )}
                </div>
                <Separator />
              </>
            )}

            {/* Stall reasons */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">O que procurar</h4>
              <div className="space-y-2">
                {Object.entries(STALL_REASONS).map(([key, label]) => (
                  <ToggleCheck
                    key={key}
                    label={label}
                    active={selectedReasons.includes(key)}
                    onClick={() => toggleReason(key)}
                  />
                ))}
              </div>
            </div>

            <Separator />

            {/* Action mode */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Acao ao encontrar</h4>
              <Select value={actionMode} onValueChange={(v: any) => setActionMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="report_only">So mostrar relatorio</SelectItem>
                  <SelectItem value="create_task">Criar tarefa para o responsavel</SelectItem>
                  <SelectItem value="suggest_message">Sugerir mensagem de follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* ---- LOADING PHASE ---- */}
        {phase === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{loadingMsg}</p>
          </div>
        )}

        {/* ---- RESULTS PHASE ---- */}
        {phase === "results" && (
          <div className="flex-1 overflow-auto space-y-4 pr-1">
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <Check className="h-10 w-10 text-green-500" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma conversa parada encontrada com os filtros selecionados.
                </p>
                {summary.errors > 0 && (
                  <p className="text-xs text-red-500">{summary.errors} erro(s) durante a analise.</p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{summary.analyzed} achado(s) de {summary.total} conversa(s) analisada(s)</span>
                  {summary.errors > 0 && (
                    <span className="text-red-500">· {summary.errors} erro(s)</span>
                  )}
                </div>

                {highInsights.length > 0 && (
                  <InsightGroup
                    title="ALTA PRIORIDADE"
                    titleColor="text-red-600"
                    insights={highInsights}
                    expandedId={expandedId}
                    onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                    onNavigate={(convId) => { onOpenChange(false); navigate(`/?conversation=${convId}`) }}
                    onCreateTask={handleCreateTask}
                    onDismiss={handleDismiss}
                    onCopy={handleCopyMessage}
                  />
                )}

                {mediumInsights.length > 0 && (
                  <InsightGroup
                    title="MEDIA PRIORIDADE"
                    titleColor="text-yellow-600"
                    insights={mediumInsights}
                    expandedId={expandedId}
                    onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                    onNavigate={(convId) => { onOpenChange(false); navigate(`/?conversation=${convId}`) }}
                    onCreateTask={handleCreateTask}
                    onDismiss={handleDismiss}
                    onCopy={handleCopyMessage}
                  />
                )}

                {lowInsights.length > 0 && (
                  <InsightGroup
                    title="BAIXA PRIORIDADE"
                    titleColor="text-blue-600"
                    insights={lowInsights}
                    expandedId={expandedId}
                    onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                    onNavigate={(convId) => { onOpenChange(false); navigate(`/?conversation=${convId}`) }}
                    onCreateTask={handleCreateTask}
                    onDismiss={handleDismiss}
                    onCopy={handleCopyMessage}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ---- FOOTER ---- */}
        <DialogFooter>
          {phase === "config" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSearch}>
                <Search className="mr-2 h-4 w-4" />
                Iniciar Busca
              </Button>
            </>
          )}
          {phase === "loading" && (
            <Button variant="outline" disabled>
              Analisando...
            </Button>
          )}
          {phase === "results" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button variant="outline" onClick={() => setPhase("config")}>
                Nova busca
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ToggleCheck (simple checkbox replacement)
// ---------------------------------------------------------------------------

function ToggleCheck({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 text-sm"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30 bg-background"
        }`}
      >
        {active && <Check className="h-3 w-3" />}
      </span>
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// InsightGroup
// ---------------------------------------------------------------------------

function InsightGroup({
  title,
  titleColor,
  insights,
  expandedId,
  onToggleExpand,
  onNavigate,
  onCreateTask,
  onDismiss,
  onCopy,
}: {
  title: string
  titleColor: string
  insights: InsightResult[]
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onNavigate: (conversationId: string) => void
  onCreateTask: (insight: InsightResult) => void
  onDismiss: (insight: InsightResult) => void
  onCopy: (msg: string) => void
}) {
  return (
    <div className="space-y-2">
      <h4 className={`text-xs font-bold uppercase tracking-wider ${titleColor}`}>
        {title}
      </h4>
      {insights.map((insight) => (
        <InsightCard
          key={insight.insight_id}
          insight={insight}
          expanded={expandedId === insight.insight_id}
          onToggleExpand={() => onToggleExpand(insight.insight_id)}
          onNavigate={() => onNavigate(insight.conversation_id)}
          onCreateTask={() => onCreateTask(insight)}
          onDismiss={() => onDismiss(insight)}
          onCopy={() => insight.suggested_message && onCopy(insight.suggested_message)}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// InsightCard
// ---------------------------------------------------------------------------

function InsightCard({
  insight,
  expanded,
  onToggleExpand,
  onNavigate,
  onCreateTask,
  onDismiss,
  onCopy,
}: {
  insight: InsightResult
  expanded: boolean
  onToggleExpand: () => void
  onNavigate: () => void
  onCreateTask: () => void
  onDismiss: () => void
  onCopy: () => void
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">
            {insight.contact_name}
            {insight.opp_title && (
              <span className="font-normal text-muted-foreground">
                {" · "}{insight.opp_title}
              </span>
            )}
            {insight.stage_name && (
              <span className="font-normal text-muted-foreground">
                {" · "}{insight.stage_name}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {insight.days_stalled} dia(s) parado
          </p>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] ${PRIORITY_COLOR[insight.priority]}`}
        >
          {PRIORITY_LABEL[insight.priority]}
        </Badge>
      </div>

      {/* Summary */}
      <p className="text-sm text-muted-foreground">
        {insight.ai_summary}
      </p>

      {/* Suggestion */}
      <p className="text-sm font-medium">
        {insight.ai_suggestion}
      </p>

      {/* Expanded: suggested message */}
      {expanded && insight.suggested_message && (
        <div className="rounded-md bg-muted/50 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            Mensagem sugerida
          </p>
          <p className="text-sm whitespace-pre-wrap">
            {insight.suggested_message}
          </p>
          <Button size="sm" variant="outline" onClick={onCopy}>
            <Copy className="mr-1 h-3 w-3" /> Copiar
          </Button>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button size="sm" variant="outline" onClick={onNavigate}>
          <MessageCircle className="mr-1 h-3 w-3" /> Ver conversa
        </Button>
        {insight.opportunity_id && (
          <Button size="sm" variant="outline" onClick={onCreateTask}>
            <Check className="mr-1 h-3 w-3" /> Criar tarefa
          </Button>
        )}
        {insight.suggested_message && (
          <Button size="sm" variant="outline" onClick={onToggleExpand}>
            {expanded ? (
              <><ChevronUp className="mr-1 h-3 w-3" /> Ocultar</>
            ) : (
              <><Eye className="mr-1 h-3 w-3" /> Ver mensagem</>
            )}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onDismiss}>
          Dispensar
        </Button>
      </div>
    </div>
  )
}
