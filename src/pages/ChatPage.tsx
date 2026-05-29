import React, { useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { useNavigate } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { ChatView } from '@/components/chat/ChatView'
import { Loader2 } from 'lucide-react'

function ErrorFallback({ error }: { error: Error | null }) {
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-3 max-w-md px-4">
        <p className="text-destructive font-medium">页面渲染出错</p>
        {error && (
          <pre className="text-xs text-muted-foreground bg-muted p-3 rounded-lg text-left overflow-auto max-h-40">
            {error.message}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          刷新页面
        </button>
      </div>
    </div>
  )
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ChatPage ErrorBoundary]', error.message, info.componentStack)
  }
  render() {
    if (this.state.hasError) return <ErrorFallback error={this.state.error} />
    return this.props.children
  }
}

export function ChatPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Mark as mounted after first render to avoid SSR mismatches
    setMounted(true)
    if (!isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [])

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, mounted, navigate])

  // Show loading spinner instead of null — prevents black screen flash
  if (!mounted || !isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="h-full flex overflow-hidden bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <ChatView />
        </div>
      </div>
    </ErrorBoundary>
  )
}
