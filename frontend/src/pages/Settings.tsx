import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import UsersAdmin from "@/pages/UsersAdmin"
import WhatsAppSettings from "@/pages/WhatsAppSettings"
import AISettings from "@/pages/AISettings"
import SDRSettings from "@/pages/SDRSettings"
import TemplatesSettings from "@/pages/TemplatesSettings"

export default function SettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center border-b px-6">
        <h1 className="text-xl font-semibold">Configurações</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="users" className="w-full max-w-4xl">
          <TabsList>
            <TabsTrigger value="users">Usuários</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="ai">Inteligência Artificial</TabsTrigger>
            <TabsTrigger value="sdr">SDR IA</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <UsersAdmin />
          </TabsContent>
          <TabsContent value="whatsapp">
            <WhatsAppSettings />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesSettings />
          </TabsContent>
          <TabsContent value="ai">
            <AISettings />
          </TabsContent>
          <TabsContent value="sdr">
            <SDRSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
