import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Pencil, Plus, Search, Trash2, MessageCircle } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { contactDisplayName, formatPhone, isRealPhone } from "@/lib/utils"
import type { Contact } from "@/lib/types"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { Badge } from "@/components/ui/badge"

type ContactForm = {
  name: string
  phone: string
  email: string
  notes: string
  opted_out: boolean
}

const EMPTY_FORM: ContactForm = {
  name: "",
  phone: "",
  email: "",
  notes: "",
  opted_out: false,
}

export default function ContactsPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const isAdmin = profile?.role === "admin"
  const PAGE_SIZE = 100

  async function fetchContacts(reset: boolean) {
    if (reset) setLoading(true)
    else setLoadingMore(true)
    const offset = reset ? 0 : contacts.length
    let builder = supabase
      .from("contacts")
      .select("*", { count: "exact" })
    const q = queryValue.trim()
    if (q) {
      builder = builder.or(
        `name.ilike.%${q}%,push_name.ilike.%${q}%,phone.ilike.%${q}%,lid.ilike.%${q}%`,
      )
    }
    const { data, error, count } = await builder
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      toast.error(error.message)
    } else {
      setContacts(
        reset ? ((data as Contact[]) ?? []) : [...contacts, ...((data as Contact[]) ?? [])],
      )
      setTotal(count ?? 0)
    }
    setLoading(false)
    setLoadingMore(false)
  }

  // Debounced server-side search.
  const [queryValue, setQueryValue] = useState("")
  useEffect(() => {
    const t = window.setTimeout(() => fetchContacts(true), 350)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryValue])

  useEffect(() => {
    fetchContacts(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(contact: Contact) {
    setEditingId(contact.id)
    setForm({
      name: contact.name ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      notes: contact.notes ?? "",
      opted_out: contact.opted_out,
    })
    setDialogOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const phone = form.phone.replace(/\D/g, "")
    if (!/^\d{10,15}$/.test(phone)) {
      toast.error("Telefone inválido — use apenas números com DDI (ex.: 5511999999999)")
      return
    }
    setSaving(true)
    const payload = {
      name: form.name || null,
      phone,
      email: form.email || null,
      notes: form.notes || null,
      opted_out: form.opted_out,
      source: "manual",
    }
    let error: { message: string } | null
    if (editingId) {
      const res = await supabase.from("contacts").update(payload).eq("id", editingId)
      error = res.error
    } else {
      const res = await supabase.from("contacts").insert(payload)
      error = res.error
    }
    setSaving(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(editingId ? "Contato atualizado" : "Contato criado")
    setDialogOpen(false)
    fetchContacts(true)
  }

  async function handleDelete(contact: Contact) {
    if (!window.confirm(`Excluir o contato ${contactDisplayName(contact)}?`)) return
    setDeletingId(contact.id)
    const { error } = await supabase.from("contacts").delete().eq("id", contact.id)
    setDeletingId(null)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Contato excluído")
    fetchContacts(true)
  }

  function openChat(contact: Contact) {
    navigate(`/?contact=${encodeURIComponent(contact.phone ?? "")}`)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-3 md:px-6">
        <h1 className="text-xl font-semibold">Contatos</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Novo contato
        </Button>
      </header>

      <div className="shrink-0 space-y-4 p-3 pb-0 md:p-6 md:pb-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou telefone..."
            value={queryValue}
            onChange={(e) => setQueryValue(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 md:p-6">
        {loading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : contacts.length === 0 ? (
          <p className="text-muted-foreground">
            {queryValue ? "Nenhum contato encontrado." : "Nenhum contato ainda."}
          </p>
        ) : (
          // Tabela tem 5 colunas — largura mínima garante scroll horizontal no mobile
          <div className="min-w-[640px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name || c.push_name || "—"}
                    {c.push_name && c.name && c.push_name !== c.name && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({c.push_name})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {isRealPhone(c.phone) ? formatPhone(c.phone) : "—"}
                  </TableCell>
                  <TableCell>{c.email || "—"}</TableCell>
                  <TableCell>
                    {c.opted_out ? (
                      <Badge variant="destructive">Opt-out</Badge>
                    ) : (
                      <Badge variant="secondary">Ativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Abrir conversa"
                        onClick={() => openChat(c)}
                      >
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Excluir"
                          disabled={deletingId === c.id}
                          onClick={() => handleDelete(c)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </div>
        )}
        {!loading && contacts.length > 0 && contacts.length < total && (
          <div className="flex justify-center pt-4">
            <Button variant="outline" onClick={() => fetchContacts(false)} disabled={loadingMore}>
              {loadingMore ? "Carregando..." : `Carregar mais (${contacts.length} de ${total})`}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar contato" : "Novo contato"}</DialogTitle>
            <DialogDescription>
              Formato de telefone E.164: somente números, com DDI (ex.: 5511999999999).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="c-name">Nome</Label>
              <Input
                id="c-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-phone">Telefone *</Label>
              <Input
                id="c-phone"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="5511999999999"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">E-mail</Label>
              <Input
                id="c-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-notes">Observações</Label>
              <Textarea
                id="c-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.opted_out}
                onChange={(e) => setForm({ ...form, opted_out: e.target.checked })}
              />
              Contato optou por não receber mensagens
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
