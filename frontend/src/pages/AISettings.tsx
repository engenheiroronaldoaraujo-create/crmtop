import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Save, Eye, EyeOff, Zap, CheckCircle, XCircle } from "lucide-react"
import { supabase, getSupabaseUrl } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

export default function AISettings() {
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState("openrouter/free")
  const [temperature, setTemperature] = useState("0.7")
  const [maxTokens, setMaxTokens] = useState("1024")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null)
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(true)
  const [transcriptionModel, setTranscriptionModel] = useState("google/gemini-2.5-flash")
  const [savingTranscription, setSavingTranscription] = useState(false)

  const callAiService = async (action: string, data: Record<string, unknown> = {}) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch(`${getSupabaseUrl()}/functions/v1/ai-service`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, data }),
    })
    if (!res.ok) throw new Error(`ai-service ${action} falhou (${res.status})`)
    return res.json()
  }

  useEffect(() => {
    // Settings are stored in Edge Function secrets, not in DB
    setModel("openrouter/free")
    callAiService("get_transcription_config")
      .then((json) => {
        const cfg = json?.result
        if (cfg && typeof cfg === "object") {
          setTranscriptionEnabled(cfg.enabled !== false)
          if (cfg.model) setTranscriptionModel(cfg.model)
        }
      })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`${getSupabaseUrl()}/functions/v1/admin-users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "set-ai-config",
          config_type: "MODEL_UPDATED",
          model,
          temperature: parseFloat(temperature),
          max_tokens: parseInt(maxTokens),
        }),
      })
      if (res.ok) {
        toast.success("Configurações salvas")
      } else {
        toast.error("Erro ao salvar configurações")
      }
    } catch {
      toast.error("Erro ao salvar configurações")
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`${getSupabaseUrl()}/functions/v1/ai-service`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "test_connection",
          data: {},
        }),
      })
      setTestResult(res.ok ? "success" : "error")
    } catch {
      setTestResult("error")
    } finally {
      setTesting(false)
    }
  }

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      // Store API key via Edge Function
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`${getSupabaseUrl()}/functions/v1/ai-service`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "store_api_key",
          data: { key: apiKey.trim() },
        }),
      })
      if (res.ok) {
        toast.success("API Key salva com sucesso")
        setApiKey("")
      } else {
        toast.error("Erro ao salvar API Key")
      }
    } catch {
      toast.error("Erro ao salvar API Key")
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTranscription = async () => {
    setSavingTranscription(true)
    try {
      await callAiService("set_transcription_config", {
        enabled: transcriptionEnabled,
        model: transcriptionModel.trim(),
      })
      toast.success("Transcrição de áudio salva")
    } catch {
      toast.error("Erro ao salvar transcrição")
    } finally {
      setSavingTranscription(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Inteligência Artificial</h2>
        <p className="text-sm text-muted-foreground">
          Configure o modelo de IA para análise de conversas, sugestões e insights.
        </p>
      </div>

      <Separator />

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            API Key - OpenRouter
          </CardTitle>
          <CardDescription>
            Chave de acesso à API do OpenRouter. Necessária para utilizar as funcionalidades de IA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="success">
              <CheckCircle className="mr-1 h-3 w-3" /> Configurada
            </Badge>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            </div>
            <Button onClick={handleSaveApiKey} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A API key é armazenada de forma segura no servidor. Nunca é exposta ao navegador.
          </p>
        </CardContent>
      </Card>

      {/* Model Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Modelo de IA</CardTitle>
          <CardDescription>
            Configure o modelo, temperatura e limite de tokens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Modelo</Label>
            <Input
              placeholder="Ex: openrouter/free, openai/gpt-4, anthropic/claude-3-haiku"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Nome do modelo conforme OpenRouter (ex: openrouter/free, openai/gpt-4, anthropic/claude-3-haiku)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Temperatura</Label>
              <Input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">0 = preciso, 1 = criativo</p>
            </div>
            <div className="space-y-2">
              <Label>Máximo de tokens</Label>
              <Input
                type="number"
                min="100"
                max="4096"
                step="100"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Limite de resposta</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar configurações
            </Button>
            <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Testar conexão
            </Button>
            {testResult === "success" && (
              <Badge variant="success"><CheckCircle className="mr-1 h-3 w-3" /> Conexão OK</Badge>
            )}
            {testResult === "error" && (
              <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Falhou</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Áudio → texto */}
      <Card>
        <CardHeader>
          <CardTitle>Transcrição de Áudios</CardTitle>
          <CardDescription>
            Transcreve áudios recebidos para o SDR IA entender e responder em texto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={transcriptionEnabled}
              onChange={(e) => setTranscriptionEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Transcrever áudios recebidos automaticamente
          </label>
          <div className="space-y-2">
            <Label>Modelo de transcrição</Label>
            <Input
              placeholder="Ex: google/gemini-2.5-flash"
              value={transcriptionModel}
              onChange={(e) => setTranscriptionModel(e.target.value)}
              disabled={!transcriptionEnabled}
            />
            <p className="text-xs text-muted-foreground">
              Modelo multimodal no OpenRouter (suporta entrada de áudio). Padrão: google/gemini-2.5-flash
            </p>
          </div>
          <Button onClick={handleSaveTranscription} disabled={savingTranscription}>
            {savingTranscription ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar transcrição
          </Button>
        </CardContent>
      </Card>

      {/* Features Info */}
      <Card>
        <CardHeader>
          <CardTitle>Funcionalidades de IA</CardTitle>
          <CardDescription>
            Recursos disponíveis com a IA configurada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Resumo de conversas
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Sugestão de respostas
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Análise de leads
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Resumo do cliente
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Análise de oportunidades
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Classificação de temperatura
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}