import { useEffect, useState, type FormEvent } from "react"
import { Ban, KeyRound, Plus, RotateCcw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import {
  adminUsersCreate,
  adminUsersDeactivate,
  adminUsersList,
  adminUsersReactivate,
  adminUsersResetPassword,
  adminUsersSetRole,
} from "@/lib/api"
import type { AdminUser } from "@/lib/types"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Role = "admin" | "vendedor"

export default function UsersAdmin() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    email: "",
    full_name: "",
    role: "vendedor" as Role,
    temp_password: "",
  })
  const [creating, setCreating] = useState(false)

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [resetting, setResetting] = useState(false)

  async function loadUsers() {
    setLoading(true)
    try {
      const data = await adminUsersList()
      setUsers((data?.users ?? []) as AdminUser[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao listar usuários")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (createForm.temp_password.length < 6) {
      toast.error("Senha provisória precisa de pelo menos 6 caracteres")
      return
    }
    setCreating(true)
    try {
      await adminUsersCreate(createForm)
      toast.success("Usuário criado — informe a senha provisória a ele")
      setCreateOpen(false)
      setCreateForm({ email: "", full_name: "", role: "vendedor", temp_password: "" })
      await loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar usuário")
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleBan(u: AdminUser) {
    try {
      if (u.banned) {
        await adminUsersReactivate(u.id)
        toast.success(`${u.full_name || u.email} reativado`)
      } else {
        await adminUsersDeactivate(u.id)
        toast.success(`${u.full_name || u.email} desativado`)
      }
      await loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao alterar usuário")
    }
  }

  async function handleSetRole(u: AdminUser, role: Role) {
    try {
      await adminUsersSetRole(u.id, role)
      toast.success("Papel atualizado")
      await loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao alterar papel")
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!resetTarget) return
    if (resetPassword.length < 6) {
      toast.error("Senha provisória precisa de pelo menos 6 caracteres")
      return
    }
    setResetting(true)
    try {
      await adminUsersResetPassword(resetTarget.id, resetPassword)
      toast.success("Senha redefinida")
      setResetTarget(null)
      setResetPassword("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao redefinir senha")
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gestão de usuários internos. Não há cadastro público.
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Criar usuário
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">
                  {u.full_name || "—"}
                  {u.id === currentUser?.id && (
                    <span className="ml-2 text-xs text-muted-foreground">(você)</span>
                  )}
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onValueChange={(v: Role) => handleSetRole(u, v)}
                    disabled={u.id === currentUser?.id}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vendedor">Vendedor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {u.banned ? (
                    <Badge variant="destructive">Desativado</Badge>
                  ) : (
                    <Badge variant="secondary">
                      <ShieldCheck className="mr-1 h-3 w-3" /> Ativo
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Redefinir senha"
                      onClick={() => {
                        setResetTarget(u)
                        setResetPassword("")
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    {u.id !== currentUser?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={u.banned ? "Reativar" : "Desativar"}
                        onClick={() => handleToggleBan(u)}
                      >
                        {u.banned ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar usuário</DialogTitle>
            <DialogDescription>
              O usuário entra com a senha provisória e troca a senha na página "Minha
              conta". Não é enviado e-mail.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-email">E-mail *</Label>
              <Input
                id="u-email"
                type="email"
                required
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-name">Nome completo</Label>
              <Input
                id="u-name"
                value={createForm.full_name}
                onChange={(e) =>
                  setCreateForm({ ...createForm, full_name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select
                value={createForm.role}
                onValueChange={(v: Role) => setCreateForm({ ...createForm, role: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendedor">Vendedor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="u-pass">Senha provisória *</Label>
              <Input
                id="u-pass"
                required
                minLength={6}
                value={createForm.temp_password}
                onChange={(e) =>
                  setCreateForm({ ...createForm, temp_password: e.target.value })
                }
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

      <Dialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              Defina uma nova senha provisória para {resetTarget?.full_name || resetTarget?.email}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rp-pass">Nova senha provisória *</Label>
              <Input
                id="rp-pass"
                required
                minLength={6}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetTarget(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={resetting}>
                {resetting ? "Salvando..." : "Redefinir"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
