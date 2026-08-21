import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import NotFoundPage from '@/pages/NotFoundPage'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import UsersPage from '@/pages/admin/UsersPage'
import RolesPage from '@/pages/admin/RolesPage'
import BranchesPage from '@/pages/admin/BranchesPage'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/AppLayout'
import { SessionProvider } from '@/lib/session'
import { theme } from '@/theme'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

/** Authenticated pages share the shell; login and 404 stand alone. */
function Shell({ children, permission }: { children: React.ReactNode; permission?: Parameters<typeof ProtectedRoute>[0]['permission'] }) {
  return (
    <ProtectedRoute permission={permission}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      {/* bottom-right: top-right collides with each page primary action button */}
      <Notifications position="bottom-right" />
      <ModalsProvider>
        <BrowserRouter>
          <SessionProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/change-password"
                element={
                  <ProtectedRoute>
                    <ChangePasswordPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/dashboard" element={<Shell><DashboardPage /></Shell>} />
              <Route path="/admin/users" element={<Shell permission="users:read"><UsersPage /></Shell>} />
              <Route path="/admin/roles" element={<Shell permission="roles:read"><RolesPage /></Shell>} />
              <Route path="/admin/branches" element={<Shell permission="branches:read"><BranchesPage /></Shell>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </SessionProvider>
        </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>
)
