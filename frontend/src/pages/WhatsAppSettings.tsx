import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { BookUser, Cable, Download, LogOut, MessagesSquare, Plus, QrCode, RefreshCw, Trash2, UserRound } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import {
  proxyCreateInstance,
  proxyDeleteInstance,
  proxyGetQr,
  proxyGetStatus,
  proxyLogoutInstance,
  proxySetWebhook,
  proxySyncContacts,
  proxySyncHistory,
  proxySyncMessages,
  proxySyncNames,
} from "@/lib/api"
import type { WhatsAppInstance } from "@/lib/types"
import { cn } from "@/lib/utils"
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

const STATUS_LABEL: Record<WhatsAppInstance["status"], string> = {
  connected: "Conectado",
  connecting: "Conectando...",
  disconnected: "Desconectado",
}

function StatusBadge({ status }: { status: WhatsAppInstance["status"] }) {
  return (
    <Badge
      className={cn(
        status === "connected" && "bg-green-500 hover:bg-green-500",
        status === "connecting" && "bg-yellow-500 hover:bg-yellow-500",
        status === "disconnected" && "bg-red-500 hover:bg-red-500",
      )}
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}

export default function WhatsAppSettings() {
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [creating, setCreating] = useState(false)
  const [qr, setQr] = useState<{ base64: string | null; pairingCode: string | null } | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [settingWebhook, setSettingWebhook] = useState(false)
  const [syncingHistory, setSyncingHistory] = useState(false)
  const [syncingContacts, setSyncingContacts] = useState(false)
  const [syncingMessages, setSyncingMessages] = useState(false)
  const [syncingNames, setSyncingNames] = useState(false)
  const pollRef = useRef<number | null>(null)

  const loadInstances = useCallback(async () => {
    const { data, error } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .order("created_at", { ascending: true })
    if (error) {
      toast.error(error.message)
    } else {
      setInstances((data as WhatsAppInstance[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadInstances()
  }, [loadInstances])

  const instance = instances[0] ?? null

  const refreshStatus = useCallback(async () => {
    if (!instance) return
    try {
      const data = await proxyGetStatus(instance.id)
      if (data?.status) {
        setInstances((prev) =>
          prev.map((i) => (i.id === instance.id ? { ...i, status: data.status } : i)),
        )
      }
    } catch {
      // keep last known status
    }
  }, [instance])

  const refreshQr = useCallback(async () => {
    if (!instance) return
    setQrLoading(true)
    try {
      const data = await proxyGetQr(instance.id)
      setQr({
        base64: data?.qrcode?.base64 ?? null,
        pairingCode: data?.qrcode?.pairingCode ?? null,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao obter QR code")
    } finally {
      setQrLoading(false)
    }
  }, [instance])

  // Poll status every 3s; refresh QR while not connected (it expires).
  useEffect(() => {
    if (!instance) return
    const tick = () => {
      refreshStatus()
      if (instance.status !== "connected") {
        refreshQr()
      }
    }
    tick()
    pollRef.current = window.setInterval(tick, 3000)
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [instance, refreshStatus, refreshQr])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error("Informe um nome para a instância")
      return
    }
    setCreating(true)
    try {
      const data = await proxyCreateInstance(
        name.trim(),
        phoneNumber.trim().replace(/\D/g, "") || undefined,
      )
      setQr({
        base64: data?.qrcode?.base64 ?? null,
        pairingCode: data?.qrcode?.pairingCode ?? null,
      })
      setName("")
      setPhoneNumber("")
      toast.success("Instância criada — escaneie o QR code")
      await loadInstances()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar instância")
    } finally {
      setCreating(false)
    }
  }

  async function handleLogout() {
    if (!instance) return
    if (!window.confirm("Desconectar esta instância do WhatsApp?")) return
    setDisconnecting(true)
    try {
      await proxyLogoutInstance(instance.id)
      setQr(null)
      toast.success("Instância desconectada")
      await loadInstances()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar")
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleDelete() {
    if (!instance) return
    if (!window.confirm(
      "Excluir a conexão do WhatsApp? Isso remove o pareamento na Evolution e apaga as conversas e mensagens desta instância (os contatos são mantidos).",
    )) return
    setDeleting(true)
    try {
      await proxyDeleteInstance(instance.id)
      setQr(null)
      toast.success("Conexão excluída")
      await loadInstances()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir")
    } finally {
      setDeleting(false)
    }
  }

  async function handleSetWebhook() {
    if (!instance) return
    setSettingWebhook(true)
    try {
      const data = await proxySetWebhook(instance.id)
      toast.success("Webhook configurado na Evolution")
      if (data?.url) console.info("webhook url:", data.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao configurar webhook")
    } finally {
      setSettingWebhook(false)
    }
  }

  async function handleSyncHistory() {
    if (!instance) return
    setSyncingHistory(true)
    try {
      const data = await proxySyncHistory(instance.id)
      toast.success("Histórico habilitado. Desconecte e reconecte para puxar as mensagens")
      if (data?.message) console.info(data.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao habilitar histórico")
    } finally {
      setSyncingHistory(false)
    }
  }

  async function handleSyncContacts() {
    if (!instance) return
    setSyncingContacts(true)
    try {
      const data = await proxySyncContacts(instance.id)
      toast.success(`Contatos sincronizados (${data?.imported ?? 0} importados)`)
      if (data?.message) console.info(data.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar contatos")
    } finally {
      setSyncingContacts(false)
    }
  }

  async function handleSyncMessages() {
    if (!instance) return
    setSyncingMessages(true)
    try {
      const data = await proxySyncMessages(instance.id)
      const done = data?.done ? "Concluído" : `continua (página ${data?.page ?? "?"})`
      toast.success(`Sincronização de mensagens: ${done}`)
      if (data?.message) console.info(data.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar mensagens")
    } finally {
      setSyncingMessages(false)
    }
  }

  async function handleSyncNames() {
    if (!instance) return
    setSyncingNames(true)
    try {
      const data = await proxySyncNames(instance.id)
      const done = data?.done ? "Concluído" : `continua (página ${data?.page ?? "?"})`
      toast.success(`Sincronização de nomes: ${done}`)
      if (data?.message) console.info(data.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar nomes")
    } finally {
      setSyncingNames(false)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>

  return (
    <div className="space-y-6">
      {!instance && (
        <Card>
          <CardHeader>
            <CardTitle>Criar instância do WhatsApp</CardTitle>
            <CardDescription>
              A conexão acontece via Evolution API (configurada nos segredos da Edge
              Function). O QR code abaixo é usado para parear um único WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="max-w-md space-y-4">
              <div className="space-y-2">
                <Label htmlFor="w-instance">Nome da instância</Label>
                <Input
                  id="w-instance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="empresa"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="w-phone">Número da empresa (opcional)</Label>
                <Input
                  id="w-phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="5511999999999"
                />
              </div>
              <Button type="submit" disabled={creating}>
                {creating ? "Criando..." : (
                  <>
                    <Plus className="mr-2 h-4 w-4" /> Criar instância
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {instance && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>WhatsApp: {instance.instance_name}</span>
              <StatusBadge status={instance.status} />
            </CardTitle>
            <CardDescription>
              {instance.phone_number
                ? `Número: +${instance.phone_number}`
                : "Número não informado"}
              {" · "}Sincroniza histórico de até ~60 dias quando disponível.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {instance.status !== "connected" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Escaneie o QR code abaixo com o WhatsApp conectado
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshQr}
                    disabled={qrLoading}
                  >
                    <RefreshCw className={cn("mr-1 h-3 w-3", qrLoading && "animate-spin")} />
                    Atualizar
                  </Button>
                </div>
                {qr?.base64 ? (
                  <div className="flex flex-col items-start gap-2">
                    <img
                      src={qr.base64}
                      alt="QR code do WhatsApp"
                      className="h-52 w-52 rounded border"
                    />
                    {qr.pairingCode && (
                      <p className="text-sm text-muted-foreground">
                        Ou use o código de pareamento:{" "}
                        <span className="font-mono font-semibold text-foreground">
                          {qr.pairingCode}
                        </span>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {qrLoading ? "Obtendo QR code..." : "QR code indisponível no momento."}
                  </p>
                )}
              </div>
            )}
            {instance.status === "connected" && (
              <p className="text-sm text-green-600">
                WhatsApp conectado. As mensagens chegam em tempo real no Chat.
              </p>
            )}
            <Button
              variant="secondary"
              onClick={handleSetWebhook}
              disabled={settingWebhook}
            >
              <Cable className="mr-2 h-4 w-4" />
              {settingWebhook ? "Configurando..." : "Configurar webhook"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSyncHistory}
              disabled={syncingHistory}
            >
              <Download className="mr-2 h-4 w-4" />
              {syncingHistory ? "Habilitando..." : "Sincronizar histórico"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSyncContacts}
              disabled={syncingContacts}
            >
              <BookUser className="mr-2 h-4 w-4" />
              {syncingContacts ? "Sincronizando..." : "Sincronizar contatos"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSyncMessages}
              disabled={syncingMessages}
            >
              <MessagesSquare className="mr-2 h-4 w-4" />
              {syncingMessages ? "Sincronizando..." : "Sincronizar mensagens"}
            </Button>
            <Button
              variant="secondary"
              onClick={handleSyncNames}
              disabled={syncingNames}
            >
              <UserRound className="mr-2 h-4 w-4" />
              {syncingNames ? "Sincronizando..." : "Sincronizar nomes"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={handleLogout}
                disabled={disconnecting}
              >
                <LogOut className="mr-2 h-4 w-4" />
                {disconnecting ? "Desconectando..." : "Desconectar"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                {deleting ? "Excluindo..." : "Excluir conexão"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
