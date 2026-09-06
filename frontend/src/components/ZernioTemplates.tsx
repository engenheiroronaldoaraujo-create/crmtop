import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { BookMarked, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { zernioCreateTemplate, zernioImportLibraryTemplate, zernioSyncTemplates } from "@/lib/api"
import type { ZernioTemplate } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const STATUS_META: Record<string, { label: string; className: string }> = {
  APPROVED: { label: "Aprovado", className: "bg-green-500 hover:bg-green-500" },
  PENDING: { label: "Em análise", className: "bg-yellow-500 text-black hover:bg-yellow-500" },
  REJECTED: { label: "Rejeitado", className: "bg-red-500 hover:bg-red-500" },
  PAUSED: { label: "Pausado", className: "bg-orange-500 hover:bg-orange-500" },
  DISABLED: { label: "Desativado", className: "bg-red-700 hover:bg-red-700" },
  IN_APPEAL: { label: "Em recurso", className: "bg-yellow-600 hover:bg-yellow-600" },
}

// Components do Cloud API: array com BODY/HEADER/FOOTER/BUTTONS.
function bodyTextOf(t: ZernioTemplate): string {
  const comps = (t.components ?? []) as Array<{ type?: string; text?: string }>
  return comps.find((c) => c?.type === "BODY")?.text ?? ""
}

type CreateForm = {
  name: string
  category: "MARKETING" | "UTILITY"
  language: string
  body_text: string
  footer_text: string
}

// Templates comuns da biblioteca da Meta (pré-aprovados; nomes exatos).
const LIBRARY_SUGGESTIONS = [
  "appointment_reminder",
  "address_update",
  "auto_pay_reminder_1",
  "issue_resolution",
  "payment_reminder",
  "payment_receipt",
  "shipping_update",
  "order_updates",
]

type LibraryForm = { name: string; language: string; button_url: string; button_phone: string }

export function ZernioTemplates() {
  const [templates, setTemplates] = useState<ZernioTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [form, setForm] = useState<CreateForm | null>(null)
  const [libForm, setLibForm] = useState<LibraryForm | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("zernio_templates")
      .select("*")
      .order("name")
      .order("language")
    if (error) {
      toast.error(error.message)
    } else {
      setTemplates((data as ZernioTemplate[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleSync() {
    setSyncing(true)
    try {
      const data = await zernioSyncTemplates()
      toast.success(`Sincronizado (${data?.count ?? 0} templates)`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar")
    } finally {
      setSyncing(false)
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    try {
      await zernioCreateTemplate({
        name: form.name.trim(),
        category: form.category,
        language: form.language.trim() || "pt_BR",
        body_text: form.body_text.trim(),
        footer_text: form.footer_text.trim() || undefined,
      })
      toast.success("Template enviado para análise da Meta (até ~24h)")
      setForm(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar template")
    } finally {
      setSaving(false)
    }
  }

  async function handleImportLibrary(e: FormEvent) {
    e.preventDefault()
    if (!libForm) return
    setSaving(true)
    try {
      await zernioImportLibraryTemplate({
        name: libForm.name.trim(),
        language: libForm.language.trim() || "pt_BR",
        button_url: libForm.button_url.trim() || undefined,
        button_phone: libForm.button_phone.replace(/\D/g, "") || undefined,
      })
      toast.success("Template importado — já está APROVADO e pronto para campanhas")
      setLibForm(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao importar template")
    } finally {
      setSaving(false)
    }
  }

  const placeholderCount = useMemo(() => {
    if (!form) return 0
    let max = 0
    for (const m of `${form.body_text} ${form.footer_text}`.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
      max = Math.max(max, parseInt(m[1], 10))
    }
    return max
  }, [form])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Templates oficiais aprovados pela Meta — obrigatórios para iniciar
          conversas fora da janela de 24h (campanhas). Variáveis:{" "}
          <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>...
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={syncing ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </Button>
          <Button variant="secondary" onClick={() => setLibForm({ name: "", language: "pt_BR", button_url: "", button_phone: "" })}>
            <BookMarked className="mr-2 h-4 w-4" /> Importar da biblioteca Meta
          </Button>
          <Button
            onClick={() =>
              setForm({ name: "", category: "MARKETING", language: "pt_BR", body_text: "", footer_text: "" })
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Novo template Meta
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Idioma</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Corpo</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t) => {
              const meta = STATUS_META[t.status ?? ""] ?? {
                label: t.status ?? "—",
                className: "bg-muted text-muted-foreground",
              }
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.language}</TableCell>
                  <TableCell>{t.category ?? "—"}</TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">
                    {bodyTextOf(t)}
                  </TableCell>
                  <TableCell>
                    <Badge className={meta.className} title={t.reason ?? undefined}>
                      {meta.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              )
            })}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum template oficial. Conecte o WhatsApp em Configurações →
                  WhatsApp e clique em Sincronizar (ou crie um template aqui).
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo template Meta</DialogTitle>
            <DialogDescription>
              Enviado para revisão da Meta (pode levar até 24h). Só templates
              aprovados podem ser usados em campanhas.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="zt-name">Nome *</Label>
                  <Input
                    id="zt-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                    placeholder="campanha_black_friday"
                  />
                  <p className="text-xs text-muted-foreground">minúsculas, números e _</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zt-lang">Idioma</Label>
                  <Input
                    id="zt-lang"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    placeholder="pt_BR"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v as CreateForm["category"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade (confirmação, aviso)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="zt-body">Mensagem *</Label>
                <Textarea
                  id="zt-body"
                  required
                  rows={4}
                  value={form.body_text}
                  onChange={(e) => setForm({ ...form, body_text: e.target.value })}
                  placeholder={"Olá {{1}}! Temos uma oferta especial para você hoje."}
                />
                <p className="text-xs text-muted-foreground">
                  {placeholderCount > 0
                    ? `${placeholderCount} variável(is). Use ${"{{1}}"}, ${"{{2}}"}, ... em ordem.`
                    : "Sem variáveis — corpo fixo para todos."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="zt-footer">Rodapé (opcional)</Label>
                <Input
                  id="zt-footer"
                  value={form.footer_text}
                  onChange={(e) => setForm({ ...form, footer_text: e.target.value })}
                  placeholder="Responda SAIR para não receber mais mensagens"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Enviando..." : "Enviar para análise"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={libForm !== null} onOpenChange={(open) => !open && setLibForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar template da biblioteca da Meta</DialogTitle>
            <DialogDescription>
              Templates pré-aprovados pela Meta — ficam prontos para uso imediato,
              sem fila de revisão. Informe o nome exato (veja os disponíveis em{" "}
              <a
                className="underline"
                href="https://business.facebook.com/wa/manage/message-templates/"
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp Manager
              </a>
              ).
            </DialogDescription>
          </DialogHeader>
          {libForm && (
            <form onSubmit={handleImportLibrary} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="lib-name">Nome na biblioteca *</Label>
                  <Input
                    id="lib-name"
                    required
                    list="lib-names"
                    value={libForm.name}
                    onChange={(e) => setLibForm({ ...libForm, name: e.target.value })}
                    placeholder="appointment_reminder"
                  />
                  <datalist id="lib-names">
                    {LIBRARY_SUGGESTIONS.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lib-lang">Idioma</Label>
                  <Input
                    id="lib-lang"
                    value={libForm.language}
                    onChange={(e) => setLibForm({ ...libForm, language: e.target.value })}
                    placeholder="pt_BR"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="lib-url">URL do botão (se houver)</Label>
                  <Input
                    id="lib-url"
                    value={libForm.button_url}
                    onChange={(e) => setLibForm({ ...libForm, button_url: e.target.value })}
                    placeholder="https://suaempresa.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lib-phone">Telefone do botão (se houver)</Label>
                  <Input
                    id="lib-phone"
                    value={libForm.button_phone}
                    onChange={(e) => setLibForm({ ...libForm, button_phone: e.target.value })}
                    placeholder="5515999998888"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Se o template tiver botão de link/telefone e você não preencher, a
                Meta rejeita e o app pede o dado faltante.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setLibForm(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving || !libForm.name.trim()}>
                  {saving ? "Importando..." : "Importar (APPROVED imediato)"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
