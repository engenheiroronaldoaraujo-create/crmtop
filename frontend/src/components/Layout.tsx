import { NavLink, useNavigate } from "react-router-dom"
import {
  LogOut,
  MessageCircle,
  Settings,
  User,
  Users,
} from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

const NAV_ITEMS = [
  { to: "/", label: "Chat", icon: MessageCircle, end: true },
  { to: "/contacts", label: "Contatos", icon: Users, end: false },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

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
    items.push({ to: "/settings", label: "Configurações", icon: Settings, end: false })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <MessageCircle className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">CRM WhatsApp</span>
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
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Separator />
        <div className="flex items-center gap-3 p-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {profile?.full_name ?? "—"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.role === "admin" ? "Admin" : "Vendedor"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="Minha conta"
            onClick={() => navigate("/account")}
          >
            <User className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Sair" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
