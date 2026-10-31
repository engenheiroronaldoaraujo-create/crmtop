import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Ban, Building2, CheckCircle2, Plus } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { createWorkspace } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import type { Workspace } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type UsageRow = {
  workspace_id: string
  msgs_in: number
  msgs_out: number
  transcricoes: number
  ai_tokens: number
}

type UsageTotal = {
  msgs: number
  transcricoes: number
  ai_tokens: number
}

function firstDayOfMonthISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}

function statusLabel(status: Workspace["status"]): string {
  if (status === "active") return "Ativo"
  if (status === "suspended") return "Suspenso"
  return "Cancelado"
}

export default function PlatformAdmin() {
  const { profile } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [usage, setUsage] = useState<Record<string, UsageTotal>>({})
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  const isPlatformAdmin = profile?.is_platform_admin === true

  async function loadAll() {
    setLoading(true)
    try {
      const { data: ws, error: wsError } = await supabase
        .from("workspaces")
        .select("*")
        .order("created_at", { ascending: true })
      if (wsError) throw wsError
      const list = (ws ?? []) as Workspace[]
      setWorkspaces(list)

      if (list.length > 0) {
        const ids = list.map((w) => w.id)
        const [{ data: usageRows, error: usageError }, { data: memberRows, error: memberError }] =
          await Promise.all([
            supabase
              .from("workspace_usage_daily")
              .select("workspace_id, msgs_in, msgs_out, transcricoes, ai_tokens")
              .in("workspace_id", ids)
              .gte("dia", firstDayOfMonthISO()),
            supabase
              .from("workspace_members")
              .select("workspace_id")
              .in("workspace_id", ids),
          ])
        if (usageError) throw usageError
        if (memberError) throw memberError

        const totals: Record<string, UsageTotal> = {}
        for (const r of (usageRows ?? []) as UsageRow[]) {
          const cur = totals[r.workspace_id] ?? { msgs: 0, transcricoes: 0, ai_tokens: 0 }
          cur.msgs += (r.msgs_in ?? 0) + (r.msgs_out ?? 0)
          cur.transcricoes += r.transcricoes ?? 0
          cur.ai_tokens += r.ai_tokens ?? 0
          totals[r.workspace_id] = cur
        }
        setUsage(totals)

        const counts: Record<string, number> = {}
        for (const r of (memberRows ?? []) as Array<{ workspace_id: string }>) {
          counts[r.workspace_id] = (counts[r.workspace_id] ?? 0) + 1
        }
        setMemberCounts(counts)
      } else {
        setUsage({})
        setMemberCounts({})
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar workspaces")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isPlatformAdmin) void loadAll()
  }, [isPlatformAdmin])

  const monthLabel = useMemo(() => {
    const now = new Date()
    return now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) {
      toast.error("Informe o nome do workspace")
      return
    }
    setCreating(true)
    try {
      await createWorkspace(name)
      toast.success(`Workspace "${name}" criado`)
      setCreateOpen(false)
      setNewName("")
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar workspace")
    } finally {
      setCreating(false)
    }
  }

  async function handleSetStatus(w: Workspace, status: "active" | "suspended") {
    setActingId(w.id)
    try {
      const { error } = await supabase
        .from("workspaces")
        .update({ status })
        .eq("id", w.id)
      if (error) throw error
      toast.success(
        status === "active"
          ? `Workspace "${w.name}" reativado`
          : `Workspace "${w.name}" suspenso`,
      )
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao alterar status")
    } finally {
      setActingId(null)
    }
  }

  if (!isPlatformAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Building2 className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground">
          Esta página é exclusiva do administrador da plataforma.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div>
          <h1 className="text-xl font-semibold">Administração da plataforma</h1>
          <p className="text-xs text-muted-foreground">
            Workspaces, limites e uso de {monthLabel}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
            {loading ? "Carregando..." : "Atualizar"}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Criar workspace
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando workspaces...</p>
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum workspace encontrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Usuários</TableHead>
                <TableHead>Instâncias (máx)</TableHead>
                <TableHead>Mensagens (mês/limite)</TableHead>
                <TableHead>IA tokens (mês/limite)</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((w) => {
                const u = usage[w.id] ?? { msgs: 0, transcricoes: 0, ai_tokens: 0 }
                return (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{w.slug}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{w.plan}</Badge>
                    </TableCell>
                    <TableCell>
                      {w.status === "active" ? (
                        <Badge variant="secondary">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> {statusLabel(w.status)}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">{statusLabel(w.status)}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {memberCounts[w.id] ?? 0}/{w.max_users}
                    </TableCell>
                    <TableCell>{w.max_instances}</TableCell>
                    <TableCell>
                      {u.msgs}/{w.msg_mensal}
                      {u.transcricoes > 0 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({u.transcricoes} transcr.)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.ai_tokens}/{w.ai_credits_mensal}
                    </TableCell>
                    <TableCell className="text-right">
                      {w.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actingId === w.id}
                          onClick={() => void handleSetStatus(w, "suspended")}
                          title="Suspender workspace"
                        >
                          <Ban className="mr-1 h-4 w-4 text-destructive" /> Suspender
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actingId === w.id}
                          onClick={() => void handleSetStatus(w, "active")}
                          title="Reativar workspace"
                        >
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Reativar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar workspace</DialogTitle>
            <DialogDescription>
              Cria um novo cliente (workspace). Você será vinculado como dono.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-name">Nome do workspace *</Label>
              <Input
                id="ws-name"
                required
                placeholder="Ex.: Loja Exemplo"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Criando..." : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
