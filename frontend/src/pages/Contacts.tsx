import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { Pencil, Plus, Search, Trash2, MessageCircle } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { formatPhone } from "@/lib/utils"
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
  const [query, setQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const isAdmin = profile?.role === "admin"

  async function loadContacts() {
    setLoading(true)
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .order("updated_at", { ascending: false })
    if (error) {
      toast.error(error.message)
    } else {
      setContacts((data as Contact[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadContacts()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) =>
        (c.name?.toLowerCase().includes(q) ?? false) ||
        (c.push_name?.toLowerCase().includes(q) ?? false) ||
        c.phone.includes(q),
    )
  }, [contacts, query])

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(contact: Contact) {
    setEditingId(contact.id)
    setForm({
      name: contact.name ?? "",
      phone: contact.phone,
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
    }
    let error: { message: string } | null = null
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
    loadContacts()
  }

  async function handleDelete(contact: Contact) {
    if (!window.confirm(`Excluir o contato ${contact.name || contact.phone}?`)) return
    setDeletingId(contact.id)
    const { error } = await supabase.from("contacts").delete().eq("id", contact.id)
    setDeletingId(null)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Contato excluído")
    loadContacts()
  }

  function openChat(contact: Contact) {
    navigate(`/?contact=${encodeURIComponent(contact.phone)}`)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <h1 className="text-xl font-semibold">Contatos</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Novo contato
        </Button>
      </header>

      <div className="shrink-0 space-y-4 p-6 pb-0">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou telefone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground">
            {query ? "Nenhum contato encontrado." : "Nenhum contato ainda."}
          </p>
        ) : (
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
              {filtered.map((c) => (
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
                    {formatPhone(c.phone)}
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
