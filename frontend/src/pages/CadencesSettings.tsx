import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Layers, Pencil, Plus, Send, Timer, Trash2 } from "lucide-react"

import {
  useCadences,
  useCadenceSteps,
} from "@/hooks/use-cadences"
import { usePipelines } from "@/hooks/use-commercial"
import { useAuth } from "@/hooks/use-auth"
import type { Cadence, CadenceStep, MessageTemplate, PipelineStage } from "@/lib/types"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea"

// ---------------------------------------------------------------------------
// Utilidades
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

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

type CadenceForm = {
  id: string | null
  name: string
  description: string
  pipeline_id: string
  trigger_stage_id: string
  skip_weekends: boolean
  is_active: boolean
}

const EMPTY_FORM: CadenceForm = {
  id: null,
  name: "",
  description: "",
  pipeline_id: "",
  trigger_stage_id: "",
  skip_weekends: true,
  is_active: true,
}

export default function CadencesSettings() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === "admin"

  const { cadences, loading, create, update, remove } = useCadences()
  const { pipelines } = usePipelines()
  const { stages } = useAllStages()

  const [configForm, setConfigForm] = useState<CadenceForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingSteps, setEditingSteps] = useState<Cadence | null>(null)

  const stagesForPipeline = (pipelineId: string) =>
    stages.filter((s) => s.pipeline_id === pipelineId)

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Área restrita a administradores.</p>
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!configForm) return
    if (!configForm.name.trim() || !configForm.pipeline_id || !configForm.trigger_stage_id) {
      toast.error("Preencha o nome e selecione pipeline/estágio gatilho")
      return
    }
    setSaving(true)
    try {
      if (configForm.id) {
        await update(configForm.id, {
          name: configForm.name.trim(),
          description: configForm.description.trim() || null,
          pipeline_id: configForm.pipeline_id,
          trigger_stage_id: configForm.trigger_stage_id,
          skip_weekends: configForm.skip_weekends,
          is_active: configForm.is_active,
        })
        toast.success("Cadência atualizada")
      } else {
        await create({
          name: configForm.name.trim(),
          description: configForm.description.trim() || null,
          pipeline_id: configForm.pipeline_id,
          trigger_stage_id: configForm.trigger_stage_id,
          skip_weekends: configForm.skip_weekends,
          is_active: configForm.is_active,
        })
        toast.success("Cadência criada — agora adicione as etapas")
      }
      setConfigForm(null)
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao salvar cadência")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: Cadence) {
    if (!window.confirm(`Excluir a cadência "${c.name}"? Os leads matriculados perdem o vínculo.`)) return
    try {
      await remove(c.id)
      toast.success("Cadência excluída")
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao excluir cadência")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Cadências</h2>
          <p className="text-sm text-muted-foreground">
            Sequências automáticas que movem oportunidades no Pipeline e disparam mensagens WhatsApp.
          </p>
        </div>
        <Button onClick={() => setConfigForm({ ...EMPTY_FORM, pipeline_id: pipelines[0]?.id ?? "" })}>
          <Plus className="mr-2 h-4 w-4" /> Nova cadência
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : cadences.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Layers className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhuma cadência configurada</p>
            <p className="text-xs text-muted-foreground">
              Crie uma cadência e defina as etapas: cada etapa move o lead para um estágio do pipeline,
              opcionalmente enviando mensagem de WhatsApp.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {cadences.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <Badge variant={c.is_active ? "default" : "outline"}>
                      {c.is_active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    Pipeline: {c.pipeline?.name ?? "—"} · Gatilho: {c.trigger_stage?.name ?? "—"}
                    {c.skip_weekends ? " · pula fim de semana" : ""}
                  </p>
                  {c.description && (
                    <p className="truncate text-xs text-muted-foreground">{c.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setEditingSteps(c)}>
                    <Timer className="mr-2 h-3.5 w-3.5" /> Etapas
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Editar cadência"
                    onClick={() =>
                      setConfigForm({
                        id: c.id,
                        name: c.name,
                        description: c.description ?? "",
                        pipeline_id: c.pipeline_id,
                        trigger_stage_id: c.trigger_stage_id,
                        skip_weekends: c.skip_weekends,
                        is_active: c.is_active,
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={configForm !== null} onOpenChange={(open) => !open && setConfigForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{configForm?.id ? "Editar cadência" : "Nova cadência"}</DialogTitle>
            <DialogDescription>
              Leads que entrarem no estágio gatilho entram automaticamente na sequência.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cad-name">Nome</Label>
              <Input
                id="cad-name"
                value={configForm?.name ?? ""}
                onChange={(e) =>
                  setConfigForm((f) => (f ? { ...f, name: e.target.value } : f))
                }
                placeholder="Onboarding de leads novos"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cad-desc">Descrição</Label>
              <Input
                id="cad-desc"
                value={configForm?.description ?? ""}
                onChange={(e) =>
                  setConfigForm((f) => (f ? { ...f, description: e.target.value } : f))
                }
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select
                value={configForm?.pipeline_id ?? ""}
                onValueChange={(v) =>
                  setConfigForm((f) => (f ? { ...f, pipeline_id: v, trigger_stage_id: "" } : f))
                }
              >
                <SelectTrigger><SelectValue placeholder="Selecione o pipeline" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estágio gatilho (entrada)</Label>
              <Select
                value={configForm?.trigger_stage_id ?? ""}
                onValueChange={(v) =>
                  setConfigForm((f) => (f ? { ...f, trigger_stage_id: v } : f))
                }
                disabled={!configForm?.pipeline_id}
              >
                <SelectTrigger><SelectValue placeholder="Selecione o estágio" /></SelectTrigger>
                <SelectContent>
                  {stagesForPipeline(configForm?.pipeline_id ?? "").map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label>Pular fim de semana</Label>
                <p className="text-xs text-muted-foreground">
                  Execuções agendadas para sáb/dom passam para segunda-feira.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={configForm?.skip_weekends ?? true}
                onChange={(e) =>
                  setConfigForm((f) => (f ? { ...f, skip_weekends: e.target.checked } : f))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label>Cadência ativa</Label>
                <p className="text-xs text-muted-foreground">
                  Cadências inativas não matriculam novos leads.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={configForm?.is_active ?? true}
                onChange={(e) =>
                  setConfigForm((f) => (f ? { ...f, is_active: e.target.checked } : f))
                }
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfigForm(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : configForm?.id ? "Salvar" : "Criar cadência"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {editingSteps && (
        <CadenceStepsEditor cadence={editingSteps} onDone={() => setEditingSteps(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor de etapas
// ---------------------------------------------------------------------------

type StepForm = {
  id: string | null
  step_order: number
  stage_id: string
  delay_days: number
  send_message: boolean
  template_id: string
  message_text: string
}

function CadenceStepsEditor({
  cadence,
  onDone,
}: {
  cadence: Cadence
  onDone: () => void
}) {
  const { steps, loading, refresh, insert, update, remove } = useCadenceSteps(cadence.id)
  const { stages } = useAllStages()
  const templates = useActiveTemplates()
  const [form, setForm] = useState<StepForm | null>(null)
  const [saving, setSaving] = useState(false)

  const pipelineStages = stages.filter((s) => s.pipeline_id === cadence.pipeline_id)

  function openNewStep() {
    const used = new Set(steps.map((s) => s.stage_id))
    const free = pipelineStages.find((s) => !used.has(s.id)) ?? pipelineStages[0]
    setForm({
      id: null,
      step_order: steps.length + 1,
      stage_id: free?.id ?? "",
      delay_days: 2,
      send_message: false,
      template_id: "",
      message_text: "",
    })
  }

  async function handleStepSave(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.stage_id) {
      toast.error("Selecione o estágio de destino")
      return
    }
    if (form.send_message && !form.template_id && !form.message_text.trim()) {
      toast.error("Configure um template ou um texto para a mensagem")
      return
    }
    setSaving(true)
    try {
      const payload = {
        stage_id: form.stage_id,
        delay_days: form.delay_days,
        send_message: form.send_message,
        template_id: form.template_id || null,
        message_text: form.message_text.trim() || null,
      }
      if (form.id) {
        await update(form.id, payload)
      } else {
        await insert({ cadence_id: cadence.id, step_order: form.step_order, ...payload })
      }
      toast.success("Etapa salva")
      setForm(null)
      await refresh()
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao salvar etapa")
    } finally {
      setSaving(false)
    }
  }

  async function handleStepDelete(step: CadenceStep) {
    if (!window.confirm("Excluir esta etapa?")) return
    try {
      await remove(step.id)
      await refresh()
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao excluir etapa")
    }
  }

  async function handleMove(step: CadenceStep, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === step.id)
    const swap = steps[idx + dir]
    if (!swap) return
    const a = step.step_order
    const b = swap.step_order
    try {
      await update(step.id, { step_order: b })
      await update(swap.id, { step_order: a })
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao reordenar")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Etapas — {cadence.name}</DialogTitle>
          <DialogDescription>
            Cada etapa move o lead para um estágio do pipeline após N dias desde a etapa anterior.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {loading ? (
            <Skeleton className="h-12 w-full" />
          ) : steps.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma etapa. Adicione a primeira.
            </p>
          ) : (
            steps.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-3 rounded-md border p-3">
                <span className="w-6 text-center text-sm font-bold text-muted-foreground">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1 text-sm font-medium">
                    {step.stage?.name ?? "estágio"}
                    <Badge variant="outline" className="ml-1">
                      <Timer className="mr-1 h-3 w-3" />
                      em {step.delay_days} {step.delay_days === 1 ? "dia" : "dias"}
                    </Badge>
                    {step.send_message && (
                      <Badge variant="outline" className="ml-1">
                        <Send className="mr-1 h-3 w-3" /> WhatsApp
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {step.template?.title ?? step.message_text ?? "sem mensagem"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={idx === 0}
                  onClick={() => handleMove(step, -1)}
                  title="Subir"
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={idx === steps.length - 1}
                  onClick={() => handleMove(step, 1)}
                  title="Descer"
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Editar etapa"
                  onClick={() =>
                    setForm({
                      id: step.id,
                      step_order: step.step_order,
                      stage_id: step.stage_id,
                      delay_days: step.delay_days,
                      send_message: step.send_message,
                      template_id: step.template_id ?? "",
                      message_text: step.message_text ?? "",
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleStepDelete(step)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={openNewStep} disabled={pipelineStages.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> Adicionar etapa
          </Button>
        </div>

        <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form?.id ? "Editar etapa" : `Etapa ${form?.step_order ?? ""}`}</DialogTitle>
              <DialogDescription>
                O lead entra neste estágio após o atraso configurado.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleStepSave} className="space-y-4">
              <div className="space-y-2">
                <Label>Estágio de destino</Label>
                <Select
                  value={form?.stage_id ?? ""}
                  onValueChange={(v) => setForm((f) => (f ? { ...f, stage_id: v } : f))}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione o estágio" /></SelectTrigger>
                  <SelectContent>
                    {pipelineStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="step-delay">Atraso (dias desde a etapa anterior)</Label>
                <Input
                  id="step-delay"
                  type="number"
                  min={0}
                  max={365}
                  value={form?.delay_days ?? 1}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, delay_days: Math.max(0, Number(e.target.value)) } : f))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label>Ao entrar, enviar WhatsApp</Label>
                  <p className="text-xs text-muted-foreground">
                    Dispara mensagem automática ao mover o lead para este estágio.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={form?.send_message ?? false}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, send_message: e.target.checked } : f))
                  }
                />
              </div>
              {form?.send_message && (
                <div className="space-y-2">
                  <Label>Mensagem</Label>
                  <Select
                    value={form.template_id}
                    onValueChange={(v) => setForm({ ...form, template_id: v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar template (opcional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">— Texto livre —</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!form.template_id && (
                    <Textarea
                      rows={3}
                      value={form.message_text}
                      onChange={(e) => setForm({ ...form, message_text: e.target.value })}
                      placeholder="Olá {{contact.name}}, passando para saber como está..."
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Variáveis: {"{{contact.name}}"} ou {"{{contact_name}}"}
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar etapa"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
