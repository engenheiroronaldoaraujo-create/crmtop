import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
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

export default function MyAccountPage() {
  const { user, profile, refreshProfile } = useAuth()

  const [fullName, setFullName] = useState(profile?.full_name ?? "")
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName || null })
      .eq("id", user!.id)
    setSavingProfile(false)
    if (error) {
      toast.error(error.message)
      return
    }
    await refreshProfile()
    toast.success("Perfil atualizado")
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    if (newPassword.length < 6) {
      toast.error("A nova senha precisa de pelo menos 6 caracteres")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("A confirmação não confere")
      return
    }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    setSavingPassword(false)
    if (error) {
      toast.error(error.message)
      return
    }
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    toast.success("Senha alterada com sucesso")
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center border-b px-6">
        <h1 className="text-xl font-semibold">Minha conta</h1>
      </header>
      <div className="flex-1 space-y-6 overflow-auto p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>{user?.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="acc-name">Nome completo</Label>
                <Input
                  id="acc-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "Salvando..." : "Salvar"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Trocar senha</CardTitle>
            <CardDescription>
              Se você recebeu uma senha provisória, troque aqui pela sua senha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="acc-cur">Senha atual</Label>
                <Input
                  id="acc-cur"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-new">Nova senha</Label>
                <Input
                  id="acc-new"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-confirm">Confirmar nova senha</Label>
                <Input
                  id="acc-confirm"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={savingPassword}>
                {savingPassword ? "Alterando..." : "Alterar senha"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
