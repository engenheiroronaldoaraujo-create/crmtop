import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Paperclip,
  Phone,
  Plus,
  Send,
  UserPlus,
  X,
  Zap,
  ZapOff,
} from "lucide-react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { proxyLinkConversationPhone, proxySendMedia, proxySendText } from "@/lib/api"
import {
  contactDisplayName,
  cn,
  formatDayLabel,
  formatListTime,
  formatPhone,
  formatTime,
  isRealPhone,
  isSameDay,
} from "@/lib/utils"
import type {
  Conversation,
  Message,
  Profile,
  WhatsAppInstance,
  Opportunity,
  Pipeline,
  PipelineStage,
} from "@/lib/types"
import { useAuth } from "@/hooks/use-auth"
import { useContactTags, useTags } from "@/hooks/use-tags"
import { useAI } from "@/hooks/use-ai"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Filter = "all" | "mine" | "unassigned"

function MediaMessage({ msg }: { msg: Message }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!msg.media_url) return
    let cancelled = false
    supabase.storage
      .from("whatsapp-media")
      .createSignedUrl(msg.media_url, 3600)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error("createSignedUrl", error)
        } else {
          setUrl(data.signedUrl)
        }
      })
    return () => {
      cancelled = true
    }
  }, [msg.media_url])

  if (!msg.media_url) {
    if (msg.type === "audio") return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4" /> Áudio</div>
    if (msg.type === "image") return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Paperclip className="h-4 w-4" /> Imagem</div>
    if (msg.type === "video") return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Paperclip className="h-4 w-4" /> Vídeo</div>
    if (msg.type === "document") return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Paperclip className="h-4 w-4" /> {msg.content || "Documento"}</div>
    return <span className="italic">Mídia indisponível</span>
  }
  if (!url) {
    return <Loader2 className="h-4 w-4 animate-spin" />
  }

  switch (msg.type) {
    case "image":
    case "sticker":
      return (
        <img
          src={url}
          alt={msg.content ?? "Imagem"}
          className={cn(
            "max-h-72 rounded-md object-cover",
            msg.type === "sticker" && "max-h-40 w-40 object-contain",
          )}
        />
      )
    case "audio":
      return <audio controls src={url} className="max-w-60" />
    case "video":
      return <video controls src={url} className="max-h-72 rounded-md" />
    case "document":
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm underline underline-offset-2"
        >
          <Paperclip className="h-4 w-4" />
          {msg.content || "Download"}
        </a>
      )
    default:
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-2"
        >
          Download
        </a>
      )
  }
}

function MessageBubble({ msg }: { msg: Message }) {
  const outbound = msg.direction === "outbound"
  const showStatus = outbound
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] space-y-1 rounded-2xl px-3 py-2 text-sm shadow-sm",
          outbound
            ? "bg-blue-600 text-white"
            : "border border-border bg-white text-foreground",
        )}
      >
        {msg.media_url && <MediaMessage msg={msg} />}
        {msg.content && (
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        )}
        {!msg.content && !msg.media_url && msg.type === "unknown" && (
          <p className="italic opacity-70">Mensagem não suportada</p>
        )}
        <p
          className={cn(
            "text-right text-[10px] leading-none",
            outbound ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {formatTime(msg.sent_at)}
          {showStatus && <MessageStatus status={msg.status} />}
        </p>
      </div>
    </div>
  )
}

function MessageStatus({ status }: { status: Message["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="ml-1" title="Pendente">
          <Clock className="h-3 w-3" />
        </span>
      )
    case "delivered":
      return (
        <span className="ml-1" title="Entregue">
          <CheckCheck className="h-3 w-3" />
        </span>
      )
    case "read":
      return (
        <span className="ml-1 text-sky-300" title="Lida">
          <CheckCheck className="h-3 w-3" />
        </span>
      )
    case "failed":
      return (
        <span className="ml-1 text-red-400" title="Falhou ao enviar">
          <AlertTriangle className="h-3 w-3" />
        </span>
      )
    default:
      return (
        <span className="ml-1" title="Enviada">
          <Check className="h-3 w-3" />
        </span>
      )
  }
}

