import { useState, type FormEvent } from "react"
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useTemplates } from "@/hooks/use-templates"
import type { MessageTemplate } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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

type FormState = { id: string | null; title: string; body: string }

export default function TemplatesSettings() {
  const { templates, loading, create, update, remove } = useTemplates(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    if (!form.title.trim() || !form.body.trim()) {
      toast.error("Preencha título e mensagem")
      return
    }
    setSaving(true)
    try {
      if (form.id) {
        await update(form.id, { title: form.title.trim(), body: form.body.trim() })
        toast.success("Template atualizado")
      } else {
        await create({ title: form.title.trim(), body: form.body.trim() })
        toast.success("Template criado")
      }
      setForm(null)
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao salvar template")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(t: MessageTemplate) {
    try {
      await update(t.id, { is_active: !t.is_active })
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao alterar template")
    }
  }

  async function handleDelete(t: MessageTemplate) {
    if (!window.confirm(`Excluir o template "${t.title}"?`)) return
    try {
      await remove(t.id)
      toast.success("Template excluído")
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao excluir template")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Respostas prontas disponíveis no chat. Use <code>{"{{nome}}"}</code> para
          inserir o nome do contato.
        </p>
        <Button onClick={() => setForm({ id: null, title: "", body: "" })}>
          <Plus className="mr-2 h-4 w-4" /> Novo template
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.title}</TableCell>
                <TableCell className="max-w-96 truncate text-sm text-muted-foreground">
                  {t.body}
                </TableCell>
                <TableCell>
                  {t.is_active ? (
                    <Badge variant="secondary">Ativo</Badge>
                  ) : (
                    <Badge variant="destructive">Inativo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Editar"
                      onClick={() => setForm({ id: t.id, title: t.title, body: t.body })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t.is_active ? "Desativar" : "Reativar"}
                      onClick={() => handleToggleActive(t)}
                    >
                      {t.is_active ? (
                        <RotateCcw className="h-4 w-4 rotate-180 text-destructive" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Excluir"
                      onClick={() => handleDelete(t)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Nenhum template cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar template" : "Novo template"}</DialogTitle>
            <DialogDescription>
              A mensagem aparece no chat para o vendedor selecionar e enviar ao lead.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tpl-title">Título *</Label>
                <Input
                  id="tpl-title"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex: Saudação"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tpl-body">Mensagem *</Label>
                <Textarea
                  id="tpl-body"
                  required
                  rows={4}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="Olá {{nome}}! Como posso ajudar?"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
