import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { supabase } from "@/lib/supabase"
import type { Workspace, WorkspaceMember } from "@/lib/types"
import { useAuth } from "@/hooks/use-auth"

type WorkspaceContextValue = {
  workspaces: Workspace[]
  memberships: WorkspaceMember[]
  activeWorkspace: Workspace | null
  activeRole: "owner" | "admin" | "vendedor" | null
  loading: boolean
  switchWorkspace: (id: string) => void
  refresh: () => Promise<void>
  isWorkspaceAdmin: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)
const STORAGE_KEY = "crm-active-workspace"

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [memberships, setMemberships] = useState<WorkspaceMember[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    if (!user) {
      setWorkspaces([])
      setMemberships([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data: members } = await supabase
      .from("workspace_members")
      .select("workspace_id, user_id, role, created_at")
      .eq("user_id", user.id)
    const list = (members ?? []) as WorkspaceMember[]
    setMemberships(list)
    if (list.length > 0) {
      const ids = list.map((m) => m.workspace_id)
      const { data: ws } = await supabase.from("workspaces").select("*").in("id", ids)
      setWorkspaces((ws ?? []) as Workspace[])
      const stored = (() => {
        try {
          return localStorage.getItem(STORAGE_KEY)
        } catch {
          return null
        }
      })()
      if (!stored || !ids.includes(stored)) {
        const first = ids[0]
        setActiveId(first)
        try {
          localStorage.setItem(STORAGE_KEY, first)
        } catch {
          /* noop */
        }
      } else {
        setActiveId(stored)
      }
    } else {
      setWorkspaces([])
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const switchWorkspace = useCallback((id: string) => {
    setActiveId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* noop */
    }
  }, [])

  const value = useMemo<WorkspaceContextValue>(() => {
    const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null
    const activeRole = memberships.find((m) => m.workspace_id === activeWorkspace?.id)?.role ?? null
    return {
      workspaces,
      memberships,
      activeWorkspace,
      activeRole,
      loading,
      switchWorkspace,
      refresh: fetchAll,
      isWorkspaceAdmin: activeRole === "owner" || activeRole === "admin",
    }
  }, [workspaces, memberships, activeId, loading, switchWorkspace, fetchAll])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return ctx
}
