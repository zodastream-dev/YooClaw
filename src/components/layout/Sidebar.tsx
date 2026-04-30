import { useState, useEffect, useRef } from 'react'
import { useSessionStore, useSidebarStore, useChatStore, useThemeStore, useAuthStore } from '@/lib/store'
import { getUserSessions, deleteUserSession as apiDelete, renameUserSession as apiRename, createUserSession, getSessionMessages } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { Plus, Search, Trash2, Pencil, Check, X, Sparkles, Sun, Moon, LogOut, Shield, HardDrive, Loader2, Globe } from 'lucide-react'
import { DEFAULT_SESSION_NAME, formatBytes } from '@/lib/constants'
import { useNavigate } from 'react-router-dom'
import type { Session } from '@/lib/types'

export function Sidebar() {
  const {
    sessions,
    currentSessionId,
    setSessions,
    removeSession,
    updateSessionName,
    setCurrentSession,
    addSession,
    setLoading,
  } = useSessionStore()
  const { isOpen, isMobileOpen, closeMobile } = useSidebarStore()
  const { clearMessages, currentSessionId: chatSessionId, setCurrentSessionId } = useChatStore()
  const setLoadingHistory = useChatStore((s) => s.setLoadingHistory)
  const { theme, resolvedTheme, setTheme } = useThemeStore()
  const { clearToken, user, storageInfo, fetchStorage } = useAuthStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null)

  useEffect(() => {
    loadSessions()
    fetchStorage()
  }, [])

  const loadSessions = async () => {
    setLoading(true)
    try {
      const res = await getUserSessions()
      if (res.data) {
        const mapped = res.data.map((s) => ({
          id: s.id,
          name: s.name || DEFAULT_SESSION_NAME,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }))
        setSessions(mapped)
      }
    } catch (e) {
      console.error('Failed to load sessions:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleNew = async () => {
    clearMessages()
    setCurrentSession(null)
    setCurrentSessionId(null)
    closeMobile()
  }

  const handleSelect = async (id: string) => {
    if (loadingSessionId === id) return  // Prevent double-click
    
    // Immediately update session selection and show loading state
    setCurrentSession(id)
    setCurrentSessionId(id)
    closeMobile()
    setLoadingSessionId(id)
    
    // Show loading spinner in chat area immediately
    useChatStore.setState({ messages: [], isLoadingHistory: true })
    
    // Load messages from API
    try {
      const res = await getSessionMessages(id)
      if (res.data) {
        const msgs = res.data.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        }))
        useChatStore.setState({ messages: msgs, isLoadingHistory: false })
      } else {
        useChatStore.setState({ isLoadingHistory: false })
      }
    } catch (e) {
      console.error('Failed to load messages:', e)
      useChatStore.setState({ isLoadingHistory: false })
    } finally {
      setLoadingSessionId(null)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await apiDelete(id)
      removeSession(id)
      if (currentSessionId === id) {
        clearMessages()
        setCurrentSession(null)
        setCurrentSessionId(null)
      }
      fetchStorage()
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  const handleRename = async (id: string) => {
    if (!editName.trim()) {
      setEditingId(null)
      return
    }
    try {
      await apiRename(id, editName.trim())
      updateSessionName(id, editName.trim())
    } catch (e) {
      console.error('Rename failed:', e)
    }
    setEditingId(null)
  }

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  // Group by date
  const today = new Date().setHours(0, 0, 0, 0)
  const yesterday = today - 86400000

  const groups = [
    { label: '今天', items: filtered.filter((s) => s.updatedAt >= today) },
    { label: '昨天', items: filtered.filter((s) => s.updatedAt >= yesterday && s.updatedAt < today) },
    { label: '更早', items: filtered.filter((s) => s.updatedAt < yesterday) },
  ].filter((g) => g.items.length > 0)

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const storagePercentage = storageInfo?.percentage ?? 0
  const storageColor = storagePercentage > 90 ? 'bg-destructive' : storagePercentage > 70 ? 'bg-yellow-500' : 'bg-primary'

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={closeMobile} />
      )}

      <aside
        className={cn(
          'fixed md:static inset-y-0 left-0 z-50 w-[260px] bg-card border-r border-border flex flex-col transition-transform duration-200',
          isOpen ? 'md:translate-x-0' : 'md:-translate-x-full',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles size={16} className="text-primary" />
          </div>
          <span className="font-semibold text-sm">AI 建站助手</span>
        </div>

        {/* Search */}
        <div className="px-3 py-2 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索对话..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted rounded-lg border-0 outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* New Chat */}
        <div className="px-3 pb-1 flex-shrink-0">
          <button
            onClick={handleNew}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground"
          >
            <Plus size={16} />
            新建对话
          </button>
        </div>

        {/* Report Sites - Prominent CTA */}
        <div className="px-3 pb-3 flex-shrink-0">
          {/* Section label */}
          <div className="flex items-center gap-2 px-1 mb-1.5">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/50 to-transparent" />
          </div>

          <button
            onClick={() => {
              closeMobile()
              navigate('/sites')
            }}
            className="group relative w-full overflow-hidden flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-300
              bg-gradient-to-br from-indigo-500 via-primary to-purple-600
              text-white shadow-md shadow-primary/20
              hover:shadow-xl hover:shadow-indigo-500/25 hover:scale-[1.02]
              active:scale-[0.97]"
          >
            {/* Animated shimmer overlay */}
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            
            {/* Left glow accent */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-white/40 blur-[1px]" />

            {/* Icon */}
            <div className="relative z-10 w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center backdrop-blur-[1px]">
              <Globe size={15} className="text-white" />
            </div>

            {/* Text */}
            <div className="relative z-10 flex-1 text-left">
              <div className="text-[13px] font-semibold leading-tight">创建报告网站</div>
              <div className="text-[10px] font-normal text-white/70 leading-tight mt-0.5">AI 一键生成行业分析报告</div>
            </div>

            {/* Animated NEW badge */}
            <span className="relative z-10 text-[9px] font-bold px-1.5 py-1 rounded-md bg-white/20 text-white
              animate-pulse shadow-inner shadow-white/10">
              NEW
            </span>
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-4 pb-4">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => handleSelect(session.id)}
                    className={cn(
                      'group flex items-center gap-1 px-2 py-2 rounded-lg cursor-pointer text-sm transition-colors',
                      currentSessionId === session.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted text-foreground'
                    )}
                  >
                    {editingId === session.id ? (
                      <div className="flex-1 flex items-center gap-1">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(session.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="flex-1 px-1 py-0.5 text-sm bg-background rounded border border-primary outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleRename(session.id)} className="p-0.5 hover:text-primary">
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-0.5 hover:text-destructive">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 truncate">{session.name}</span>
                        {loadingSessionId === session.id ? (
                          <Loader2 size={12} className="animate-spin text-primary flex-shrink-0" />
                        ) : (
                          <div className="hidden group-hover:flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingId(session.id)
                              setEditName(session.name)
                            }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => handleDelete(session.id, e)}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              {search ? '未找到匹配的对话' : '暂无对话记录'}
            </div>
          )}
        </div>

        {/* Bottom: User info + Storage + Theme + Logout */}
        <div className="border-t border-border px-3 py-2 flex-shrink-0 space-y-1">
          {/* User info */}
          {user && (
            <div className="px-3 py-1.5 text-sm text-foreground flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
                {user.username[0].toUpperCase()}
              </div>
              <span className="truncate font-medium">{user.username}</span>
              {user.role === 'admin' && (
                <Shield size={12} className="text-yellow-500 flex-shrink-0" />
              )}
            </div>
          )}

          {/* Storage bar */}
          {storageInfo && (
            <div className="px-3 py-1.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <HardDrive size={10} />
                  存储
                </span>
                <span>{formatBytes(storageInfo.used)} / {formatBytes(storageInfo.limit)}</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${storageColor}`}
                  style={{ width: `${Math.min(storagePercentage, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Admin link */}
          {user?.role === 'admin' && (
            <button
              onClick={() => {
                closeMobile()
                navigate('/admin')
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <Shield size={16} />
              管理后台
            </button>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {resolvedTheme === 'dark' ? '浅色模式' : '深色模式'}
          </button>

          {/* Logout */}
          <button
            onClick={() => {
              clearToken()
              clearMessages()
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>
    </>
  )
}
