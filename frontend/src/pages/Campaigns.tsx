import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import {
  zernioCampaignCancel,
  zernioCampaignCreate,
  zernioCampaignSend,
  zernioCampaignSync,
  zernioCampaignTest,
} from "@/lib/api"
import type { Campaign, CampaignRecipient, ZernioTemplate } from "@/lib/types"
import { parseContactsFile } from "@/lib/contacts-import"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_STATUS: Record<Campaign["status"], { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-muted text-foreground" },
  scheduled: { label: "Agendada", className: "bg-blue-500 hover:bg-blue-500" },
  sending: { label: "Enviando", className: "bg-yellow-500 text-black hover:bg-yellow-500" },
  completed: { label: "Concluída", className: "bg-green-500 hover:bg-green-500" },
  failed: { label: "Falhou", className: "bg-red-500 hover:bg-red-500" },
  cancelled: { label: "Cancelada", className: "bg-muted text-muted-foreground" },
}

const RECIPIENT_STATUS: Record<CampaignRecipient["status"], { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-muted text-muted-foreground" },
  sent: { label: "Enviada", className: "bg-blue-500 hover:bg-blue-500" },
  delivered: { label: "Entregue", className: "bg-cyan-600 hover:bg-cyan-600" },
  read: { label: "Lida", className: "bg-green-500 hover:bg-green-500" },
  failed: { label: "Falhou", className: "bg-red-500 hover:bg-red-500" },
}

type ContactCandidate = {
  id: string
  name: string | null
  push_name: string | null
  phone: string | null
  email: string | null
  contact_tags: Array<{ tag_id: string }> | null
  imported?: boolean
}

function isValidPhone(phone: string | null): phone is string {
  if (!phone) return false
  return /^\+?\d{10,15}$/.test(phone)
}

function digits(phone: string): string {
  return phone.replace(/\D/g, "")
}

function displayName(c: ContactCandidate): string {
  return c.name?.trim() || c.push_name?.trim() || "Sem nome"
}

