import { useEffect, useState } from "react"
import { Download, Loader2, Smartphone } from "lucide-react"

import { APK_DOWNLOAD_URL, fetchApkManifest, type ApkManifest } from "@/lib/apk"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function ApkSettings() {
  const [manifest, setManifest] = useState<ApkManifest | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchApkManifest()
      .then(setManifest)
      .finally(() => setLoading(false))
  }, [])

  const sizeMb = manifest
    ? `${(manifest.size_bytes / 1024 / 1024).toFixed(1)} MB`
    : null
  const builtAt = manifest
    ? new Date(manifest.built_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            App Android (APK)
          </CardTitle>
          <CardDescription>
            Versão instalável do CRM gerada pelo GitHub Actions. Mesma versão
            é publicada a cada release.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando versão...
            </p>
          ) : manifest ? (
            <div className="text-sm">
              <p>
                <span className="font-medium">Versão:</span> {manifest.version} (build{" "}
                {manifest.code})
              </p>
              <p>
                <span className="font-medium">Gerado em:</span> {builtAt}
              </p>
              <p>
                <span className="font-medium">Tamanho:</span> {sizeMb}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum APK publicado ainda — rode o workflow "Release APK Android"
              no GitHub Actions.
            </p>
          )}
          <Button asChild disabled={!manifest}>
            <a href={APK_DOWNLOAD_URL}>
              <Download className="mr-2 h-4 w-4" /> Baixar APK
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            Android exige permitir "instalar apps desconhecidos". Após instalar,
            entre com o mesmo login da web. Alerta sonoro funciona com o app
            aberto; push com o app fechado é a próxima fase.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
