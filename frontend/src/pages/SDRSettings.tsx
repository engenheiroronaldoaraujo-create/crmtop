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
} from "lucide-react"
import { sdrGetSettings, sdrUpdateSettings, sdrGetMetrics, sdrTestSDR } from "@/lib/api"
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

const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]
const DAY_KEYS = ["schedule_sunday", "schedule_monday", "schedule_tuesday", "schedule_wednesday", "schedule_thursday", "schedule_friday", "schedule_saturday"]

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
      toast.success("Configurações salvas")
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
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Demonstrações</p><p className="text-lg font-bold">{metrics.demos_scheduled}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Retornos</p><p className="text-lg font-bold">{metrics.callbacks_scheduled}</p></CardContent></Card>
          <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Transferidos</p><p className="text-lg font-bold">{metrics.transfers}</p></CardContent></Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Horário de Atendimento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div />
              <div className="text-center text-muted-foreground">Início</div>
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
              <Label className="text-sm">Fora do horário</Label>
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
              <Label className="text-sm">Duração reunião (min)</Label>
              <Input type="number" className="w-20 h-8" value={settings.meeting_duration_minutes} onChange={(e) => handleSave({ meeting_duration_minutes: parseInt(e.target.value) || 30 })} />
            </div>
          </CardContent>
        </Card>

        {/* AI Config */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" /> Configuração IA</CardTitle>
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
              <Textarea className="min-h-[80px]" value={settings.system_prompt ?? ""} onChange={(e) => handleSave({ system_prompt: e.target.value })} placeholder="Instruções adicionais para o SDR..." />
            </div>
          </CardContent>
        </Card>

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
              placeholder="Ex: Tenho uma empresa de climatização com 5 técnicos."
              rows={3}
            />
            <Button onClick={handleTest} disabled={testing || !testMessage.trim()}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Testar
            </Button>
            {testResult && (
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{testResult.response ?? "Sem resposta"}</p>
                {testResult.action && <p className="mt-1 text-muted-foreground">Ação: {testResult.action}</p>}
                {testResult.temperature && <p className="text-muted-foreground">Temperatura: {testResult.temperature}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
