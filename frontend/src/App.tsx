import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"

import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { WorkspaceProvider, useWorkspace } from "@/hooks/use-workspace"
import { ThemeProvider, useTheme } from "@/hooks/use-theme"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { Layout } from "@/components/Layout"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import LoginPage from "@/pages/Login"

const ChatPage = lazy(() => import("@/pages/Chat"))
const ContactsPage = lazy(() => import("@/pages/Contacts"))
const SettingsPage = lazy(() => import("@/pages/Settings"))
const MyAccountPage = lazy(() => import("@/pages/MyAccount"))
const PipelinePage = lazy(() => import("@/pages/Pipeline"))
const AgendaPage = lazy(() => import("@/pages/Agenda"))
const AutomationsPage = lazy(() => import("@/pages/Automations"))
const DashboardPage = lazy(() => import("@/pages/Dashboard"))
const CampaignsPage = lazy(() => import("@/pages/Campaigns"))
const GroupsPage = lazy(() => import("@/pages/Groups"))
const PlatformAdminPage = lazy(() => import("@/pages/PlatformAdmin"))

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  const { loading: wsLoading, isWorkspaceAdmin } = useWorkspace()
  // `loading` cobre o carregamento do profile (ver use-auth): sem isso
  // existia uma janela em que profile era null e o admin era expulso.
  if (loading || wsLoading) return <PageSkeleton />
  // Multi-tenant: platform admin, admin global legado ou admin do workspace ativo.
  if (profile?.is_platform_admin) return <>{children}</>
  if (profile?.role === "admin" || isWorkspaceAdmin) return <>{children}</>
  return <Navigate to="/" replace />
}

function RequirePlatformAdmin({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <PageSkeleton />
  if (profile?.is_platform_admin) return <>{children}</>
  return <Navigate to="/" replace />
}

/**
 * Layout das rotas autenticadas.
 *
 * Antes o `<Layout>` era declarado dentro de cada `<Route>`: navegar entre
 * páginas desmontava e remontava o Layout, zerando a busca global e
 * refazendo o debounce a cada navegação. Com rota de layout + `<Outlet/>`
 * o Layout permanece montado.
 */
function AppLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

function PageSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3">
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<ChatPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/account" element={<MyAccountPage />} />
        <Route
          path="/automations"
          element={
            <RequireAdmin>
              <AutomationsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/campaigns"
          element={
            <RequireAdmin>
              <CampaignsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/groups"
          element={
            <RequireAdmin>
              <GroupsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAdmin>
              <SettingsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/platform"
          element={
            <RequirePlatformAdmin>
              <PlatformAdminPage />
            </RequirePlatformAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function AppToaster() {
  const { resolvedTheme } = useTheme()
  return <Toaster position="top-center" richColors theme={resolvedTheme} />
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <WorkspaceProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <AppRoutes />
              </Suspense>
            </ErrorBoundary>
            <AppToaster />
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
