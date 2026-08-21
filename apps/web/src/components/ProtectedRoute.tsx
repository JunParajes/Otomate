import { Navigate, useLocation } from 'react-router-dom'
import { Center, Loader } from '@mantine/core'
import type { PermissionName } from '@otomate/shared'
import { useSession } from '@/lib/session'

interface Props {
  children: React.ReactNode
  /** When set, the route also requires this permission. */
  permission?: PermissionName
}

export default function ProtectedRoute({ children, permission }: Props) {
  const { user, loading, can } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // A forced password change blocks everything except the change screen itself.
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
