import { create } from 'zustand'
import type { Message, Session, ChatMode, User, StorageInfo } from './types'
import { THEME_KEY } from './constants'
import { getMe, getStorage } from './api'

// Theme store
interface ThemeState {
  theme: 'light' | 'dark' | 'system'
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

function resolveTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function applyTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export const useThemeStore = create<ThemeState>((set) => {
  const saved = (localStorage.getItem(THEME_KEY) as 'light' | 'dark' | 'system') || 'system'
  const resolved = resolveTheme(saved)
  applyTheme(resolved)

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = useThemeStore.getState().theme
    if (current === 'system') {
      const newResolved = resolveTheme('system')
      applyTheme(newResolved)
      set({ resolvedTheme: newResolved })
    }
  })

  return {
    theme: saved,
    resolvedTheme: resolved,
    setTheme: (theme) => {
      const resolved = resolveTheme(theme)
      applyTheme(resolved)
      localStorage.setItem(THEME_KEY, theme)
      set({ theme, resolvedTheme: resolved })
    },
  }
})

// Auth store
interface AuthState {
  token: string | null
  isAuthenticated: boolean
  user: User | null
  storageInfo: StorageInfo | null
  setUser: (user: User) => void
  setToken: (token: string, user: User) => void
  clearToken: () => void
  fetchUserInfo: () => Promise<void>
  fetchStorage: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('codebuddy_token'),
  isAuthenticated: !!localStorage.getItem('codebuddy_token'),
  user: null,
  storageInfo: null,
  setUser: (user) => set({ user }),
  setToken: (token, user) => {
    localStorage.setItem('codebuddy_token', token)
    set({ token, isAuthenticated: true, user })
  },
  clearToken: () => {
    localStorage.removeItem('codebuddy_token')
    set({ token: null, isAuthenticated: false, user: null, storageInfo: null })
  },
  fetchUserInfo: async () => {
    try {
      const res = await getMe()
      if (res.data?.user) {
        set({ user: res.data.user })
      }
    } catch {
      // Token might be invalid
    }
  },
  fetchStorage: async () => {
    try {
      const res = await getStorage()
      if (res.data) {
        set({ storageInfo: res.data as StorageInfo })
      }
    } catch {
      // ignore
    }
  },
}))

// Sidebar store
interface SidebarState {
  isOpen: boolean
  isMobileOpen: boolean
  toggle: () => void
  toggleMobile: () => void
  closeMobile: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: true,
  isMobileOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  toggleMobile: () => set((s) => ({ isMobileOpen: !s.isMobileOpen })),
  closeMobile: () => set({ isMobileOpen: false }),
}))

// Chat store
interface ChatState {
  messages: Message[]
  currentMode: ChatMode
  isStreaming: boolean
  isLoadingHistory: boolean
  currentRunId: string | null
  currentSessionId: string | null
  sendMessage: ((text: string) => void) | null
  stopGeneration: (() => void) | null
  setMode: (mode: ChatMode) => void
  addMessage: (msg: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  appendToMessage: (id: string, text: string) => void
  setStreaming: (v: boolean) => void
  setLoadingHistory: (v: boolean) => void
  setRunId: (id: string | null) => void
  setCurrentSessionId: (id: string | null) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  currentMode: 'craft',
  isStreaming: false,
  isLoadingHistory: false,
  currentRunId: null,
  currentSessionId: null,
  sendMessage: null,
  stopGeneration: null,
  setMode: (mode) => set({ currentMode: mode }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  appendToMessage: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)),
    })),
  setStreaming: (v) => set({ isStreaming: v }),
  setLoadingHistory: (v) => set({ isLoadingHistory: v }),
  setRunId: (id) => set({ currentRunId: id }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  clearMessages: () => set({ messages: [] }),
}))

// Session store
interface SessionState {
  sessions: Session[]
  currentSessionId: string | null
  isLoading: boolean
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  updateSessionName: (id: string, name: string) => void
  setCurrentSession: (id: string | null) => void
  setLoading: (v: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  currentSessionId: null,
  isLoading: false,
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) => set((s) => ({ sessions: [session, ...s.sessions] })),
  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      currentSessionId: s.currentSessionId === id ? null : s.currentSessionId,
    })),
  updateSessionName: (id, name) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, name } : sess)),
    })),
  setCurrentSession: (id) => set({ currentSessionId: id }),
  setLoading: (v) => set({ isLoading: v }),
}))
