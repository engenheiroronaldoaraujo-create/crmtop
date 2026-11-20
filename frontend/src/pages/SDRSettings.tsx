import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Zap,
  ZapOff,
  Loader2,
  MessageSquare,
  Bot,
  Play,
  Calendar,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react"
import { sdrGetSettings, sdrUpdateSettings, sdrGetMetrics, sdrTestSDR, sdrRequalifyRecent, sdrRequalifyStats } from "@/lib/api"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PRES_DAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"]

// Mesmas opções dos filtros do Chat, para manter os dois painéis em consonância.
const SDR_SOURCES = [
  { value: "ad", label: "Todos os anúncios", hint: "Google Ads e Meta Ads (click-to-WhatsApp)" },
  { value: "campaign", label: "Campanhas", hint: "Origem legada de disparo" },
  { value: "landing", label: "Landing page", hint: "Formulário do site (lead-webhook)" },
  { value: "organic", label: "Orgânico", hint: "Mensagem espontânea" },
  { value: "manual", label: "Manual", hint: "Contato criado no CRM" },
] as const

const SDR_NETWORKS = [
  { value: "google", label: "Google Ads" },
  { value: "meta", label: "Meta Ads" },
] as const

// ---------------------------------------------------------------------------
// Presentation Availability Component
// ---------------------------------------------------------------------------