function ConversationItem({
  conv,
  selected,
  onSelect,
}: {
  conv: Conversation
  selected: boolean
  onSelect: (id: string) => void
}) {
  const name = conv.contact ? contactDisplayName(conv.contact) : conv.contact_id
  const closed = conv.status === "closed"
  const hasUnread = conv.unread_count > 0

  return (
    <button
      onClick={() => onSelect(conv.id)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all",
        selected
          ? "border-blue-500 bg-blue-50 shadow-sm"
          : "border-border bg-white hover:border-blue-200 hover:bg-blue-50/50",
        closed && "opacity-50",
        hasUnread && !selected && "border-l-4 border-l-blue-500 bg-blue-50/30",
      )}
    >
      <Avatar className={cn("mt-0.5 h-10 w-10 shrink-0", selected && "ring-2 ring-blue-500")}>
        <AvatarFallback className={cn(
          "text-sm font-semibold",
          selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
        )}>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn("truncate text-sm", selected ? "font-bold text-blue-900" : "font-medium text-slate-800")}>{name}</p>
          {conv.last_message_at && (
            <span className="shrink-0 text-xs text-slate-400">
              {formatListTime(conv.last_message_at)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-500">
            {conv.contact && isRealPhone(conv.contact.phone) && formatPhone(conv.contact.phone)}
            {conv.assignee && (
              <span className="ml-1 inline-flex items-center gap-1 text-blue-600">
                <CheckCircle2 className="h-3 w-3" />
                {conv.assignee.full_name ?? "?"}
              </span>
            )}
          </p>
          {conv.unread_count > 0 && (
            <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 bg-blue-600 text-white">
              {conv.unread_count}
            </Badge>
          )}
        </div>
        {conv.last_message_preview && (
          <p className="truncate text-xs text-slate-400">
            {conv.last_message_preview}
          </p>
        )}
      </div>
    </button>
  )
}

export default function ChatPage() {
  const { user, profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [profiles, setProfiles] = useState<Pick<Profile, "id" | "full_name">[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [text, setText] = useState("")
  const [pendingFile, setPendingFile] = useState<{ file: File } | null>(null)
  const [sending, setSending] = useState(false)

  // SDR state for current conversation
  const [sdrStatus, setSdrStatus] = useState<string | null>(null)
  const [sdrToggling, setSdrToggling] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selected = conversations.find((c) => c.id === selectedId) ?? null

  // AI
  const ai = useAI()
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiTitle, setAiTitle] = useState("")

  // --- Funil: oportunidades do contato selecionado ---
  const [contactOpps, setContactOpps] = useState<Opportunity[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [oppStages, setOppStages] = useState<PipelineStage[]>([])
  const [oppDialogOpen, setOppDialogOpen] = useState(false)
  const [oppSaving, setOppSaving] = useState(false)
  const [oppTitle, setOppTitle] = useState("")
  const [oppValue, setOppValue] = useState("")
  const [oppDesc, setOppDesc] = useState("")
  const [oppPipelineId, setOppPipelineId] = useState("")
  const [oppStageId, setOppStageId] = useState("")
  const [oppAllProfiles, setOppAllProfiles] = useState<Pick<Profile, "id" | "full_name">[]>([])
  void oppAllProfiles // reserved for assign dialog

  // --- Tags ---
  const { tags: allTags } = useTags()
  const { contactTags, addTag: addContactTag, removeTag: removeContactTag } = useContactTags(selected?.contact_id ?? null)
  const [tagSearch, setTagSearch] = useState("")
  const [tagMenuOpen, setTagMenuOpen] = useState(false)

  const loadContactOpps = useCallback(async (contactId: string) => {
    const { data } = await supabase
      .from("opportunities")
      .select("*, stage:pipeline_stages(name, color), assignee:profiles(id, full_name)")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
    setContactOpps((data as unknown as Opportunity[]) ?? [])
  }, [])

  useEffect(() => {
    if (selected?.contact_id) loadContactOpps(selected.contact_id)
    else setContactOpps([])
  }, [selected?.contact_id, loadContactOpps])

  useEffect(() => {
    supabase.from("pipelines").select("*").eq("is_active", true).then(({ data }) => {
      const pls = (data ?? []) as Pipeline[]
      setPipelines(pls)
      if (pls.length > 0 && !oppPipelineId) setOppPipelineId(pls[0].id)
    })
    supabase.from("profiles").select("id, full_name").order("full_name").then(({ data }) => {
      setOppAllProfiles((data as Pick<Profile, "id" | "full_name">[]) ?? [])
    })
  }, [])

  useEffect(() => {
    if (!oppPipelineId) return
    supabase.from("pipeline_stages").select("*").eq("pipeline_id", oppPipelineId).eq("is_active", true).order("position").then(({ data }) => {
      const sts = (data ?? []) as PipelineStage[]
      setOppStages(sts)
      if (sts.length > 0) setOppStageId(sts[0].id)
    })
  }, [oppPipelineId])

  const handleCreateOpp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected?.contact_id) return
    setOppSaving(true)
    try {
      const { error } = await supabase.from("opportunities").insert({
        contact_id: selected.contact_id,
        pipeline_id: oppPipelineId,
        stage_id: oppStageId,
        title: oppTitle.trim() || `Oportunidade - ${contactDisplayName(selected.contact ?? {})}`,
        value: oppValue ? parseFloat(oppValue) : null,
        description: oppDesc.trim() || null,
        assigned_to: user?.id ?? null,
        created_by: user?.id ?? null,
        conversation_id: selected.id,
      })
      if (error) throw error
      setOppDialogOpen(false)
      setOppTitle("")
      setOppValue("")
      setOppDesc("")
      toast.success("Oportunidade criada no funil")
      loadContactOpps(selected.contact_id)
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao criar oportunidade")
    } finally {
      setOppSaving(false)
    }
  }

  const openOppDialog = () => {
    setOppTitle("")
    setOppValue("")
    setOppDesc("")
    if (pipelines.length > 0) setOppPipelineId(pipelines[0].id)
    setOppDialogOpen(true)
  }

  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("*, contact:contacts(*), assignee:profiles(id, full_name)")
      .order("last_message_at", { ascending: false, nullsFirst: false })
    if (error) {
      toast.error(error.message)
    } else {
      setConversations((data as unknown as Conversation[]) ?? [])
    }
    setLoadingConversations(false)
  }, [])

  const markRead = useCallback(async (id: string) => {
    await supabase.rpc("mark_conversation_read", { p_conversation_id: id })
  }, [])

  useEffect(() => {
    supabase
      .from("whatsapp_instances")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setInstances((data as WhatsAppInstance[]) ?? [])
      })
    supabase
      .from("profiles")
      .select("id, full_name")
      .order("full_name")
      .then(({ data, error }) => {
        if (!error) setProfiles((data as Pick<Profile, "id" | "full_name">[]) ?? [])
      })
    loadConversations()
  }, [loadConversations])

  // Select conversation from URL (opened from Contacts, Pipeline, Agenda, etc.)
  useEffect(() => {
    const contactPhone = searchParams.get("contact")
    const conversationId = searchParams.get("conversation")
    const contactIdParam = searchParams.get("contactId")

    if (conversations.length > 0 && !selectedId) {
      if (conversationId) {
        // Open by conversation ID
        const match = conversations.find((c) => c.id === conversationId)
        if (match) setSelectedId(match.id)
        setSearchParams({}, { replace: true })
      } else if (contactIdParam) {
        // Open by contact ID
        const match = conversations.find((c) => c.contact_id === contactIdParam)
        if (match) setSelectedId(match.id)
        setSearchParams({}, { replace: true })
      } else if (contactPhone) {
        // Open by contact phone (legacy)
        const match = conversations.find(
          (c) => c.contact && c.contact.phone === contactPhone,
        )
        if (match) setSelectedId(match.id)
        setSearchParams({}, { replace: true })
      }
    }
  }, [conversations, searchParams, selectedId, setSearchParams])

  // Load messages for the selected conversation and mark it read.
  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    let active = true
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", selectedId)
      .order("sent_at", { ascending: true })
      .then(({ data, error }) => {
        if (active && !error) setMessages((data as Message[]) ?? [])
      })
    markRead(selectedId)
    return () => {
      active = false
    }
  }, [selectedId, markRead])

  // Load SDR status for selected conversation
  useEffect(() => {
    if (!selectedId) { setSdrStatus(null); return }
    supabase
      .from("sdr_conversations")
      .select("status")
      .eq("conversation_id", selectedId)
      .maybeSingle()
      .then(({ data }) => setSdrStatus(data?.status ?? null))
  }, [selectedId])

  const toggleSDR = async () => {
    if (!selectedId) return
    setSdrToggling(true)
    try {
      if (sdrStatus === "active" || sdrStatus === null) {
        // Pause SDR (create record if doesn't exist)
        await supabase
          .from("sdr_conversations")
          .upsert({
            conversation_id: selectedId,
            contact_id: selected?.contact_id,
            status: "paused_human",
          }, { onConflict: "conversation_id" })
        setSdrStatus("paused_human")
        toast.success("SDR pausado nesta conversa")
      } else {
        // Resume SDR
        await supabase
          .from("sdr_conversations")
          .update({ status: "active" })
          .eq("conversation_id", selectedId)
        setSdrStatus("active")
        toast.success("SDR reativado nesta conversa")
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSdrToggling(false)
    }
  }

  // Realtime: conversation list updates (new/updated conversations).
  useEffect(() => {
    const channel = supabase
      .channel("crm-conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => loadConversations(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadConversations])

  // Realtime: new messages in the selected conversation.
  useEffect(() => {
    if (!selectedId) return
    const channel = supabase
      .channel(`crm-messages-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const msg = payload.new as Message
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          )
          if (msg.direction === "inbound") markRead(selectedId)
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const msg = payload.new as Message
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? msg : m)),
          )
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedId, markRead])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      if (filter === "mine" && c.assigned_to !== user?.id) return false
      if (filter === "unassigned" && c.assigned_to !== null) return false
      if (q) {
        const name = c.contact ? contactDisplayName(c.contact).toLowerCase() : ""
        const phone = c.contact?.phone ?? ""
        if (!name.includes(q) && !phone.includes(q)) return false
      }
      return true
    })
  }, [conversations, filter, query, user?.id])

  const instance = instances[0] ?? null

  async function handleSelect(id: string) {
    setSelectedId(id)
  }

  async function handleAssign(conv: Conversation, assigneeId: string | null) {
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_to: assigneeId })
      .eq("id", conv.id)
    if (error) toast.error(error.message)
  }

  // AI handlers
  async function handleAISummary() {
    if (!selected) return
    setAiTitle("Resumo da Conversa")
    setAiResult(null)
    const result = await ai.summarizeConversation(selected.id)
    if (result) {
      setAiResult(
        `**Resumo:** ${result.summary}\n\n` +
        `**Cliente deseja:** ${result.client_want}\n\n` +
        `**Necessidade:** ${result.needs}\n\n` +
        `**Objeções:** ${result.objections}\n\n` +
        `**Valor mencionado:** ${result.mentioned_value}\n\n` +
        `**Próximo passo:** ${result.next_step}`
      )
    }
  }

  async function handleAISuggestReply() {
    if (!selected) return
    setAiTitle("Sugestão de Resposta")
    setAiResult(null)
    const result = await ai.suggestReply(selected.id)
    if (result) {
      setAiResult(
        `**Resposta sugerida:**\n${result.reply}\n\n` +
        `**Tom:** ${result.tone}\n` +
        `**Confiança:** ${Math.round(result.confidence * 100)}%`
      )
    }
  }

  async function handleAIAnalyzeLead() {
    if (!selected) return
    setAiTitle("Análise do Lead")
    setAiResult(null)
    const result = await ai.analyzeLead(selected.id)
    if (result) {
      const tempIcon = result.temperature === "hot" ? "🔥" : result.temperature === "warm" ? "🟡" : "❄"
      setAiResult(
        `**Intenção:** ${result.intent}\n` +
        `**Temperatura:** ${tempIcon} ${result.temperature}\n` +
        `**Motivo:** ${result.temperature_reason}\n` +
        `**Confiança:** ${Math.round(result.confidence * 100)}%\n\n` +
        `**Estágio sugerido:** ${result.suggested_stage}\n` +
        `**Tags sugeridas:** ${result.suggested_tags.join(", ")}\n\n` +
        `**Próxima ação:** ${result.next_action}`
      )
    }
  }

  async function handleAISummaryClient() {
    if (!selected?.contact_id) return
    setAiTitle("Resumo do Cliente")
    setAiResult(null)
    const result = await ai.summarizeClient(selected.contact_id)
    if (result) setAiResult(result)
  }

  async function handleToggleStatus(conv: Conversation) {
    const next = conv.status === "open" ? "closed" : "open"
    const { error } = await supabase
      .from("conversations")
      .update({ status: next })
      .eq("id", conv.id)
    if (error) toast.error(error.message)
  }

  async function handleLinkPhone(conv: Conversation) {
    const phone = window.prompt(
      "Informe o telefone deste contato (com DDI, ex.: 5511940136791):",
      "",
    )
    if (!phone) return
    const digits = phone.replace(/\D/g, "")
    if (digits.length < 10 || digits.length > 13) {
      toast.error("Telefone inválido — use 10 a 13 dígitos (ex.: 5511940136791)")
      return
    }
    try {
      await proxyLinkConversationPhone(conv.id, digits)
      toast.success("Telefone vinculado ao contato")
      loadConversations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao vincular telefone")
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    if (!text.trim() && !pendingFile) return
    if (!instance) {
      toast.error("Nenhuma instância configurada — veja Configurações")
      return
    }
    if (instance.status !== "connected") {
      toast.error("WhatsApp não está conectado")
      return
    }
    if (selected.contact && !isRealPhone(selected.contact.phone)) {
      toast.error("Este contato não possui telefone cadastrado (contato via ID do WhatsApp).")
      return
    }
    const targetPhone = selected.contact?.phone ?? ""
    setSending(true)
    try {
      if (pendingFile) {
        await proxySendMedia(
          selected.instance_id,
          targetPhone,
          text.trim(),
          pendingFile.file.name,
          pendingFile.file,
        )
      } else {
        await proxySendText(selected.instance_id, targetPhone, text.trim(), instance?.instance_name)
      }
      setText("")
      setPendingFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar")
    } finally {
      setSending(false)
    }
  }

  // Group messages by day for separators.
  const groupedMessages = useMemo(() => {
    const groups: { day: string; items: Message[] }[] = []
    for (const msg of messages) {
      const last = groups[groups.length - 1]
      if (last && isSameDay(last.day, msg.sent_at)) {
        last.items.push(msg)
      } else {
        groups.push({ day: msg.sent_at, items: [msg] })
      }
    }
    return groups
  }, [messages])

  const contactName = selected?.contact
    ? contactDisplayName(selected.contact)
    : ""

  return (
    <>
    <div className="flex h-full min-h-0">
      {/* Left: conversation list */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex gap-1">
              {(
                [
                  ["all", "Todas"],
                  ["mine", "Minhas"],
                  ["unassigned", "Sem dono"],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? "default" : "ghost"}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <Input
            placeholder="Buscar conversa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loadingConversations ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {conversations.length === 0
                ? "Nenhuma conversa ainda. Quando alguém mandar mensagem, aparece aqui."
                : "Nada encontrado."}
            </p>
          ) : (
            filtered.map((c) => (
              <ConversationItem
                key={c.id}
                conv={c}
                selected={c.id === selectedId}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>
      </aside>

      {/* Right: thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            {!instance && (
              <>
                <p className="text-sm">
                  Nenhuma instância do WhatsApp configurada.
                </p>
                {profile?.role === "admin" ? (
                  <p className="text-sm">
                    Vá em <b>Configurações → WhatsApp</b> para criar e parear.
                  </p>
                ) : (
                  <p className="text-sm">Peça ao admin para configurar o WhatsApp.</p>
                )}
              </>
            )}
            {instance && (
              <p className="text-sm">Selecione uma conversa para começar.</p>
            )}
          </div>
        ) : (
          <>
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">{contactName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.contact && isRealPhone(selected.contact.phone)
                    ? formatPhone(selected.contact.phone)
                    : selected.contact?.lid
                      ? contactDisplayName(selected.contact)
                      : "WhatsApp"}
                  {" · "}
                  {instance
                    ? instance.status === "connected"
                      ? "conectado"
                      : "WhatsApp desconectado"
                    : "sem instância"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selected.assigned_to === user?.id ? (
                  <Badge variant="secondary">Atribuída a você</Badge>
                ) : selected.assigned_to ? (
                  <Badge variant="outline">
                    {selected.assignee?.full_name ?? "Atribuída"}
                  </Badge>
                ) : (
                  <Badge variant="outline">Não atribuída</Badge>
                )}
                <Button variant="outline" size="sm" onClick={openOppDialog}>
                  <FlaskConical className="mr-1 h-4 w-4" /> Adicionar ao Funil
                </Button>
                <Button
                  variant={sdrStatus === "active" ? "default" : "outline"}
                  size="sm"
                  onClick={toggleSDR}
                  disabled={sdrToggling}
                  className={sdrStatus === "active" ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                >
                  {sdrToggling ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : sdrStatus === "active" ? (
                    <Zap className="mr-1 h-3 w-3" />
                  ) : (
                    <ZapOff className="mr-1 h-3 w-3" />
                  )}
                  {sdrStatus === "active" ? "SDR Ativo" : sdrStatus === "paused_human" ? "SDR Pausado" : "SDR Desligado"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      ✨ IA
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => handleAISummary()}>
                      Resumir conversa
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleAISuggestReply()}>
                      Sugerir resposta
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleAIAnalyzeLead()}>
                      Analisar lead
                    </DropdownMenuItem>
                    {selected?.contact_id && (
                      <DropdownMenuItem onClick={() => handleAISummaryClient()}>
                        Resumo do cliente
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <UserPlus className="mr-1 h-4 w-4" /> Atribuir
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Atribuir conversa</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleAssign(selected, user?.id ?? null)}>
                      A mim
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {profiles
                      .filter((p) => p.id !== user?.id)
                      .map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => handleAssign(selected, p.id)}
                        >
                          {p.full_name ?? p.id.slice(0, 8)}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleToggleStatus(selected)}
                >
                  {selected.status === "open" ? "Fechar" : "Reabrir"}
                </Button>
                {selected.contact && !isRealPhone(selected.contact.phone) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLinkPhone(selected)}
                  >
                    <Phone className="mr-1 h-4 w-4" /> Vincular telefone
                  </Button>
                )}
              </div>
            </header>

            {/* Etiquetas do contato */}
            {selected?.contact_id && (
              <div className="flex items-center gap-1 border-b bg-muted/20 px-4 py-1.5">
                {contactTags.map((ct: any) => (
                  <Badge
                    key={ct.tag_id}
                    variant="outline"
                    className="gap-1 text-xs"
                    style={{ borderColor: ct.tag?.color, color: ct.tag?.color }}
                  >
                    {ct.tag?.name}
                    <button
                      onClick={() => removeContactTag(ct.tag_id)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </Badge>
                ))}
                <DropdownMenu open={tagMenuOpen} onOpenChange={setTagMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs">
                      <Plus className="h-3 w-3" /> Etiqueta
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <div className="p-2">
                      <Input
                        placeholder="Buscar etiqueta..."
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    {allTags
                      .filter((t) => !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase()))
                      .map((tag) => {
                        const hasTag = contactTags.some((ct: any) => ct.tag_id === tag.id)
                        return (
                          <DropdownMenuItem
                            key={tag.id}
                            onClick={() => hasTag ? removeContactTag(tag.id) : addContactTag(tag.id)}
                          >
                            <span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                            {hasTag && <Check className="ml-auto h-3 w-3" />}
                          </DropdownMenuItem>
                        )
                      })}
                    {allTags.filter((t) => !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase())).length === 0 && (
                      <p className="p-2 text-center text-xs text-muted-foreground">Nenhuma etiqueta</p>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Oportunidades do contato */}
            {contactOpps.length > 0 && (
              <div className="border-b bg-muted/30 px-4 py-2">
                <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  Oportunidades ({contactOpps.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {contactOpps.map((opp) => (
                    <div
                      key={opp.id}
                      className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: (opp.stage as any)?.color ?? "#94a3b8" }}
                      />
                      <span className="font-medium">{opp.title}</span>
                      <span className="text-muted-foreground">
                        {(opp.stage as any)?.name ?? "—"}
                      </span>
                      {opp.status !== "open" && (
                        <Badge
                          variant={opp.status === "won" ? "default" : "destructive"}
                          className="h-4 px-1 text-[10px]"
                        >
                          {opp.status === "won" ? "Ganho" : "Perdido"}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Result Panel */}
            {aiResult && (
              <div className="border-b bg-purple-50 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="mb-1 text-xs font-semibold text-purple-700">✨ {aiTitle}</p>
                    <div className="whitespace-pre-wrap text-sm text-foreground">
                      {aiResult.split("\n").map((line, i) => {
                        if (line.startsWith("**") && line.endsWith("**")) {
                          return <p key={i} className="mt-1 font-semibold">{line.replace(/\*\*/g, "")}</p>
                        }
                        return <p key={i}>{line}</p>
                      })}
                    </div>
                  </div>
                  <button onClick={() => setAiResult(null)} className="text-purple-400 hover:text-purple-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Loading indicator for AI */}
            {ai.loading && (
              <div className="border-b bg-purple-50 px-4 py-2">
                <div className="flex items-center gap-2 text-sm text-purple-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  ✨ IA analisando...
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {groupedMessages.length === 0 ? (
                <p className="pt-10 text-center text-sm text-muted-foreground">
                  Sem mensagens nesta conversa.
                </p>
              ) : (
                groupedMessages.map((group) => (
                  <div key={group.day} className="space-y-3">
                    <div className="flex justify-center">
                      <span className="rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground">
                        {formatDayLabel(group.day)}
                      </span>
                    </div>
                    {group.items.map((msg) => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))}
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleSend}
              className="flex shrink-0 items-end gap-2 border-t p-3"
            >
              {pendingFile && (
                <div className="flex max-w-60 items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{pendingFile.file.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ""
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) setPendingFile({ file })
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                title="Anexar"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={pendingFile ? "Legenda (opcional)..." : "Digite uma mensagem..."}
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                disabled={sending || (!text.trim() && !pendingFile)}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        )}
      </section>

      {/* Dialog: Criar Oportunidade no Funil */}
      <Dialog open={oppDialogOpen} onOpenChange={setOppDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar ao Funil</DialogTitle>
            <DialogDescription>
              Criar uma oportunidade para {selected?.contact ? contactDisplayName(selected.contact) : ""}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOpp} className="space-y-4">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={oppPipelineId} onValueChange={setOppPipelineId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estágio</Label>
              <Select value={oppStageId} onValueChange={setOppStageId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {oppStages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat-opp-title">Título</Label>
              <Input
                id="chat-opp-title"
                value={oppTitle}
                onChange={(e) => setOppTitle(e.target.value)}
                placeholder="Ex: Serviço de rastreamento"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="chat-opp-value">Valor (R$)</Label>
                <Input
                  id="chat-opp-value"
                  type="number"
                  step="0.01"
                  min="0"
                  value={oppValue}
                  onChange={(e) => setOppValue(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Responsável</Label>
                <Input value={profile?.full_name ?? ""} disabled />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat-opp-desc">Descrição</Label>
              <Textarea
                id="chat-opp-desc"
                value={oppDesc}
                onChange={(e) => setOppDesc(e.target.value)}
                placeholder="Detalhes..."
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOppDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={oppSaving}>
                {oppSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar oportunidade
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </>
  )
}
