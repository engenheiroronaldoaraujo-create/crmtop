import { useState, type FormEvent } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { MessageCircle } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { APK_DOWNLOAD_URL } from "@/lib/apk"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
      const from = (location.state as { from?: { pathname: string } } | null)?.from
        ?.pathname
      navigate(from ?? "/", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <MessageCircle className="h-7 w-7 text-primary" />
          </div>
          <CardTitle>CRM WhatsApp</CardTitle>
          <CardDescription>
            Entre com sua conta para acessar o atendimento
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <a
        href={APK_DOWNLOAD_URL}
        className="text-sm text-primary underline underline-offset-4"
      >
        Baixar app Android (APK)
      </a>
    </div>
  )
}
