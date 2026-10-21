import { Suspense, lazy } from "react"
import { useSearchParams } from "react-router-dom"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"

// Cada aba é um chunk separado: antes as 8 sub-páginas eram importadas
// estaticamente e o chunk de Configurações carregava todas (~99 KB), mesmo
// com o usuário olhando só para "Usuários".
const UsersAdmin = lazy(() => import("@/pages/UsersAdmin"))
const WhatsAppSettings = lazy(() => import("@/pages/WhatsAppSettings"))
const AISettings = lazy(() => import("@/pages/AISettings"))
const SDRSettings = lazy(() => import("@/pages/SDRSettings"))
const TemplatesSettings = lazy(() => import("@/pages/TemplatesSettings"))
const ApkSettings = lazy(() => import("@/pages/ApkSettings"))
const CadencesSettings = lazy(() => import("@/pages/CadencesSettings"))
const NoreplySettings = lazy(() => import("@/pages/NoreplySettings"))

function TabFallback() {
  return (
    <div className="space-y-3 pt-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export default function SettingsPage() {
  // Aba inicial via ?tab= (o OAuth da Meta retorna em /settings?tab=whatsapp).
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get("tab") ?? "users"
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center border-b px-6">
        <h1 className="text-xl font-semibold">Configurações</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue={initialTab} className="w-full max-w-4xl">
          <TabsList>
            <TabsTrigger value="users">Usuários</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="app">App Android</TabsTrigger>
            <TabsTrigger value="cadences">Cadências</TabsTrigger>
            <TabsTrigger value="noreply">Follow-up sem resposta</TabsTrigger>
            <TabsTrigger value="ai">Inteligência Artificial</TabsTrigger>
            <TabsTrigger value="sdr">SDR IA</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <Suspense fallback={<TabFallback />}>
              <UsersAdmin />
            </Suspense>
          </TabsContent>
          <TabsContent value="whatsapp">
            <Suspense fallback={<TabFallback />}>
              <WhatsAppSettings />
            </Suspense>
          </TabsContent>
          <TabsContent value="templates">
            <Suspense fallback={<TabFallback />}>
              <TemplatesSettings />
            </Suspense>
          </TabsContent>
          <TabsContent value="app">
            <Suspense fallback={<TabFallback />}>
              <ApkSettings />
            </Suspense>
          </TabsContent>
          <TabsContent value="cadences">
            <Suspense fallback={<TabFallback />}>
              <CadencesSettings />
            </Suspense>
          </TabsContent>
          <TabsContent value="noreply">
            <Suspense fallback={<TabFallback />}>
              <NoreplySettings />
            </Suspense>
          </TabsContent>
          <TabsContent value="ai">
            <Suspense fallback={<TabFallback />}>
              <AISettings />
            </Suspense>
          </TabsContent>
          <TabsContent value="sdr">
            <Suspense fallback={<TabFallback />}>
              <SDRSettings />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
