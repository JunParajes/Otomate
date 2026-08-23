import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { MantineProvider, useComputedColorScheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import NotFoundPage from '@/pages/NotFoundPage'
import ChangePasswordPage from '@/pages/ChangePasswordPage'
import UsersPage from '@/pages/admin/UsersPage'
import RolesPage from '@/pages/admin/RolesPage'
import BranchesPage from '@/pages/admin/BranchesPage'
import ProductsPage from '@/pages/admin/ProductsPage'
import CategoriesPage from '@/pages/admin/CategoriesPage'
import EmployeesPage from '@/pages/admin/EmployeesPage'
import DsirListPage from '@/pages/dsir/DsirListPage'
import DsirEntryPage from '@/pages/dsir/DsirEntryPage'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/AppLayout'
import { SessionProvider } from '@/lib/session'
import { theme } from '@/theme'
import { syncThemeColor } from '@/lib/theme-color'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/dropzone/styles.css'

/**
 * Repaints the browser chrome whenever the resolved scheme changes. Lives at the
 * root rather than in the account menu so it also covers the login page, which
 * renders outside the app shell.
 */
function ThemeColorSync() {
  const computed = useComputedColorScheme('light')
  React.useEffect(() => {
    syncThemeColor(computed)
  }, [computed])
  return null
}

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
      <ThemeColorSync />
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
              <Route path="/dsir" element={<Shell permission="dsir:read"><DsirListPage /></Shell>} />
              <Route path="/dsir/:id" element={<Shell permission="dsir:read"><DsirEntryPage /></Shell>} />
              <Route path="/catalog/products" element={<Shell permission="products:read"><ProductsPage /></Shell>} />
              <Route path="/catalog/categories" element={<Shell permission="products:read"><CategoriesPage /></Shell>} />
              <Route path="/admin/users" element={<Shell permission="users:read"><UsersPage /></Shell>} />
              <Route path="/admin/employees" element={<Shell permission="employees:read"><EmployeesPage /></Shell>} />
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
