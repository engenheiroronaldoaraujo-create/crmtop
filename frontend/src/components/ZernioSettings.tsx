import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { BadgeCheck, Cable, Link2, RefreshCw, Save, Unplug } from "lucide-react"
import { toast } from "sonner"

import {
  zernioConnectComplete,
  zernioConnectStart,
  zernioDisconnect,
  zernioGetConfig,
  zernioSetApiKey,
  zernioSetupWebhook,
  zernioSyncTemplates,
} from "@/lib/api"
import type { ZernioConnection } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Configuração do WhatsApp oficial (Meta Cloud API) via Zernio.
// A conexão é feita no navegador do admin (OAuth da Meta); o retorno cai em
// /settings?tab=whatsapp com connected=whatsapp&accountId=..., que este
// componente processa e troca por uma linha em zernio_connections.
export function ZernioSettings() {
  const location = useLocation()
  const [hasKey, setHasKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState("")
  const [savingKey, setSavingKey] = useState(false)
  const [connection, setConnection] = useState<ZernioConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const callbackHandled = useRef(false)

  const load = useCallback(async () => {
    try {
      const data = await zernioGetConfig()
      setHasKey(Boolean(data?.has_api_key))
      setConnection((data?.connection as ZernioConnection) ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar config Zernio")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Callback do OAuth da Meta: params appended by Zernio to redirect_url.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (callbackHandled.current) return
    const connected = params.get("connected")
    const error = params.get("error")
    const accountId = params.get("accountId")

    if (connected === "whatsapp" && accountId) {
      callbackHandled.current = true
      zernioConnectComplete({
        account_id: accountId,
        profile_id: params.get("profileId") ?? undefined,
        username: params.get("username") ?? undefined,
      })
        .then(() => {
          toast.success("WhatsApp oficial conectado via Meta")
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Falha ao concluir conexão")
        })
        .finally(() => {
          // Limpa os params da URL e recarrega o estado.
          window.history.replaceState({}, "", "/settings?tab=whatsapp")
          load()
        })
    } else if (error) {
      callbackHandled.current = true
      const message = params.get("error_message") || error
      toast.error(`Conexão Meta cancelada: ${message}`)
      window.history.replaceState({}, "", "/settings?tab=whatsapp")
    }
  }, [location.search, load])

  async function handleSaveKey() {
    if (!keyDraft.trim()) return
    setSavingKey(true)
    try {
      const data = await zernioSetApiKey(keyDraft.trim())
      if (data?.verified) {
        toast.success("API key salva e validada")
      } else {
        toast.warning(`Key salva, mas não validada: ${data?.warning ?? "verifique"}`)
      }
      setKeyDraft("")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar API key")
    } finally {
      setSavingKey(false)
    }
  }

  async function handleConnect() {
    setConnecting(true)
    try {
      const redirect = `${window.location.origin}/settings?tab=whatsapp`
      const data = await zernioConnectStart(redirect)
      if (data?.auth_url) {
        window.location.href = data.auth_url
      } else {
        toast.error("Zernio não retornou a URL de conexão")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao iniciar conexão")
      setConnecting(false)
    }
  }

  async function handleSetupWebhook() {
    setWebhookSaving(true)
    try {
      await zernioSetupWebhook()
      toast.success("Webhook configurado na Zernio")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao configurar webhook")
    } finally {
      setWebhookSaving(false)
    }
  }

  async function handleSyncTemplates() {
    setSyncing(true)
    try {
      const data = await zernioSyncTemplates()
      toast.success(`Templates sincronizados (${data?.count ?? 0})`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar templates")
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Desconectar o WhatsApp oficial deste CRM? As campanhas continuam registradas.")) return
    setDisconnecting(true)
    try {
      await zernioDisconnect()
      toast.success("Conexão marcada como desconectada")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar")
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>WhatsApp Oficial (Meta) — Zernio</span>
          {connection?.status === "connected" ? (
            <Badge className="bg-green-500 hover:bg-green-500">
              <BadgeCheck className="mr-1 h-3 w-3" /> Conectado
            </Badge>
          ) : (
            <Badge variant="destructive">Não conectado</Badge>
          )}
        </CardTitle>
        <CardDescription>
          API oficial da Meta para campanhas e mensagens com templates aprovados.
          Requer uma conta WhatsApp Business (WABA). Necessário para usar o módulo
          de Campanhas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasKey && (
          <div className="space-y-2">
            <Label htmlFor="zernio-key">API key da Zernio</Label>
            <p className="text-xs text-muted-foreground">
              Crie em zernio.com → Settings → API Keys. Fica guardada no servidor
              (app_secrets) e nunca chega ao navegador.
            </p>
            <div className="flex gap-2">
              <Input
                id="zernio-key"
                type="password"
                placeholder="sk_..."
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <Button onClick={handleSaveKey} disabled={savingKey || !keyDraft.trim()}>
                {savingKey ? (
                  "Salvando..."
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" /> Salvar
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {hasKey && connection?.status !== "connected" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Conecte sua conta WhatsApp Business (WABA) da Meta pelo fluxo oficial
              de autorização. Você será redirecionado de volta aqui ao concluir.
            </p>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                "Abrindo Meta..."
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" /> Conectar com Meta
                </>
              )}
            </Button>
          </div>
        )}

        {hasKey && connection?.status === "connected" && (
          <>
            <div className="rounded-lg border p-3 text-sm">
              <p>
                <span className="font-medium">{connection.account_name ?? "Conta WhatsApp"}</span>
                {connection.phone_number && (
                  <span className="ml-2 text-muted-foreground">+{connection.phone_number}</span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Conta Zernio: {connection.account_id} · Perfil: {connection.profile_id}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleSyncTemplates} disabled={syncing}>
                <RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
                {syncing ? "Sincronizando..." : "Sincronizar templates"}
              </Button>
              <Button variant="secondary" onClick={handleSetupWebhook} disabled={webhookSaving}>
                <Cable className="mr-2 h-4 w-4" />
                {webhookSaving
                  ? "Configurando..."
                  : connection.webhook_configured
                    ? "Reconfigurar webhook"
                    : "Configurar webhook"}
              </Button>
              <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
                <Unplug className="mr-2 h-4 w-4" />
                {disconnecting ? "Desconectando..." : "Desconectar"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
