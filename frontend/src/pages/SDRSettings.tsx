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
} from "lucide-react"
import { sdrGetSettings, sdrUpdateSettings, sdrGetMetrics, sdrTestSDR } from "@/lib/api"
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
                        {slot.is_active ? <span className="h-2 w-2 rounded-full bg-green-500" /> : <span className="h-2 w-2 rounded-full bg-gray-300" />}
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
                        {slot.is_active ? <span className="h-2 w-2 rounded-full bg-green-500" /> : <span className="h-2 w-2 rounded-full bg-gray-300" />}
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
  const [testing, setTesting] = useState(false)

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
            <div className="space-y-2"><Label className="text-sm">Modelo</Label><Input className="h-8" value={settings.primary_model ?? ""} onChange={(e) => handleSave({ primary_model: e.target.value })} placeholder="openrouter/free" /></div>
            <div className="space-y-2"><Label className="text-sm">Prompt adicional</Label><Textarea className="min-h-[80px]" value={settings.system_prompt ?? ""} onChange={(e) => handleSave({ system_prompt: e.target.value })} placeholder="Instrucoes adicionais para o SDR..." /></div>
          </CardContent>
        </Card>

        <PresentationAvailability />

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
