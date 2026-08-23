import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ApiResponse, PermissionName, User } from '@otomate/shared'
import { api } from './api'
import { clearSession, getToken } from './auth'

/** /me returns the user plus the authority the server computed for this request. */
export type Me = User & { permissions: PermissionName[]; isSuperAdmin: boolean }

interface SessionValue {
  user: Me | null
  loading: boolean
  isSuperAdmin: boolean
  can: (permission: PermissionName) => boolean
  refresh: () => Promise<void>
  signOut: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  // Permissions come from the server on every load, never from localStorage —
  // a role change must take effect without the user clearing their browser.
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const { data } = await api.get<ApiResponse<Me>>('/api/users/me')
      if (!data.error) setUser(data.data)
    } catch {
      // Deliberately does NOT sign the user out. A genuine 401 is already
      // handled globally by the interceptor in api.ts, which clears the token
      // and redirects; anything reaching here is a network blip or a 5xx.
      // Dropping the user on those would send someone with a perfectly valid
      // token back to the login screen — and refresh() now runs after admin
      // saves, so a blip mid-save would look like being logged out for editing
      // your own account.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      isSuperAdmin: user?.isSuperAdmin ?? false,
      can: permission =>
        Boolean(user?.isSuperAdmin) || Boolean(user?.permissions.includes(permission)),
      refresh,
      signOut: () => {
        clearSession()
        setUser(null)
        window.location.href = '/login'
      },
    }),
    [user, loading, refresh]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
