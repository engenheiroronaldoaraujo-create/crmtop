import { NavLink, useNavigate } from "react-router-dom"
import { useState, useEffect } from "react"
import {
  LogOut,
  MessageCircle,
  Settings,
  User,
  Users,
  FlaskConical,
  CalendarDays,
  Zap,
  Search,
  LayoutDashboard,
} from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useGlobalSearch } from "@/hooks/use-tags"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const NAV_ITEMS = [
  { to: "/", label: "Chat", icon: MessageCircle, end: true },
  { to: "/pipeline", label: "Funil", icon: FlaskConical, end: false },
  { to: "/agenda", label: "Agenda", icon: CalendarDays, end: false },
  { to: "/contacts", label: "Contatos", icon: Users, end: false },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { query, setQuery, results, loading, search } = useGlobalSearch()
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { if (query) search(query) }, 300)
    return () => clearTimeout(t)
  }, [query, search])

  const totalResults = results.contacts.length + results.opportunities.length + results.conversations.length

  const initials = (profile?.full_name ?? user?.email ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  async function handleSignOut() {
    await signOut()
    navigate("/login")
  }

  const items = [...NAV_ITEMS]
  if (profile?.role === "admin") {
    items.push({ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: false })
    items.push({ to: "/automations", label: "Automações", icon: Zap, end: false })
    items.push({ to: "/settings", label: "Configurações", icon: Settings, end: false })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center gap-2 border-b border-white/10 px-4">
          <MessageCircle className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold text-white">CRM WhatsApp</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-active text-sidebar-active-foreground"
                    : "text-sidebar-muted hover:bg-white/10 hover:text-white",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Global search */}
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-muted" />
            <Input
              className="h-8 border-white/10 bg-white/10 pl-8 text-xs text-white placeholder:text-sidebar-muted focus:border-primary focus:ring-primary"
              placeholder="Buscar..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            />
          </div>
          {searchOpen && query && (
            <div className="absolute left-0 right-0 top-16 z-50 mx-2 mt-1 max-h-80 overflow-auto rounded-lg border bg-card shadow-lg">
              {loading ? (
                <p className="p-3 text-center text-xs text-muted-foreground">Buscando...</p>
              ) : totalResults === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">Nenhum resultado</p>
              ) : (
                <div className="p-1">
                  {results.contacts.length > 0 && (
                    <div>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Contatos</p>
                      {results.contacts.map((c: any) => (
                        <button
                          key={c.id}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                          onClick={() => { navigate("/contacts"); setSearchOpen(false); setQuery("") }}
                        >
                          <span className="truncate font-medium">{c.name || c.push_name || "Sem nome"}</span>
                          {c.phone && <span className="ml-auto text-muted-foreground">{c.phone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {results.opportunities.length > 0 && (
                    <div>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Oportunidades</p>
                      {results.opportunities.map((o: any) => (
                        <button
                          key={o.id}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                          onClick={() => { navigate("/pipeline"); setSearchOpen(false); setQuery("") }}
                        >
                          <span className="truncate font-medium">{o.title}</span>
                          {o.contact && <span className="ml-auto text-muted-foreground">{o.contact.name}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {results.conversations.length > 0 && (
                    <div>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">Conversas</p>
                      {results.conversations.map((c: any) => (
                        <button
                          key={c.id}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                          onClick={() => { navigate("/"); setSearchOpen(false); setQuery("") }}
                        >
                          <span className="truncate font-medium">{c.contact?.name || c.contact?.push_name || "Sem nome"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary text-primary-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {profile?.full_name ?? "—"}
              </p>
              <p className="truncate text-xs text-sidebar-muted">
                {profile?.role === "admin" ? "Admin" : "Vendedor"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="Minha conta"
              className="text-sidebar-muted hover:bg-white/10 hover:text-white"
              onClick={() => navigate("/account")}
            >
              <User className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Sair" className="text-sidebar-muted hover:bg-white/10 hover:text-white" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