function placeholdersOf(components: unknown): number {
  let max = 0
  let text: string
  try {
    text = JSON.stringify(components ?? "")
  } catch {
    return 0
  }
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

// Variáveis com nome ({{nome}}) não funcionam no broadcast da Meta — o app
// usa envio individual por destinatário nesse caso. Retorna os slots nomeados
// em ordem de primeira aparição (a ordem dos valores aceita pela Meta).
function namedSlotsOf(components: unknown): string[] {
  let text: string
  try {
    text = JSON.stringify(components ?? "")
  } catch {
    return []
  }
  const out: string[] = []
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

function hasNamedParams(components: unknown): boolean {
  return namedSlotsOf(components).length > 0
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ---------------------------------------------------------------------------
// Wizard de nova campanha
// ---------------------------------------------------------------------------

type MappingField = "name" | "email" | "phone" | "custom"

type Wizard = {
  step: 1 | 2 | 3
  name: string
  description: string
  templates: ZernioTemplate[]
  templateKey: string // `${name}|${language}`
  mapping: Record<string, { field: MappingField; customValue: string }>
  mode: "now" | "schedule"
  scheduledAt: string
}

function NewCampaignWizard({
  onDone,
  onCancel,
}: {
  onDone: (campaignId: string) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [imported, setImported] = useState<ContactCandidate[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [wizard, setWizard] = useState<Wizard>({
    step: 1,
    name: "",
    description: "",
    templates: [],
    templateKey: "",
    mapping: {},
    mode: "now",
    scheduledAt: "",
  })

  useEffect(() => {
    supabase
      .from("zernio_templates")
      .select("*")
      .eq("status", "APPROVED")
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as ZernioTemplate[]
        setWizard((w) => ({ ...w, templates: list }))
        if (list.length === 1) {
          setWizard((w) => ({ ...w, templateKey: `${list[0].name}|${list[0].language}` }))
        }
      })
  }, [])

  const eligible = useMemo(
    () => imported.filter((c) => isValidPhone(c.phone)),
    [imported],
  )

  function handleImportFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? "")
      const parsed = parseContactsFile(file.name, text)
      if (parsed.length === 0) {
        toast.error("Nenhum telefone reconhecido no arquivo (use CSV/TXT com \"telefone,nome\" por linha, ou .vcf)")
        return
      }
      const known = new Set<string>(imported.map((c) => c.phone ?? ""))
      const fresh: ContactCandidate[] = []
      for (const p of parsed) {
        const d = p.phone ?? ""
        if (!d || known.has(d)) continue
        known.add(d)
        fresh.push(p)
      }
      if (fresh.length === 0) {
        toast.info("Todos os números do arquivo já estão na lista")
        return
      }
      setImported((prev) => [...prev, ...fresh])
      setSelected((prev) => {
        const next = new Set(prev)
        fresh.forEach((c) => next.add(c.id))
        return next
      })
      const skipped = parsed.length - fresh.length
      toast.success(
        `${fresh.length} contato(s) importado(s)${skipped > 0 ? ` (${skipped} duplicados ignorados)` : ""}`,
      )
    }
    reader.readAsText(file)
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return eligible
    return eligible.filter(
      (c) =>
        displayName(c).toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q),
    )
  }, [eligible, search])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const template = useMemo(
    () => wizard.templates.find((t) => `${t.name}|${t.language}` === wizard.templateKey) ?? null,
    [wizard.templates, wizard.templateKey],
  )
  // Slots do template: nomeados ({{nome}}) ou numéricos ({{1}}), em ordem de
  // aparição. Nomeados forçam envio individual (sem broadcast/agendamento).
  const slotLabels = useMemo<string[]>(() => {
    if (!template) return []
    const named = namedSlotsOf(template.components)
    if (named.length > 0) return named.map((n) => `{{${n}}}`)
    const n = placeholdersOf(template.components)
    return Array.from({ length: n }, (_, i) => `{{${i + 1}}}`)
  }, [template])
  const isDirectTemplate = useMemo(
    () => Boolean(template) && namedSlotsOf(template?.components).length > 0,
    [template],
  )
  const placeholderCount = slotLabels.length

  // Template nomeado → envio individual: sem opção de agendar.
  useEffect(() => {
    if (isDirectTemplate) {
      setWizard((w) => (w.mode === "now" ? w : { ...w, mode: "now", scheduledAt: "" }))
    }
  }, [isDirectTemplate])
  const templateBody = useMemo(() => {
    const comps = (template?.components ?? []) as Array<{ type?: string; text?: string }>
    return comps.find((c) => c?.type === "BODY")?.text ?? ""
  }, [template])

  useEffect(() => {
    if (!template) return
    setWizard((w) => {
      const mapping = { ...w.mapping }
      for (let i = 1; i <= placeholderCount; i++) {
        if (!mapping[String(i)]) mapping[String(i)] = { field: "name", customValue: "" }
      }
      for (const k of Object.keys(mapping)) {
        if (parseInt(k, 10) > placeholderCount) delete mapping[k]
      }
      return { ...w, mapping }
    })
  }, [template, placeholderCount])

  const chosen = useMemo(
    () => eligible.filter((c) => selected.has(c.id)),
    [eligible, selected],
  )

  async function handleCreate() {
    if (!template) {
      toast.error("Selecione um template aprovado")
      return
    }
    if (chosen.length === 0) {
      toast.error("Selecione ao menos um contato")
      return
    }
    const variableMapping: Record<string, unknown> = {}
    for (let i = 1; i <= placeholderCount; i++) {
      const m = wizard.mapping[String(i)]
      if (!m) {
        toast.error(`Mapeie a variável ${slotLabels[i - 1] ?? `{{${i}}}`}`)
        return
      }
      variableMapping[String(i)] =
        m.field === "custom"
          ? { field: "custom", customValue: m.customValue }
          : { field: m.field }
    }

    setBusy(true)
    try {
      const data = await zernioCampaignCreate({
        name: wizard.name.trim(),
        description: wizard.description.trim() || undefined,
        template_name: template.name,
        template_language: template.language,
        variable_mapping: variableMapping,
        scheduled_at:
          wizard.mode === "schedule" && wizard.scheduledAt
            ? new Date(wizard.scheduledAt).toISOString()
            : null,
        recipients: chosen.map((c) => ({
          phone: digits(c.phone as string),
          name: displayName(c) === "Sem nome" ? null : displayName(c),
          email: c.email,
        })),
      })
      const campaign = data?.campaign as Campaign | undefined
      if (!campaign) throw new Error("Campanha não criada")

      if (wizard.mode === "now") {
        const direct = campaign.send_mode === "direct"
        if (direct) {
          // Envio individual lote-a-lote: repete até concluir (done) ou estourar
          // o teto de segurança. Cada chamada resolve os nomes por contato.
          let remaining = Infinity
          let guard = 0
          while (remaining > 0 && guard < 200) {
            const r = await zernioCampaignSend(campaign.id)
            remaining = Number(r?.remaining ?? 0)
            guard += 1
            if (guard % 3 === 0) toast.info(`Enviando… faltam ${remaining}`)
          }
          toast.success("Envio concluído! Acompanhe entregues/lidas na campanha.")
        } else {
          await zernioCampaignSend(campaign.id)
          toast.success("Envio iniciado! Acompanhe o progresso na página da campanha.")
        }
      } else {
        toast.success("Campanha agendada")
      }
      onDone(campaign.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar campanha")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onCancel}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
        <span className="text-sm text-muted-foreground">
          Passo {wizard.step} de 3 —{" "}
          {wizard.step === 1 ? "Audiência" : wizard.step === 2 ? "Template" : "Envio"}
        </span>
      </div>

      {wizard.step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Quem recebe?</CardTitle>
            <CardDescription>
              Importe um arquivo com os destinatários. Formatos aceitos: CSV/TXT
              (uma linha por contato — "telefone,nome", "nome,telefone" ou só o
              telefone) e vCard (.vcf). Números sem DDI assumem 55 (Brasil).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="camp-name">Nome da campanha *</Label>
              <Input
                id="camp-name"
                value={wizard.name}
                onChange={(e) => setWizard({ ...wizard, name: e.target.value })}
                placeholder="Promoção de setembro"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="camp-desc">Descrição (opcional)</Label>
              <Input
                id="camp-desc"
                value={wizard.description}
                onChange={(e) => setWizard({ ...wizard, description: e.target.value })}
                placeholder="Interna, para o time lembrar o contexto"
              />
            </div>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.vcf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleImportFile(f)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-primary hover:bg-muted/40"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">
                {eligible.length === 0 ? "Selecionar arquivo de contatos" : "Adicionar outro arquivo"}
              </span>
              <span className="text-xs text-muted-foreground">
                .csv, .txt ou .vcf — telefones duplicados são ignorados
              </span>
            </button>

            {eligible.length > 0 && (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar na lista importada..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        visible.forEach((c) => next.add(c.id))
                        return next
                      })
                    }
                  >
                    Selecionar visíveis
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      setImported([])
                      setSelected(new Set())
                      setSearch("")
                    }}
                  >
                    Limpar tudo
                  </Button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {visible.length} contato(s) na lista · {selected.size} selecionado(s)
                  </span>
                </div>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Nome</TableHead>
                        <TableHead>Telefone</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.slice(0, 300).map((c) => (
                        <TableRow key={c.id} className="cursor-pointer" onClick={() => toggle(c.id)}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={selected.has(c.id)}
                              onChange={() => toggle(c.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </TableCell>
                          <TableCell>{displayName(c)}</TableCell>
                          <TableCell className="text-muted-foreground">{c.phone}</TableCell>
                        </TableRow>
                      ))}
                      {visible.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground">
                            Nenhum contato da lista corresponde à busca.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {visible.length > 300 && (
                    <p className="p-2 text-center text-xs text-muted-foreground">
                      Mostrando os primeiros 300 de {visible.length} — refine a busca.
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel}>
                Cancelar
              </Button>
              <Button
                disabled={!wizard.name.trim() || selected.size === 0}
                onClick={() => setWizard({ ...wizard, step: 2 })}
              >
                Próximo: template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {wizard.step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Template aprovado pela Meta</CardTitle>
            <CardDescription>
              Só templates <strong>APPROVED</strong> iniciam conversa. Variáveis são
              resolvidas por destinatário no momento do envio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {wizard.templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum template aprovado. Crie e aguarde a análise da Meta em
                Configurações → Templates → Templates oficiais (Meta).
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select
                    value={wizard.templateKey}
                    onValueChange={(v) => setWizard({ ...wizard, templateKey: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o template" />
                    </SelectTrigger>
                    <SelectContent>
                      {wizard.templates.map((t) => {
                        const named = hasNamedParams(t.components)
                        return (
                          <SelectItem
                            key={`${t.name}|${t.language}`}
                            value={`${t.name}|${t.language}`}
                          >
                            {t.name} ({t.language}) — {t.category ?? "?"}
                            {named ? " · variáveis nomeadas → envio individual" : ""}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {template && (
                  <>
                    <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
                      {templateBody || "(sem corpo textual)"}
                    </div>
                    {placeholderCount > 0 && (
                      <div className="space-y-2">
                        <Label>Variáveis</Label>
                        {Array.from({ length: placeholderCount }, (_, i) => String(i + 1)).map((pos) => {
                          const m = wizard.mapping[pos] ?? { field: "name" as MappingField, customValue: "" }
                          return (
                            <div key={pos} className="flex items-center gap-2">
                              <code className="w-24 shrink-0 truncate text-sm">
                                {slotLabels[Number(pos) - 1] ?? `{{${pos}}}`}
                              </code>
                              <Select
                                value={m.field}
                                onValueChange={(v) =>
                                  setWizard({
                                    ...wizard,
                                    mapping: {
                                      ...wizard.mapping,
                                      [pos]: { ...m, field: v as MappingField },
                                    },
                                  })
                                }
                              >
                                <SelectTrigger className="w-56">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="name">Nome do contato</SelectItem>
                                  <SelectItem value="email">E-mail do contato</SelectItem>
                                  <SelectItem value="phone">Telefone do contato</SelectItem>
                                  <SelectItem value="custom">Valor fixo</SelectItem>
                                </SelectContent>
                              </Select>
                              {m.field === "custom" && (
                                <Input
                                  className="flex-1"
                                  placeholder="Texto igual para todos"
                                  value={m.customValue}
                                  onChange={(e) =>
                                    setWizard({
                                      ...wizard,
                                      mapping: {
                                        ...wizard.mapping,
                                        [pos]: { ...m, customValue: e.target.value },
                                      },
                                    })
                                  }
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWizard({ ...wizard, step: 1 })}>
                Voltar
              </Button>
              <Button
                disabled={!template}
                onClick={() => setWizard({ ...wizard, step: 3 })}
              >
                Próximo: envio
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {wizard.step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Revisar e enviar</CardTitle>
            <CardDescription>
              Cobre contatos já no Zernio com os dados importados aqui.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3 text-sm">
              <p>
                <span className="font-medium">{wizard.name}</span>
                {wizard.description && (
                  <span className="ml-2 text-muted-foreground">— {wizard.description}</span>
                )}
              </p>
              <p className="mt-1 text-muted-foreground">
                Template: {wizard.templateKey} · Destinatários: {chosen.length}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Quando enviar?</Label>
              {isDirectTemplate ? (
                <p className="text-sm text-muted-foreground">
                  Este template usa variáveis nomeadas — envio individual, imediato
                  (a Meta não oferece agendamento nesse modo). Começa ao criar.
                </p>
              ) : (
                <>
                  <Select
                    value={wizard.mode}
                    onValueChange={(v) => setWizard({ ...wizard, mode: v as Wizard["mode"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="now">Agora, ao criar a campanha</SelectItem>
                      <SelectItem value="schedule">Agendar para data/hora</SelectItem>
                    </SelectContent>
                  </Select>
                  {wizard.mode === "schedule" && (
                    <Input
                      type="datetime-local"
                      value={wizard.scheduledAt}
                      onChange={(e) => setWizard({ ...wizard, scheduledAt: e.target.value })}
                    />
                  )}
                </>
              )}
            </div>
            <p className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-xs text-muted-foreground">
              A Meta cobra por mensagem de template. Contas novas estão no tier
              inicial (~250 contatos únicos/dia) — acima disso o excedente falha e
              pode ser reenviado amanhã. Revise a lista: mensagens de marketing não
              podem ser retiradas.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWizard({ ...wizard, step: 2 })}>
                Voltar
              </Button>
              <Button disabled={busy} onClick={handleCreate}>
                {busy
                  ? isDirectTemplate
                    ? "Enviando individual…"
                    : "Criando..."
                  : wizard.mode === "now"
                    ? `Enviar para ${chosen.length} contato(s)`
                    : "Criar campanha agendada"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detalhe da campanha
// ---------------------------------------------------------------------------

function CampaignDetail({
  campaignId,
  onBack,
}: {
  campaignId: string
  onBack: () => void
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testPhone, setTestPhone] = useState("")
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const pageSize = 50

  const load = useCallback(async () => {
    const { data: c } = await supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle()
    setCampaign((c as Campaign) ?? null)

    let query = supabase
      .from("campaign_recipients")
      .select("*", { count: "exact" })
      .eq("campaign_id", campaignId)
      .order("status", { ascending: true })
      .order("phone")
      .range(offset, offset + pageSize - 1)
    if (statusFilter !== "all") query = query.eq("status", statusFilter)
    const { data, count } = await query
    setRecipients((data as CampaignRecipient[]) ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [campaignId, statusFilter, offset])

  useEffect(() => {
    load()
  }, [load])

  async function handleSync() {
    setSyncing(true)
    try {
      const data = await zernioCampaignSync(campaignId)
      if (data?.error) throw new Error(data.error)
      toast.success("Status atualizado com a Zernio")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao sincronizar")
    } finally {
      setSyncing(false)
    }
  }

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-muted-foreground">Carregando...</p>
  if (!campaign) return <p className="text-muted-foreground">Campanha não encontrada.</p>

  const sm = CAMPAIGN_STATUS[campaign.status]
  const active = campaign.status === "sending" || campaign.status === "scheduled"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Campanhas
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", syncing && "animate-spin")} />
            {syncing ? "Sincronizando..." : "Atualizar status"}
          </Button>
          {campaign.status === "draft" && (
            <Button
              disabled={busy}
              onClick={() =>
                withBusy(async () => {
                  try {
                    if (campaign.send_mode === "direct") {
                      let remaining = Infinity
                      let guard = 0
                      while (remaining > 0 && guard < 200) {
                        const r = await zernioCampaignSend(campaign.id)
                        remaining = Number(r?.remaining ?? 0)
                        guard += 1
                        if (guard % 3 === 0) toast.info(`Enviando… faltam ${remaining}`)
                      }
                      toast.success("Envio concluído")
                    } else {
                      await zernioCampaignSend(campaign.id)
                      toast.success("Envio iniciado")
                    }
                    await load()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Falha ao enviar")
                  }
                })
              }
            >
              <Send className="mr-2 h-4 w-4" />
              {busy ? "Enviando..." : "Enviar agora"}
            </Button>
          )}
          {(campaign.status === "draft" || campaign.status === "scheduled") && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                withBusy(async () => {
                  try {
                    await zernioCampaignCancel(campaign.id)
                    toast.success("Campanha cancelada")
                    await load()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Falha ao cancelar")
                  }
                })
              }
            >
              <Trash2 className="mr-2 h-4 w-4 text-destructive" />
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {campaign.name} <Badge className={sm.className}>{sm.label}</Badge>
            {campaign.send_mode === "direct" && (
              <Badge variant="secondary">envio individual</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Template {campaign.template_name} ({campaign.template_language}) ·{" "}
            {campaign.scheduled_at
              ? `Agendada: ${formatDateTime(campaign.scheduled_at)}`
              : campaign.started_at
                ? `Enviada: ${formatDateTime(campaign.started_at)}`
                : `Criada: ${formatDateTime(campaign.created_at)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {campaign.last_error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-600">
              {campaign.last_error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              { label: "Destinatários", value: campaign.recipient_count },
              { label: "Enviadas", value: campaign.sent_count },
              { label: "Entregues", value: campaign.delivered_count },
              { label: "Lidas", value: campaign.read_count },
              { label: "Falhas", value: campaign.failed_count },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-semibold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          {campaign.recipient_count > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${Math.round((campaign.delivered_count / campaign.recipient_count) * 100)}%` }}
              />
            </div>
          )}
          {active && (
            <p className="text-xs text-muted-foreground">
              Dica: os status chegam por webhook; “Atualizar status” força a
              sincronização com a Zernio.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              className="max-w-56"
              placeholder="Testar em um número (5511...)"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={!isValidPhone(testPhone) || busy}
              onClick={() =>
                withBusy(async () => {
                  try {
                    await zernioCampaignTest(campaign.id, digits(testPhone))
                    toast.success("Mensagem de teste enviada")
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Falha no teste")
                  }
                })
              }
            >
              Enviar teste
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destinatários</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v)
                setOffset(0)
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="sent">Enviadas</SelectItem>
                <SelectItem value="delivered">Entregues</SelectItem>
                <SelectItem value="read">Lidas</SelectItem>
                <SelectItem value="failed">Falhas</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{total} registro(s)</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telefone</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead>Entregue/Lida</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => {
                const rs = RECIPIENT_STATUS[r.status]
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.phone}</TableCell>
                    <TableCell>{r.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={rs.className}>{rs.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={r.error ?? undefined}>
                      {r.error ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(r.read_at ?? r.delivered_at ?? r.sent_at)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {recipients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhum destinatário neste filtro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
            >
              Anterior
            </Button>
            <span className="text-muted-foreground">
              {offset + 1}–{Math.min(offset + pageSize, total)} de {total}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + pageSize >= total}
              onClick={() => setOffset(offset + pageSize)}
            >
              Próxima
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function Campaigns() {
  const [view, setView] = useState<"list" | "new" | "detail">("list")
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    const { data: campaignsData } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
    setCampaigns((campaignsData as Campaign[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (view === "list") loadList()
  }, [view, loadList])

  if (view === "new") {
    return (
      <div className="h-full overflow-y-auto p-6">
        <NewCampaignWizard
          onCancel={() => setView("list")}
          onDone={(id) => {
            setSelectedId(id)
            setView("detail")
          }}
        />
      </div>
    )
  }

  if (view === "detail" && selectedId) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <CampaignDetail campaignId={selectedId} onBack={() => setView("list")} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Megaphone className="h-5 w-5" /> Campanhas WhatsApp
        </h1>
        <Button onClick={() => setView("new")}>
          <Plus className="mr-2 h-4 w-4" /> Nova campanha
        </Button>
      </header>
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : campaigns.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Megaphone className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                Nenhuma campanha ainda. Conecte o WhatsApp oficial (Meta) em
                Configurações → WhatsApp, crie um template aprovado e dispare para
                sua base.
              </p>
              <Button onClick={() => setView("new")}>
                <Plus className="mr-2 h-4 w-4" /> Criar primeira campanha
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Enviadas</TableHead>
                <TableHead className="text-right">Entregues</TableHead>
                <TableHead className="text-right">Lidas</TableHead>
                <TableHead className="text-right">Falhas</TableHead>
                <TableHead>Criada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const sm = CAMPAIGN_STATUS[c.status]
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedId(c.id)
                      setView("detail")
                    }}
                  >
                    <TableCell className="font-medium">
                      {c.name}
                      {c.description && (
                        <p className="text-xs font-normal text-muted-foreground">{c.description}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.template_name}
                    </TableCell>
                    <TableCell>
                      <Badge className={sm.className}>{sm.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.sent_count}/{c.recipient_count}</TableCell>
                    <TableCell className="text-right">{c.delivered_count}</TableCell>
                    <TableCell className="text-right">{c.read_count}</TableCell>
                    <TableCell className={cn("text-right", c.failed_count > 0 && "text-red-600")}>
                      {c.failed_count}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(c.created_at)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
