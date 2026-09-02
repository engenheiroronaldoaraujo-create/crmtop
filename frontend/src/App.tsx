import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"

import { AuthProvider, useAuth } from "@/hooks/use-auth"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { Layout } from "@/components/Layout"
import LoginPage from "@/pages/Login"

const ChatPage = lazy(() => import("@/pages/Chat"))
const ContactsPage = lazy(() => import("@/pages/Contacts"))
const SettingsPage = lazy(() => import("@/pages/Settings"))
const MyAccountPage = lazy(() => import("@/pages/MyAccount"))
const PipelinePage = lazy(() => import("@/pages/Pipeline"))
const AgendaPage = lazy(() => import("@/pages/Agenda"))
const AutomationsPage = lazy(() => import("@/pages/Automations"))
const DashboardPage = lazy(() => import("@/pages/Dashboard"))

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (profile?.role !== "admin") return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <ChatPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/contacts"
        element={
          <ProtectedRoute>
            <Layout>
              <ContactsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipeline"
        element={
          <ProtectedRoute>
            <Layout>
              <PipelinePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/agenda"
        element={
          <ProtectedRoute>
            <Layout>
              <AgendaPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/automations"
        element={
          <ProtectedRoute>
            <RequireAdmin>
              <Layout>
                <AutomationsPage />
              </Layout>
            </RequireAdmin>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <DashboardPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <RequireAdmin>
              <Layout>
                <SettingsPage />
              </Layout>
            </RequireAdmin>
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <Layout>
              <MyAccountPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={null}>
          <AppRoutes />
        </Suspense>
        <Toaster position="top-center" richColors />
      </AuthProvider>
    </BrowserRouter>
  )
}
