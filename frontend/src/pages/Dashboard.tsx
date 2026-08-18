import { useCallback, useEffect, useMemo, useState } from "react"
import {
  TrendingUp,
  Users,
  DollarSign,
  Trophy,
  XCircle,
  Clock,
  BarChart3,
  ArrowRight,
  RefreshCw,
  Target,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Period = "today" | "7d" | "30d" | "month" | "quarter"

interface KPI {
  label: string
  value: string | number
  icon: any
  color: string
  change?: number
  subtitle?: string
}

interface PipelineStage {
  name: string
  color: string
  count: number
  value: number
}

interface SellerPerformance {
  name: string
  opportunities: number
  pipeline: number
  won: number
  wonValue: number
  conversion: number
}

interface Alert {
  icon: any
  label: string
  count: number
  color: string
  action?: string
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function getPeriodRange(period: Period): { from: string; to: string; label: string } {
  const now = new Date()
  const to = now.toISOString()
  let from: string
  let label: string

  switch (period) {
    case "today":
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      label = "Hoje"
      break
    case "7d":
      from = new Date(now.getTime() - 7 * 86400000).toISOString()
      label = "Últimos 7 dias"
      break
    case "30d":
      from = new Date(now.getTime() - 30 * 86400000).toISOString()
      label = "Últimos 30 dias"
      break
    case "month":
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      label = "Este mês"
      break
    case "quarter":
      from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString()
      label = "Este trimestre"
      break
    default:
      from = new Date(now.getTime() - 30 * 86400000).toISOString()
      label = "Últimos 30 dias"
  }
  return { from, to, label }
}

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KPICard({ kpi }: { kpi: KPI }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{kpi.value}</p>
            {kpi.change !== undefined && (
              <p className={cn("mt-0.5 text-xs font-medium", kpi.change >= 0 ? "text-green-600" : "text-red-600")}>
                {kpi.change >= 0 ? "↑" : "↓"} {Math.abs(kpi.change)}%
              </p>
            )}
            {kpi.subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{kpi.subtitle}</p>
            )}
          </div>
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", kpi.color)}>
            <kpi.icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pipeline Funnel
// ---------------------------------------------------------------------------

function PipelineFunnel({ stages }: { stages: PipelineStage[] }) {
  const maxValue = Math.max(...stages.map((s) => s.value), 1)

  return (
    <div className="space-y-2">
      {stages.map((stage) => (
        <div key={stage.name} className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-right">
            <p className="text-xs font-medium">{stage.name}</p>
          </div>
          <div className="flex-1">
            <div className="relative h-6 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all"
                style={{
                  width: `${Math.max((stage.value / maxValue) * 100, 2)}%`,
                  backgroundColor: stage.color,
                }}
              />
            </div>
          </div>
          <div className="w-28 shrink-0">
            <p className="text-xs font-medium">{stage.count} oportunidades</p>
            <p className="text-[10px] text-muted-foreground">{formatCurrency(stage.value)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Seller Table
// ---------------------------------------------------------------------------

function SellerTable({ sellers }: { sellers: SellerPerformance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Vendedor</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Oport.</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Pipeline</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Ganhos</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Valor</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Conversão</th>
          </tr>
        </thead>
        <tbody>
          {sellers.map((s) => (
            <tr key={s.name} className="border-b hover:bg-muted/50">
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2 text-right">{s.opportunities}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(s.pipeline)}</td>
              <td className="px-3 py-2 text-right text-green-700">{s.won}</td>
              <td className="px-3 py-2 text-right font-medium">{formatCurrency(s.wonValue)}</td>
              <td className="px-3 py-2 text-right">
                <Badge variant={s.conversion >= 25 ? "success" : s.conversion >= 15 ? "warning" : "secondary"}>
                  {s.conversion}%
                </Badge>
              </td>
            </tr>
          ))}
          {sellers.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Nenhum vendedor</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alert Card
// ---------------------------------------------------------------------------

function AlertCard({ alert, onClick }: { alert: Alert; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-full", alert.color)}>
        <alert.icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{alert.label}</p>
        <p className="text-xs text-muted-foreground">{alert.count} item(ns)</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>("30d")
  const [loading, setLoading] = useState(true)
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([])
  const [kpis, setKpis] = useState<KPI[]>([])
  const [sellers, setSellers] = useState<SellerPerformance[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  const { from, to, label } = useMemo(() => getPeriodRange(period), [period])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const isAdmin = profile?.role === "admin"
      const userId = profile?.id

      // 1. Pipeline stages with counts and values
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, name, color, pipeline_id")
        .eq("is_active", true)
        .order("position")

      // 2. All opportunities
      let oppQ = supabase.from("opportunities").select("*, contact:contacts(name)")
      if (!isAdmin && userId) oppQ = oppQ.eq("assigned_to", userId)
      const { data: allOpps } = await oppQ

      // 3. Period-filtered opportunities
      let periodOpps = allOpps ?? []
      if (period !== "today") {
        periodOpps = periodOpps.filter((o) => new Date(o.created_at) >= new Date(from))
      } else {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        periodOpps = periodOpps.filter((o) => new Date(o.created_at) >= todayStart)
      }

      // 4. Pipeline stages
      const stageMap = new Map<string, PipelineStage>()
      for (const s of stages ?? []) {
        stageMap.set(s.id, { name: s.name, color: s.color ?? "#94a3b8", count: 0, value: 0 })
      }
      let openTotal = 0
      for (const o of (allOpps ?? []).filter((o) => o.status === "open")) {
        const s = stageMap.get(o.stage_id)
        if (s) {
          s.count++
          s.value += o.value ?? 0
        }
        openTotal += o.value ?? 0
      }
      setPipelineStages([...stageMap.values()])

      // 5. KPIs
      const openCount = (allOpps ?? []).filter((o) => o.status === "open").length
      const wonPeriod = periodOpps.filter((o) => o.status === "won")
      const lostPeriod = periodOpps.filter((o) => o.status === "lost")
      const wonTotal = wonPeriod.reduce((s, o) => s + (o.value ?? 0), 0)
      const closedCount = wonPeriod.length + lostPeriod.length
      const conversion = closedCount > 0 ? Math.round((wonPeriod.length / closedCount) * 100) : 0
      const ticket = wonPeriod.length > 0 ? wonTotal / wonPeriod.length : 0
      const newLeads = (allOpps ?? []).filter((o) => new Date(o.created_at) >= new Date(from)).length

      setKpis([
        { label: "Leads no período", value: newLeads, icon: Users, color: "bg-blue-100 text-blue-600", subtitle: label },
        { label: "Oportunidades abertas", value: openCount, icon: Target, color: "bg-indigo-100 text-indigo-600" },
        { label: "Pipeline", value: formatCurrency(openTotal), icon: DollarSign, color: "bg-green-100 text-green-600", subtitle: `${openCount} oportunidades` },
        { label: "Ganhos", value: wonPeriod.length, icon: Trophy, color: "bg-emerald-100 text-emerald-600", subtitle: formatCurrency(wonTotal) },
        { label: "Perdidos", value: lostPeriod.length, icon: XCircle, color: "bg-red-100 text-red-600" },
        { label: "Conversão", value: `${conversion}%`, icon: TrendingUp, color: "bg-amber-100 text-amber-600", subtitle: `${wonPeriod.length} ganhas / ${closedCount} encerradas` },
        { label: "Ticket médio", value: formatCurrency(ticket), icon: BarChart3, color: "bg-purple-100 text-purple-600", subtitle: wonPeriod.length > 0 ? "Ganhos" : "Sem vendas" },
      ])

      // 6. Seller performance
      const sellerMap = new Map<string, SellerPerformance>()
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").eq("role", "vendedor")
      for (const p of profiles ?? []) {
        sellerMap.set(p.id, { name: p.full_name ?? "Sem nome", opportunities: 0, pipeline: 0, won: 0, wonValue: 0, conversion: 0 })
      }
      for (const o of allOpps ?? []) {
        if (!o.assigned_to) continue
        const s = sellerMap.get(o.assigned_to)
        if (!s) continue
        s.opportunities++
        if (o.status === "open") s.pipeline += o.value ?? 0
        if (o.status === "won") { s.won++; s.wonValue += o.value ?? 0 }
      }
      for (const s of sellerMap.values()) {
        const closed = s.won + (allOpps ?? []).filter((o) => o.assigned_to === (profiles ?? []).find((p) => p.full_name === s.name)?.id && o.status === "lost").length
        s.conversion = closed > 0 ? Math.round((s.won / closed) * 100) : 0
      }
      setSellers([...sellerMap.values()].sort((a, b) => b.pipeline - a.pipeline))

      // 7. Alerts
      const now = new Date()
      const idleOpps = (allOpps ?? []).filter((o) => {
        if (o.status !== "open") return false
        const daysSinceUpdate = (now.getTime() - new Date(o.updated_at).getTime()) / 86400000
        return daysSinceUpdate >= 3
      }).length

      const newAlerts: Alert[] = []
      if (idleOpps > 0) {
        newAlerts.push({ icon: Clock, label: "Oportunidades paradas (3+ dias)", count: idleOpps, color: "bg-amber-100 text-amber-600" })
      }
      if (lostPeriod.length > 0) {
        newAlerts.push({ icon: XCircle, label: "Oportunidades perdidas no período", count: lostPeriod.length, color: "bg-red-100 text-red-600" })
      }
      setAlerts(newAlerts)

    } catch (e) {
      console.error("Dashboard error", e)
      toast.error("Erro ao carregar dashboard")
    } finally {
      setLoading(false)
    }
  }, [profile, period, from, to])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Dashboard Comercial</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="month">Este mês</SelectItem>
              <SelectItem value="quarter">Este trimestre</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadDashboard}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <Skeleton className="h-64" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
              {kpis.map((kpi) => (
                <KPICard key={kpi.label} kpi={kpi} />
              ))}
            </div>

            {/* Pipeline + Alerts */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardContent className="p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Pipeline de Vendas</h2>
                  <PipelineFunnel stages={pipelineStages} />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Precisa de Atenção</h2>
                  {alerts.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Tudo em ordem!</p>
                  ) : (
                    <div className="space-y-2">
                      {alerts.map((alert, i) => (
                        <AlertCard key={i} alert={alert} onClick={() => navigate("/pipeline")} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Seller Performance */}
            <Card>
              <CardContent className="p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Desempenho dos Vendedores</h2>
                <SellerTable sellers={sellers} />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
