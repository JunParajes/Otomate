import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Center, Loader, MantineProvider, useComputedColorScheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { ModalsProvider } from '@mantine/modals'
import LoginPage from '@/pages/LoginPage'

/**
 * Pages load on demand.
 *
 * Everything used to arrive in one 960 KB file, so signing in downloaded the
 * DSIR grid, the image uploader and every admin screen before showing a
 * password box. Splitting per route means a page's code — and its
 * dependencies, like the 60 KB dropzone only the product catalogue uses —
 * arrives when that page is opened.
 *
 * LoginPage is deliberately NOT lazy: it is the first thing an unauthenticated
 * visit needs, and deferring it would add a round trip before the first paint.
 */
const DashboardPage = React.lazy(() => import('@/pages/DashboardPage'))
const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage'))
const ChangePasswordPage = React.lazy(() => import('@/pages/ChangePasswordPage'))
const UsersPage = React.lazy(() => import('@/pages/admin/UsersPage'))
const RolesPage = React.lazy(() => import('@/pages/admin/RolesPage'))
const BranchesPage = React.lazy(() => import('@/pages/admin/BranchesPage'))
const BranchDetailPage = React.lazy(() => import('@/pages/admin/BranchDetailPage'))
const ProductsPage = React.lazy(() => import('@/pages/admin/ProductsPage'))
const CategoriesPage = React.lazy(() => import('@/pages/admin/CategoriesPage'))
const EmployeesPage = React.lazy(() => import('@/pages/admin/EmployeesPage'))
const PositionsPage = React.lazy(() => import('@/pages/admin/PositionsPage'))
const WorkSchedulesPage = React.lazy(() => import('@/pages/hr/WorkSchedulesPage'))
const WorkSchedulePage = React.lazy(() => import('@/pages/hr/WorkSchedulePage'))
const EmployeeDetailPage = React.lazy(() => import('@/pages/admin/EmployeeDetailPage'))
const DsirListPage = React.lazy(() => import('@/pages/dsir/DsirListPage'))
const DsirArchivePage = React.lazy(() => import('@/pages/dsir/DsirArchivePage'))
const DsirArchiveBranchPage = React.lazy(() => import('@/pages/dsir/DsirArchiveBranchPage'))
const DsirEntryPage = React.lazy(() => import('@/pages/dsir/DsirEntryPage'))

import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/AppLayout'
import { SessionProvider } from '@/lib/session'
import { theme } from '@/theme'
import { syncThemeColor } from '@/lib/theme-color'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

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

/**
 * Shown while a route's chunk downloads. Deliberately bare: on a fast connection
 * it flashes for a few frames, and anything more elaborate reads as a glitch.
 */
function RouteFallback() {
  return (
    <Center h="60vh">
      <Loader />
    </Center>
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
            <Suspense fallback={<RouteFallback />}>
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
              {/* Before /dsir/:id — otherwise ":id" matches "archive". */}
                <Route path="/dsir/archive" element={<Shell permission="dsir:read"><DsirArchivePage /></Shell>} />
                <Route path="/dsir/archive/:branchId" element={<Shell permission="dsir:read"><DsirArchiveBranchPage /></Shell>} />
                <Route path="/dsir/:id" element={<Shell permission="dsir:read"><DsirEntryPage /></Shell>} />
                <Route path="/catalog/products" element={<Shell permission="products:read"><ProductsPage /></Shell>} />
                <Route path="/catalog/categories" element={<Shell permission="products:read"><CategoriesPage /></Shell>} />
                <Route path="/admin/users" element={<Shell permission="users:read"><UsersPage /></Shell>} />
                <Route path="/admin/employees" element={<Shell permission="employees:read"><EmployeesPage /></Shell>} />
                <Route path="/admin/employees/:id" element={<Shell permission="employees:read"><EmployeeDetailPage /></Shell>} />
                {/* employees:read to view; positions:write gates the buttons inside. */}
                <Route path="/admin/positions" element={<Shell permission="employees:read"><PositionsPage /></Shell>} />
                <Route path="/hr/work-schedule" element={<Shell permission="schedule:read"><WorkSchedulesPage /></Shell>} />
                <Route path="/hr/work-schedule/:id" element={<Shell permission="schedule:read"><WorkSchedulePage /></Shell>} />
                <Route path="/admin/roles" element={<Shell permission="roles:read"><RolesPage /></Shell>} />
                <Route path="/admin/branches" element={<Shell permission="branches:read"><BranchesPage /></Shell>} />
                <Route path="/admin/branches/:id" element={<Shell permission="branches:read"><BranchDetailPage /></Shell>} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </SessionProvider>
        </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>
)
