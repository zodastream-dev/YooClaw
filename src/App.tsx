import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { ChatPage } from '@/pages/ChatPage'
import { AdminPage } from '@/pages/AdminPage'
import { SitesPage } from '@/pages/SitesPage'
import { SiteCreatePage } from '@/pages/SiteCreatePage'
import { PortalCreatePage } from '@/pages/PortalCreatePage'
import { PortalBuilderPage } from '@/pages/PortalBuilderPage'
import { GameCreatePage } from '@/pages/GameCreatePage'
import { VideoCreatePage } from '@/pages/VideoCreatePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { MpSubscriptionPage } from '@/pages/MpSubscriptionPage'
import { PricingPage } from '@/pages/PricingPage'
import { PayPage } from '@/pages/PayPage'
import { useAuthStore } from '@/lib/store'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  if (!isAuthenticated) return <Navigate to="/" replace />
  if (user?.role !== 'admin') return <Navigate to="/chat" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/chat" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <HashRouter>
      <div className="h-screen flex flex-col bg-background">
        <div className="flex-1 overflow-y-auto">
          <Routes>
            <Route
              path="/"
              element={
                <PublicRoute>
                  <HomePage />
                </PublicRoute>
              }
            />
            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <ChatPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminPage />
                </AdminRoute>
              }
            />
            <Route
              path="/sites"
              element={
                <ProtectedRoute>
                  <SitesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sites/create"
              element={
                <ProtectedRoute>
                  <SiteCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sites/portal"
              element={
                <ProtectedRoute>
                  <PortalCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sites/portal/create"
              element={
                <ProtectedRoute>
                  <PortalBuilderPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/games/create"
              element={
                <ProtectedRoute>
                  <GameCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/videos/create"
              element={
                <ProtectedRoute>
                  <VideoCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mp"
              element={
                <ProtectedRoute>
                  <MpSubscriptionPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pricing"
              element={<PricingPage />}
            />
            <Route
              path="/pay/:id"
              element={
                <ProtectedRoute>
                  <PayPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <footer className="shrink-0 border-t border-border text-center text-xs text-muted-foreground py-3">
          上海聚核信息技术有限公司 ICP备案/许可证号：<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener" className="hover:text-primary underline underline-offset-2">沪ICP备13025394号</a>
        </footer>
      </div>
    </HashRouter>
  )
}
