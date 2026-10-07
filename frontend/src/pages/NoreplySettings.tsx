import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Clock, History, MessageCircleQuestion, Plus, Timer, Trash2 } from "lucide-react"

import {
  useNoreplyAttempts,
  useNoreplyPipelineConfigs,
  useNoreplySettings,
} from "@/hooks/use-noreply"
import { usePipelines } from "@/hooks/use-commercial"
import { useAuth } from "@/hooks/use-auth"
import type { MessageTemplate, NoreplySettings, PipelineStage } from "@/lib/types"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useAllStages(activeOnly = true) {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let q = supabase.from("pipeline_stages").select("*")
    if (activeOnly) q = q.eq("is_active", true)
    q.order("position").then(({ data }) => {
      setStages(data ?? [])
      setLoading(false)
    })
  }, [activeOnly])

  return { stages, loading }
}

function useActiveTemplates() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])

  useEffect(() => {
    supabase
      .from("message_templates")
      .select("id, title, body, is_active")
      .eq("is_active", true)
      .order("title")
      .then(({ data }) => setTemplates((data as MessageTemplate[]) ?? []))
  }, [])

  return templates
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="space-y-0.5 pr-4">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
      />
    </div>
  )
}

function formatDelay(hours: number): string {
  if (hours % 24 === 0) {
    const d = hours / 24
    return d === 1 ? "1 dia" : `${d} dias`
  }
  return `${hours}h`
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function NoreplySettings() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"

  const { settings, loading: loadingSettings, update } = useNoreplySettings()
  const { attempts, loading: loadingAttempts, insert, update: updateAttempt, remove } =
    useNoreplyAttempts()
  const { configs, loading: loadingConfigs, update: updateConfig } = useNoreplyPipelineConfigs()
  const { pipelines } = usePipelines()
  const { stages } = useAllStages()
  const templates = useActiveTemplates()

  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [backfillDays, setBackfillDays] = useState(30)
  const [backfillRunning, setBackfillRunning] = useState(false)

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Área restrita a administradores.</p>
  }

  async function saveSettings(patch: Partial<NoreplySettings>, key: string) {
    setSavingKey(key)
    try {
      await update(patch)
      toast.success("Configuração salva")
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao salvar")
    } finally {
      setSavingKey(null)
    }
  }

  async function handleToggleActive(next: boolean) {
    if (
      next &&
      !window.confirm(
        "Ativar a régua de follow-up?\n\n" +
          "Conversas com oportunidade aberta onde o lead ficou em silêncio " +
          "receberão automaticamente as mensagens configuradas abaixo. " +
          "Sem resposta após todas as tentativas, o card vai para o estágio de destino.",
      )
    ) {
      return
    }
    await saveSettings({ is_active: next }, "is_active")
  }

  async function handleAddAttempt() {
    const nextNumber = attempts.length > 0 ? Math.max(...attempts.map((a) => a.attempt_number)) + 1 : 1
    const lastDelay = attempts.length > 0 ? attempts[attempts.length - 1].delay_hours : 24
    try {
      await insert({
        attempt_number: nextNumber,
        delay_hours: lastDelay * 2 > 24 ? lastDelay * 2 : 24,
        message_text: "",
      })
      toast.success(`Tentativa ${nextNumber} adicionada`)
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao adicionar tentativa")
    }
  }

  async function handleRemoveAttempt(id: string, attemptNumber: number) {
    if (!window.confirm(`Excluir a tentativa ${attemptNumber}?`)) return
    try {
      await remove(id)
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao excluir tentativa")
    }
  }

  async function handleBackfill() {
    if (!settings?.is_active) {
      toast.error("Ative a régua antes de rodar o backfill")
      return
    }
    const days = Math.min(365, Math.max(1, backfillDays || 30))
    const firstDelay = attempts.find((a) => a.is_active)?.delay_hours ?? 24
    if (
      !window.confirm(
        `Matricular leads com silêncio de até ${days} dias na régua?\n\n` +
          `A 1ª tentativa é agendada para daqui a ${firstDelay}h (horário comercial) — ` +
          `sem rajada: o runner envia no máximo 50 por execução.\n\n` +
          `Contatos com opt-out, SDR IA ativo e cards no estágio de destino ficam de fora.`,
      )
    ) {
      return
    }
    setBackfillRunning(true)
    try {
      const { data, error } = await supabase.rpc("noreply_backfill", {
        p_days: days,
        p_limit: 200,
      })
      if (error) throw error
      const n = Number(data ?? 0)
      toast.success(
        n > 0
          ? `${n} conversa(s) matriculada(s) — primeira tentativa em ~${firstDelay}h`
          : "Nenhuma conversa nova para matricular neste período",
      )
    } catch (err: any) {
      toast.error(err?.message ?? "Falha no backfill")
    } finally {
      setBackfillRunning(false)
    }
  }

  const loading = loadingSettings || loadingAttempts || loadingConfigs

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Follow-up sem resposta</h2>
          <p className="text-sm text-muted-foreground">
            Régua automática de re-engajamento: o SDR responde, o lead fica em silêncio e o sistema
            faz novas perguntas até um limite de tentativas — depois move o card para revisão humana.
          </p>
        </div>
        {settings && (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={settings.is_active ? "default" : "outline"}>
              {settings.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <Button
              variant={settings.is_active ? "outline" : "default"}
              size="sm"
              disabled={savingKey === "is_active"}
              onClick={() => handleToggleActive(!settings.is_active)}
            >
              {savingKey === "is_active" ? "..." : settings.is_active ? "Desativar" : "Ativar régua"}
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !settings ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Configuração não encontrada — aplique a migration 057_noreply_followup.sql.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Regras gerais */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Regras gerais</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ToggleRow
                  label="Só enviar em horário comercial"
                  description="Respeita a tabela de horários em Configurações (business_hours)."
                  checked={settings.business_hours_only}
                  disabled={savingKey === "business_hours_only"}
                  onToggle={(v) => saveSettings({ business_hours_only: v }, "business_hours_only")}
                />
                <ToggleRow
                  label="Pular fim de semana"
                  description="Envios de sábado/domingo passam para o próximo dia útil."
                  checked={settings.skip_weekends}
                  disabled={savingKey === "skip_weekends"}
                  onToggle={(v) => saveSettings({ skip_weekends: v }, "skip_weekends")}
                />
                <ToggleRow
                  label="Nova régua após resposta"
                  description="Se o lead responder e voltar a ficar em silêncio, um novo ciclo começa. Desligado: a conversa nunca reentra."
                  checked={settings.restart_after_reply}
                  disabled={savingKey === "restart_after_reply"}
                  onToggle={(v) => saveSettings({ restart_after_reply: v }, "restart_after_reply")}
                />
                <ToggleRow
                  label="Criar tarefa ao esgotar"
                  description="Cria um follow-up na Agenda para o responsável revisar o card."
                  checked={settings.task_on_exhaust}
                  disabled={savingKey === "task_on_exhaust"}
                  onToggle={(v) => saveSettings({ task_on_exhaust: v }, "task_on_exhaust")}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5 pr-4">
                  <Label>Tolerância final (horas)</Label>
                  <p className="text-xs text-muted-foreground">
                    Após a última tentativa, espera mais N horas de silêncio antes de mover o card
                    para o estágio de destino.
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  defaultValue={settings.exhaust_grace_hours}
                  onBlur={(e) => {
                    const v = Math.max(0, parseInt(e.target.value, 10))
                    if (!Number.isNaN(v) && v !== settings.exhaust_grace_hours) {
                      saveSettings({ exhaust_grace_hours: v }, "exhaust_grace_hours")
                    }
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Tentativas */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Tentativas de follow-up</h3>
                </div>
                <Button variant="outline" size="sm" onClick={handleAddAttempt}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Nova tentativa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Cada tentativa envia a mensagem abaixo após o período de silêncio indicado. Use
                {" "}<code>{"{{contact.name}}"}</code> para o nome do lead. A resposta do lead encerra
                a régua imediatamente.
              </p>
              {attempts.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nenhuma tentativa configurada — a régua não envia mensagens.
                </p>
              ) : (
                <div className="space-y-3">
                  {attempts.map((a) => (
                    <div key={a.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">Tentativa {a.attempt_number}</Badge>
                        <div className="flex items-center gap-1">
                          <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            type="number"
                            min={1}
                            className="h-8 w-20"
                            defaultValue={a.delay_hours}
                            onBlur={(e) => {
                              const v = Math.max(1, parseInt(e.target.value, 10))
                              if (!Number.isNaN(v) && v !== a.delay_hours) {
                                updateAttempt(a.id, { delay_hours: v })
                                  .then(() => toast.success(`Tentativa ${a.attempt_number}: intervalo = ${formatDelay(v)}`))
                                  .catch((err: any) => toast.error(err?.message ?? "Falha ao salvar"))
                              }
                            }}
                          />
                          <span className="text-xs text-muted-foreground">
                            de silêncio (ex.: 24 = 1 dia, 168 = 7 dias)
                          </span>
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            title={a.is_active ? "Tentativa ativa" : "Tentativa desativada"}
                            checked={a.is_active}
                            onChange={(e) =>
                              updateAttempt(a.id, { is_active: e.target.checked })
                                .catch((err: any) => toast.error(err?.message ?? "Falha ao salvar"))
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Excluir tentativa"
                            onClick={() => handleRemoveAttempt(a.id, a.attempt_number)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Template</Label>
                          <Select
                            value={a.template_id ?? "none"}
                            onValueChange={(v) =>
                              updateAttempt(a.id, { template_id: v === "none" ? null : v })
                                .catch((err: any) => toast.error(err?.message ?? "Falha ao salvar"))
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Texto manual (abaixo)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Texto manual (abaixo)</SelectItem>
                              {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Texto da mensagem {a.template_id ? "(usado só sem template)" : ""}
                          </Label>
                          <Textarea
                            rows={2}
                            defaultValue={a.message_text ?? ""}
                            placeholder="Oi {{contact.name}}! Conseguiu ver minha última mensagem?"
                            onBlur={(e) => {
                              if (e.target.value !== (a.message_text ?? "")) {
                                updateAttempt(a.id, { message_text: e.target.value })
                                  .catch((err: any) => toast.error(err?.message ?? "Falha ao salvar"))
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Backfill de leads antigos */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Recuperar leads antigos</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                A régua normal só entra com silêncios de até ~14 dias (anti-rajada). Este botão
                matricula também leads antigos cujo <b>silêncio seja de até a janela</b> abaixo,
                pulando o horizonte. A 1ª tentativa é agendada a partir de <b>agora</b> (não do
                passado) e segue o ritmo normal: máx. 50 envios por execução, horário comercial e
                fim de semana respeitados. Opt-out, SDR IA ativo e card no estágio de destino
                ficam de fora automaticamente.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Silêncio de até (dias)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    className="w-32"
                    value={backfillDays}
                    onChange={(e) =>
                      setBackfillDays(Math.min(365, Math.max(1, parseInt(e.target.value, 10) || 30)))
                    }
                  />
                </div>
                <Button onClick={handleBackfill} disabled={backfillRunning || !settings?.is_active}>
                  {backfillRunning ? (
                    "Matriculando..."
                  ) : (
                    <>
                      <History className="mr-2 h-4 w-4" /> Recuperar agora
                    </>
                  )}
                </Button>
                {!settings?.is_active && (
                  <span className="text-xs text-muted-foreground">
                    Ative a régua acima para usar o backfill.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Estágio de destino por pipeline */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Funis e estágio de destino</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                A régua roda apenas para leads com oportunidade aberta em funis habilitados. Ao
                esgotar as tentativas, o card é movido para o estágio de destino (padrão:
                "Sem Resposta") para um humano analisar e excluir/ganhar manualmente.
              </p>
              {configs.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nenhum funil configurado (a migration 057 cria os padrões).
                </p>
              ) : (
                <div className="space-y-2">
                  {configs.map((cfg) => {
                    const pipelineStages = stages.filter((s) => s.pipeline_id === cfg.pipeline_id)
                    return (
                      <div
                        key={cfg.id}
                        className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-40 flex-1">
                          <p className="text-sm font-medium">
                            {cfg.pipeline?.name ?? pipelines.find((p) => p.id === cfg.pipeline_id)?.name ?? "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {cfg.is_enabled ? "Régua ativa neste funil" : "Régua desativada neste funil"}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          title="Habilitar/desabilitar o funil"
                          checked={cfg.is_enabled}
                          onChange={(e) =>
                            updateConfig(cfg.id, { is_enabled: e.target.checked })
                              .catch((err: any) => toast.error(err?.message ?? "Falha ao salvar"))
                          }
                        />
                        <Select
                          value={cfg.target_stage_id ?? "none"}
                          onValueChange={(v) =>
                            updateConfig(cfg.id, { target_stage_id: v === "none" ? null : v })
                              .catch((err: any) => toast.error(err?.message ?? "Falha ao salvar"))
                          }
                        >
                          <SelectTrigger className="h-8 w-52">
                            <SelectValue placeholder="Estágio de destino" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Não mover (só encerrar)</SelectItem>
                            {pipelineStages.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Detalhes de comportamento: contatos com opt-out nunca recebem mensagens; a régua não roda
            enquanto o SDR IA está no comando da conversa; mensagens manuais do SDR reiniciam o
            relógio sem zerar as tentativas; a resposta do lead encerra o ciclo na hora. O SDR pode
            cancelar a régua de uma conversa direto no chat.
          </p>
        </>
      )}
    </div>
  )
}