function PresentationAvailability() {
  const [slots, setSlots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadSlots = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from("presentation_slots").select("*").order("day_of_week")
      setSlots(data ?? [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSlots() }, [loadSlots])

  const handleAddSlot = async (dayOfWeek: number) => {
    try {
      await supabase.from("presentation_slots").insert({ day_of_week: dayOfWeek, start_time: "09:00", end_time: "12:00" })
      toast.success("Horario adicionado")
      loadSlots()
    } catch (e: any) { toast.error(e.message) }
  }

  const handleUpdateSlot = async (id: string, field: string, value: string) => {
    await supabase.from("presentation_slots").update({ [field]: value }).eq("id", id)
    loadSlots()
  }

  const handleToggleSlot = async (id: string, current: boolean) => {
    await supabase.from("presentation_slots").update({ is_active: !current }).eq("id", id)
    loadSlots()
  }

  const handleDeleteSlot = async (id: string) => {
    await supabase.from("presentation_slots").delete().eq("id", id)
    toast.success("Horario removido")
    loadSlots()
  }

  if (loading) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-4 w-4" /> Disponibilidade para Apresentacao</CardTitle>
        <CardDescription>Configure os horarios em que a Sofia pode agendar demonstracoes do AtendaTop.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
          const daySlots = slots.filter((s) => s.day_of_week === dayIdx)
          return (
            <div key={dayIdx} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{PRES_DAYS[dayIdx]}</span>
                <Button variant="ghost" size="sm" onClick={() => handleAddSlot(dayIdx)}>
                  <Plus className="h-3 w-3 mr-1" /> Adicionar
                </Button>
              </div>
              {daySlots.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-2">Sem horarios</p>
              ) : (
                <div className="space-y-1 pl-2">
                  {daySlots.map((slot) => (
                    <div key={slot.id} className="flex items-center gap-2">
                      <Input type="time" value={slot.start_time} onChange={(e) => handleUpdateSlot(slot.id, "start_time", e.target.value)} className="h-7 w-24 text-xs" />
                      <span className="text-xs text-muted-foreground">ate</span>
                      <Input type="time" value={slot.end_time} onChange={(e) => handleUpdateSlot(slot.id, "end_time", e.target.value)} className="h-7 w-24 text-xs" />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleToggleSlot(slot.id, slot.is_active)}>
                        {slot.is_active ? <span className="h-2 w-2 rounded-full bg-green-500" /> : <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteSlot(slot.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SDR Schedule Component (flexible time windows)
// ---------------------------------------------------------------------------

const SDR_DAYS = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"]

function SDRSchedule() {
  const [slots, setSlots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadSlots = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from("sdr_schedule").select("*").order("day_of_week")
      setSlots(data ?? [])
    } catch (e: any) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadSlots() }, [loadSlots])

  const handleAddSlot = async (dayOfWeek: number) => {
    await supabase.from("sdr_schedule").insert({ day_of_week: dayOfWeek, start_time: "09:00", end_time: "18:00" })
    toast.success("Janela adicionada")
    loadSlots()
  }

  const handleUpdate = async (id: string, field: string, value: string) => {
    await supabase.from("sdr_schedule").update({ [field]: value }).eq("id", id)
    loadSlots()
  }

  const handleToggle = async (id: string, active: boolean) => {
    await supabase.from("sdr_schedule").update({ is_active: !active }).eq("id", id)
    loadSlots()
  }

  const handleDelete = async (id: string) => {
    await supabase.from("sdr_schedule").delete().eq("id", id)
    toast.success("Janela removida")
    loadSlots()
  }

  if (loading) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-4 w-4" /> Horario de Atendimento</CardTitle>
        <CardDescription>Configure janelas de horario para o SDR. Cada dia pode ter multiplos periodos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
          const daySlots = slots.filter((s) => s.day_of_week === dayIdx)
          return (
            <div key={dayIdx} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{SDR_DAYS[dayIdx]}</span>
                <Button variant="ghost" size="sm" onClick={() => handleAddSlot(dayIdx)}>
                  <Plus className="h-3 w-3 mr-1" /> Adicionar
                </Button>
              </div>
              {daySlots.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-2">Sem janelas</p>
              ) : (
                <div className="space-y-1 pl-2">
                  {daySlots.map((slot) => (
                    <div key={slot.id} className="flex items-center gap-2">
                      <Input type="time" value={slot.start_time.slice(0, 5)} onChange={(e) => handleUpdate(slot.id, "start_time", e.target.value)} className="h-7 w-24 text-xs" />
                      <span className="text-xs text-muted-foreground">ate</span>
                      <Input type="time" value={slot.end_time.slice(0, 5)} onChange={(e) => handleUpdate(slot.id, "end_time", e.target.value)} className="h-7 w-24 text-xs" />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleToggle(slot.id, slot.is_active)}>
                        {slot.is_active ? <span className="h-2 w-2 rounded-full bg-green-500" /> : <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(slot.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SDR Settings
// ---------------------------------------------------------------------------

export default function SDRSettings() {
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<any>(null)
  const [testMessage, setTestMessage] = useState("")
  const [testResult, setTestResult] = useState<any>(null)
  const [requalifying, setRequalifying] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [requalifyStats, setRequalifyStats] = useState<{ analyzed: number; qualified: number; partial: number; skipped: number; errors: number } | null>(null)
  const [qualStats, setQualStats] = useState<{ conversations?: number; contacts?: number; complete?: number; partial?: number; missing?: number; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await sdrGetSettings()
      setSettings(res.settings)
    } catch (e: any) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [])

  const loadMetrics = useCallback(async () => {
    try {
      const res = await sdrGetMetrics()
      setMetrics(res.metrics)
    } catch {
      // falha ao carregar métricas: mantém vazio, sem quebrar a tela
    }
  }, [])

  useEffect(() => { loadSettings(); loadMetrics() }, [loadSettings, loadMetrics])

  const handleSave = async (patch: Record<string, unknown>) => {
    try {
      await sdrUpdateSettings(patch)
      setSettings({ ...settings, ...patch })
      toast.success("Configuracoes salvas")
    } catch (e: any) {
      // Fallback: se o sdr-engine em produção ainda é o código antigo (sem
      // estes campos no whitelist → 400 "No valid fields to update"), grava
      // direto na tabela (RLS: admin) como fazia a migration 067.
      const msg = String(e?.message ?? "")
      const filterPatch: Record<string, unknown> = {}
      if ("allowed_sources" in patch) filterPatch.allowed_sources = patch.allowed_sources
      if ("allowed_networks" in patch) filterPatch.allowed_networks = patch.allowed_networks
      if (Object.keys(filterPatch).length > 0 && /no valid fields/i.test(msg) && settings?.id) {
        try {
          const { error } = await supabase
            .from("sdr_settings")
            .update(filterPatch)
            .eq("id", settings.id)
          if (error) throw error
          setSettings({ ...settings, ...patch })
          toast.success("Configuracoes salvas")
          return
        } catch (e2: any) {
          toast.error(String(e2?.message ?? msg))
          return
        }
      }
      toast.error(msg)
    }
  }

  const handleKnowledgeFile = async (file: File | null) => {
    if (!file) return
    if (file.size > 512 * 1024) {
      toast.error("Arquivo muito grande (maximo 512 KB)")
      return
    }
    try {
      const text = await file.text()
      await sdrUpdateSettings({ knowledge_base: text })
      setSettings({ ...settings, knowledge_base: text })
      setKnowledgeFile(file)
      toast.success(`Base de conhecimento "${file.name}" anexada`)
    } catch (e: any) { toast.error(e.message) }
  }

  const handleRemoveKnowledge = async () => {
    try {
      await sdrUpdateSettings({ knowledge_base: "" })
      setSettings({ ...settings, knowledge_base: "" })
      setKnowledgeFile(null)
      toast.success("Base de conhecimento removida")
    } catch (e: any) { toast.error(e.message) }
  }

  const handleTest = async () => {
    if (!testMessage.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await sdrTestSDR(testMessage)
      setTestResult(res)
    } catch (e: any) { toast.error(e.message) }
    finally { setTesting(false) }
  }

  const loadQualStats = useCallback(async () => {
    try {
      const res = await sdrRequalifyStats(30)
      setQualStats(res)
    } catch {
      // silencioso: card mostra estado vazio
    }
  }, [])

  useEffect(() => { loadSettings(); loadMetrics(); loadQualStats() }, [loadSettings, loadMetrics, loadQualStats])

  const handleRequalify = async () => {
    setRequalifying(true)
    setRequalifyStats(null)
    setProgress("Iniciando...")
    try {
      let totals = { analyzed: 0, qualified: 0, partial: 0, skipped: 0, errors: 0 }
      for (let round = 1; round <= 50; round++) {
        const res = await sdrRequalifyRecent(30)
        totals = {
          analyzed: totals.analyzed + (res.analyzed ?? 0),
          qualified: totals.qualified + (res.qualified ?? 0),
          partial: totals.partial + (res.partial ?? 0),
          skipped: totals.skipped + (res.skipped ?? 0),
          errors: totals.errors + (res.errors ?? 0),
        }
        setRequalifyStats({ ...totals })
        setProgress(`Rodada ${round}: ${totals.analyzed} contatos analisados...`)
        if ((res.analyzed ?? 0) === 0) break
        await loadQualStats()
      }
      await loadQualStats()
      toast.success(`Requalificação concluída: ${totals.qualified} completo(s), ${totals.partial} parcial(is)`)
    } catch (e: any) { toast.error(e.message) }
    finally {
      setRequalifying(false)
      setProgress(null)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Carregando...</div>
  if (!settings) return <div className="py-8 text-center text-muted-foreground">Erro ao carregar</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SDR IA</h2>
          <p className="text-sm text-muted-foreground">Atendimento inteligente para novos leads</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={settings.enabled ? "success" : "secondary"} className="gap-1">
            {settings.enabled ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
            {settings.enabled ? "ATIVO" : "DESATIVADO"}
          </Badge>
          <Button variant={settings.enabled ? "destructive" : "default"} onClick={() => handleSave({ enabled: !settings.enabled })}>
            {settings.enabled ? "Desativar" : "Ativar SDR IA"}
          </Button>
        </div>
      </div>

      <Separator />

      {metrics && (
        <div className="grid grid-cols-5 gap-3">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Leads hoje</p><p className="text-lg font-bold">{metrics.leads_today}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Qualificados</p><p className="text-lg font-bold">{metrics.qualified}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Demonstracoes</p><p className="text-lg font-bold">{metrics.demos_scheduled}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Retornos</p><p className="text-lg font-bold">{metrics.callbacks_scheduled}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Transferidos</p><p className="text-lg font-bold">{metrics.transfers}</p></CardContent></Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SDRSchedule />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Comportamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><Label className="text-sm">Fora do horario</Label><input type="checkbox" checked={settings.after_hours_enabled} onChange={(e) => handleSave({ after_hours_enabled: e.target.checked })} className="rounded" /></div>
            <div className="flex items-center justify-between"><Label className="text-sm">Retorno humano</Label><input type="checkbox" checked={settings.callback_enabled} onChange={(e) => handleSave({ callback_enabled: e.target.checked })} className="rounded" /></div>
            <div className="flex items-center justify-between"><Label className="text-sm">Limite msgs/conversa</Label><Input type="number" className="w-20 h-8" value={settings.max_messages_per_conversation} onChange={(e) => handleSave({ max_messages_per_conversation: parseInt(e.target.value) || 10 })} /></div>
            <div className="flex items-center justify-between"><Label className="text-sm">Cooldown (seg)</Label><Input type="number" className="w-20 h-8" value={settings.cooldown_seconds} onChange={(e) => handleSave({ cooldown_seconds: parseInt(e.target.value) || 5 })} /></div>
            <div className="flex items-center justify-between"><Label className="text-sm">Duracao reuniao (min)</Label><Input type="number" className="w-20 h-8" value={settings.meeting_duration_minutes} onChange={(e) => handleSave({ meeting_duration_minutes: parseInt(e.target.value) || 30 })} /></div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-sm font-medium">Origens que o SDR responde</Label>
              <p className="text-xs text-muted-foreground">Mesmos filtros do chat. Desmarque para o SDR ignorar essas conversas.</p>
              <div className="space-y-2 pt-1">
                {(() => {
                  const allowed: string[] = Array.isArray(settings.allowed_sources)
                    ? settings.allowed_sources
                    : ["organic", "ad", "campaign", "landing", "manual"]
                  const networks: string[] = Array.isArray(settings.allowed_networks)
                    ? settings.allowed_networks
                    : ["google", "meta"]
                  return (
                    <>
                      {SDR_SOURCES.map((s) => (
                        <label key={s.value} className="flex items-center justify-between gap-2 cursor-pointer">
                          <span className="text-sm">{s.label} <span className="text-xs text-muted-foreground">— {s.hint}</span></span>
                          <input
                            type="checkbox"
                            checked={allowed.includes(s.value)}
                            onChange={(e) => handleSave({
                              allowed_sources: e.target.checked
                                ? [...allowed, s.value]
                                : allowed.filter((v) => v !== s.value),
                            })}
                            className="rounded"
                          />
                        </label>
                      ))}
                      <div className="ml-3 space-y-2 border-l-2 border-border pl-3 pt-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          Redes de anúncio (quando “Todos os anúncios” está marcado)
                        </p>
                        {SDR_NETWORKS.map((n) => (
                          <label key={n.value} className="flex items-center justify-between gap-2 cursor-pointer">
                            <span className="text-sm">{n.label}</span>
                            <input
                              type="checkbox"
                              checked={networks.includes(n.value)}
                              onChange={(e) => handleSave({
                                allowed_networks: e.target.checked
                                  ? [...networks, n.value]
                                  : networks.filter((v) => v !== n.value),
                              })}
                              className="rounded"
                            />
                          </label>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" /> Configuracao IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between"><Label className="text-sm">Modo teste</Label><input type="checkbox" checked={settings.test_mode} onChange={(e) => handleSave({ test_mode: e.target.checked })} className="rounded" /></div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Tom</Label>
              <Select value={settings.tone} onValueChange={(v) => handleSave({ tone: v })}>
                <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="profissional_cordial">Profissional e cordial</SelectItem>
                  <SelectItem value="profissional">Profissional</SelectItem>
                  <SelectItem value="cordial">Cordial</SelectItem>
                  <SelectItem value="objetivo">Objetivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label className="text-sm">Modelo</Label><Input className="h-8" value={settings.primary_model ?? ""} onChange={(e) => handleSave({ primary_model: e.target.value })} placeholder="meta/muse-spark-1.3-contributor" /></div>
            <div className="space-y-2"><Label className="text-sm">Modelo requalificação</Label><Input className="h-8" value={settings.extraction_model ?? ""} onChange={(e) => handleSave({ extraction_model: e.target.value })} placeholder="Vazio = usa o mesmo modelo" /></div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Prompt principal</Label>
              </div>
              <Textarea
                className="min-h-[180px] font-mono text-xs"
                value={settings.code_prompt ?? ""}
                onChange={(e) => handleSave({ code_prompt: e.target.value })}
                placeholder="Prompt principal do SDR (fonte única — sem fallback no código)..."
              />
              <p className="text-xs text-muted-foreground">
                Fonte única do atendimento. Se vazio, o SDR não responde (fail-closed).
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Prompt adicional</Label>
              <Textarea
                className="min-h-[80px]"
                value={settings.system_prompt ?? ""}
                onChange={(e) => handleSave({ system_prompt: e.target.value })}
                placeholder="Instruções adicionais somadas ao fim do prompt principal..."
              />
              <p className="text-xs text-muted-foreground">
                Concatenado ao fim do prompt principal (não o substitui).
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Base de conhecimento (txt)</Label>
                <div className="flex items-center gap-1">
                  <label className="cursor-pointer">
                    <Input
                      type="file"
                      accept=".txt,text/plain"
                      className="hidden"
                      onChange={(e) => { handleKnowledgeFile(e.target.files?.[0] ?? null); e.target.value = "" }}
                    />
                    <Button asChild={false} variant="outline" size="sm" className="h-7 text-xs pointer-events-none" type="button">
                      <Plus className="mr-1 h-3 w-3" /> Anexar arquivo
                    </Button>
                  </label>
                  {((settings.knowledge_base ?? "") !== "" || knowledgeFile) && (
                    <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={handleRemoveKnowledge}>
                      <Trash2 className="mr-1 h-3 w-3" /> Remover
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Conteudo do .txt incluido como contexto na IA do SDR.
                {settings.knowledge_base ? ` Anexado: ${knowledgeFile?.name ?? "arquivo"} (${settings.knowledge_base.length} caracteres).` : " Nenhum arquivo anexado."}
              </p>
            </div>
          </CardContent>
        </Card>

        <PresentationAvailability />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4" /> Requalificar contatos</CardTitle>
            <CardDescription>Analisa os chats dos últimos 30 dias e preenche ramo, equipe e info adicional. Nenhuma mensagem é enviada ao lead.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {qualStats && !qualStats.error && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
                <div><p className="text-xs text-muted-foreground">Conversas em 30 dias</p><p className="text-lg font-bold">{qualStats.conversations ?? 0}</p></div>
                <div><p className="text-xs text-muted-foreground">Contatos envolvidos</p><p className="text-lg font-bold">{qualStats.contacts ?? 0}</p></div>
                <div><p className="text-xs text-muted-foreground">Já qualificados (3/3)</p><p className="text-lg font-bold text-green-700 dark:text-green-400">{qualStats.complete ?? 0}</p></div>
                <div><p className="text-xs text-muted-foreground">Qualificação parcial</p><p className="text-lg font-bold text-amber-700 dark:text-amber-400">{qualStats.partial ?? 0}</p></div>
                <div><p className="text-xs text-muted-foreground">Sem dados (faltam)</p><p className="text-lg font-bold text-red-700 dark:text-red-400">{qualStats.missing ?? 0}</p></div>
                <div><p className="text-xs text-muted-foreground">Faltam analisar</p><p className="text-lg font-bold">{(qualStats.partial ?? 0) + (qualStats.missing ?? 0)}</p></div>
              </div>
            )}
            <Button onClick={handleRequalify} disabled={requalifying}>
              {requalifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Processar todos
            </Button>
            {progress && (
              <p className="text-xs text-muted-foreground">{progress}</p>
            )}
            {requalifyStats && (
              <div className="rounded-lg border p-3 text-sm">
                <p><span className="font-medium">Analisados:</span> {requalifyStats.analyzed}</p>
                <p><span className="font-medium">Qualificação completa:</span> {requalifyStats.qualified}</p>
                <p><span className="font-medium">Qualificação parcial:</span> {requalifyStats.partial}</p>
                {requalifyStats.skipped > 0 && <p className="text-muted-foreground">Já completos (ignorados): {requalifyStats.skipped}</p>}
                {requalifyStats.errors > 0 && <p className="text-destructive">Sem dados extraíveis/erros: {requalifyStats.errors}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Play className="h-4 w-4" /> Testar SDR</CardTitle>
            <CardDescription>Simule uma conversa sem enviar mensagens reais.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={testMessage} onChange={(e) => setTestMessage(e.target.value)} placeholder="Ex: Tenho uma empresa de climatizacao com 5 tecnicos." rows={3} />
            <Button onClick={handleTest} disabled={testing || !testMessage.trim()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Testar
            </Button>
            {testResult && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{testResult.response ?? "Sem resposta"}</p>
                {testResult.action && <p className="mt-1 text-muted-foreground">Acao: {testResult.action}</p>}
                {testResult.temperature && <p className="text-muted-foreground">Temperatura: {testResult.temperature}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
