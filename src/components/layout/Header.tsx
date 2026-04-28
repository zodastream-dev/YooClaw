import { useSidebarStore, useChatStore, useAuthStore, useThemeStore } from '@/lib/store'
import { Menu, Sun, Moon } from 'lucide-react'

export function Header() {
  const { toggleMobile } = useSidebarStore()
  const { isStreaming } = useChatStore()
  const { resolvedTheme, setTheme } = useThemeStore()
  const user = useAuthStore((s) => s.user)

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobile}
          className="p-2 rounded-lg hover:bg-muted transition-colors md:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`} />
          <span className="text-sm font-medium text-foreground">
            {isStreaming ? '正在生成...' : 'AI 建站助手'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {user && (
          <span className="text-sm text-muted-foreground">
            {user.username}
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  )
}
