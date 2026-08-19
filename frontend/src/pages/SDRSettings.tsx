import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Zap,
  ZapOff,
  Loader2,
  Clock,
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

const DAY_NAMES = ["Domingo", "Segunda", "TerÃ§a", "Quarta", "Quinta", "Sexta", "SÃ¡bado"]
const DAY_KEYS = ["schedule_sunday", "schedule_monday", "schedule_tuesday", "schedule_wednesday", "schedule_thursday", "schedule_friday", "schedule_saturday"]

// ---------------------------------------------------------------------------
// Presentation Availability Component
// ---------------------------------------------------------------------------

const PRES_DAYS = ["Domingo", "Segunda", "TerÃ§a", "Quarta", "Quinta", "Sexta", "SÃ¡bado"]

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
      await supabase.from("presentation_slots").insert({
        day_of_week: dayOfWeek,
        start_time: "09:00",
        end_time: "12:00",
      })
      toast.success("HorÃ¡rio adicionado")
      loadSlots()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleUpdateSlot = async (id: string, field: string, value: string) => {
    try {
      await supabase.from("presentation_slots").update({ [field]: value }).eq("id", id)
      loadSlots()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleToggleSlot = async (id: string, current: boolean) => {
    try {
      await supabase.from("presentation_slots").update({ is_active: !current }).eq("id", id)
      loadSlots()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDeleteSlot = async (id: string) => {
    try {
      await supabase.from("presentation_slots").delete().eq("id", id)
      toast.success("HorÃ¡rio removido")
      loadSlots()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (loading) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Calendar className="h-4 w-4" /> Disponibilidade para ApresentaÃ§Ã£o</CardTitle>
        <CardDescription>
          Configure os horÃ¡rios em que a Sofia pode agendar demonstraÃ§Ãµes do AtendaTop.
        </CardDescription>
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
                <p className="text-xs text-muted-foreground pl-2">Sem horÃ¡rios</p>
              ) : (
                <div className="space-y-1 pl-2">
                  {daySlots.map((slot) => (
                    <div key={slot.id} className="flex items-center gap-2">
                      <Input
                        type="time"
                        value={slot.start_time}
                        onChange={(e) => handleUpdateSlot(slot.id, "start_time", e.target.value)}
                        className="h-7 w-24 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">atÃ©</span>
                      <Input
                        type="time"
                        value={slot.end_time}
                        onChange={(e) => handleUpdateSlot(slot.id, "end_time", e.target.value)}
                        className="h-7 w-24 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleToggleSlot(slot.id, slot.is_active)}
                      >
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
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMetrics = useCallback(async () => {
    try {
      const res = await sdrGetMetrics()
      setMetrics(res.metrics)
    } catch {}
  }, [])

  useEffect(() => { loadSettings(); loadMetrics() }, [loadSettings, loadMetrics])

  const handleSave = async (patch: Record<string, unknown>) => {
    try {
      await sdrUpdateSettings(patch)
      setSettings({ ...settings, ...patch })
      toast.success("ConfiguraÃ§Ãµes salvas")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleTest = async () => {
    if (!testMessage.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await sdrTestSDR(testMessage)
      setTestResult(res)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Carregando...</div>
  if (!settings) return <div className="py-8 text-center text-muted-foreground">Erro ao carregar</div>

  const daySchedule = DAY_KEYS.map((key, i) => ({
    day: DAY_NAMES[i],
    key,
    active: settings[key],
  }))

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
          <Button
            variant={settings.enabled ? "destructive" : "default"}
            onClick={() => handleSave({ enabled: !settings.enabled })}
          >
            {settings.enabled ? "Desativar" : "Ativar SDR IA"}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-5 gap-3">
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Leads hoje</p><p className="text-lg font-bold">{metrics.leads_today}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Qualificados</p><p className="text-lg font-bold">{metrics.qualified}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">DemonstraÃ§Ãµes</p><p className="text-lg font-bold">{metrics.demos_scheduled}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Retornos</p><p className="text-lg font-bold">{metrics.callbacks_scheduled}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Transferidos</p><p className="text-lg font-bold">{metrics.transfers}</p></CardContent></Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> HorÃ¡rio de Atendimento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div />
              <div className="text-center text-muted-foreground">InÃ­cio</div>
              <div className="text-center text-muted-foreground">Fim</div>
            </div>
            {daySchedule.map((d) => (
              <div key={d.key} className="grid grid-cols-3 items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.active}
                    onChange={(e) => handleSave({ [d.key]: e.target.checked })}
                    className="rounded"
                  />
                  {d.day}
                </label>
                <Input
                  type="time"
                  value={settings.schedule_start_time}
                  disabled={!d.active}
                  onChange={(e) => handleSave({ schedule_start_time: e.target.value })}
                  className="h-8 text-xs"
                />
                <Input
                  type="time"
                  value={settings.schedule_end_time}
                  disabled={!d.active}
                  onChange={(e) => handleSave({ schedule_end_time: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <Label className="text-sm">Timezone:</Label>
              <Select value={settings.timezone} onValueChange={(v) => handleSave({ timezone: v })}>
                <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Behavior */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" /> Comportamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Fora do horÃ¡rio</Label>
              <input type="checkbox" checked={settings.after_hours_enabled} onChange={(e) => handleSave({ after_hours_enabled: e.target.checked })} className="rounded" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Retorno humano</Label>
              <input type="checkbox" checked={settings.callback_enabled} onChange={(e) => handleSave({ callback_enabled: e.target.checked })} className="rounded" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Limite msgs/conversa</Label>
              <Input type="number" className="w-20 h-8" value={settings.max_messages_per_conversation} onChange={(e) => handleSave({ max_messages_per_conversation: parseInt(e.target.value) || 10 })} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Cooldown (seg)</Label>
              <Input type="number" className="w-20 h-8" value={settings.cooldown_seconds} onChange={(e) => handleSave({ cooldown_seconds: parseInt(e.target.value) || 30 })} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">DuraÃ§Ã£o reuniÃ£o (min)</Label>
              <Input type="number" className="w-20 h-8" value={settings.meeting_duration_minutes} onChange={(e) => handleSave({ meeting_duration_minutes: parseInt(e.target.value) || 30 })} />
            </div>
          </CardContent>
        </Card>

        {/* AI Config */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" /> ConfiguraÃ§Ã£o IA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Modo teste</Label>
              <input type="checkbox" checked={settings.test_mode} onChange={(e) => handleSave({ test_mode: e.target.checked })} className="rounded" />
            </div>
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
            <div className="space-y-2">
              <Label className="text-sm">Modelo</Label>
              <Input className="h-8" value={settings.primary_model ?? ""} onChange={(e) => handleSave({ primary_model: e.target.value })} placeholder="openrouter/free" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Prompt adicional</Label>
              <Textarea className="min-h-[80px]" value={settings.system_prompt ?? ""} onChange={(e) => handleSave({ system_prompt: e.target.value })} placeholder="InstruÃ§Ãµes adicionais para o SDR..." />
            </div>
          </CardContent>
        </Card>

        {/* Presentation Availability */}
        <PresentationAvailability />

        {/* Test SDR */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Play className="h-4 w-4" /> Testar SDR</CardTitle>
            <CardDescription>Simule uma conversa sem enviar mensagens reais.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Ex: Tenho uma empresa de climatizaÃ§Ã£o com 5 tÃ©cnicos."
              rows={3}
            />
            <Button onClick={handleTest} disabled={testing || !testMessage.trim()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Testar
            </Button>
            {testResult && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{testResult.response ?? "Sem resposta"}</p>
                {testResult.action && <p className="mt-1 text-muted-foreground">AÃ§Ã£o: {testResult.action}</p>}
                {testResult.temperature && <p className="text-muted-foreground">Temperatura: {testResult.temperature}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
