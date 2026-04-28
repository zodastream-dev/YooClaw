export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  status: 'running' | 'completed' | 'error'
  args?: string
  result?: string
}

export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  lastMessage?: string
}

export type RunStatus = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'

export type ChatMode = 'craft' | 'plan' | 'ask'

export interface APIResponse<T = unknown> {
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface RunData {
  runId: string
  status: RunStatus
  sessionId: string
}

export interface SSEEvent {
  event?: string
  data: string
}

export interface SessionData {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

// ========== Multi-User Types ==========

export interface User {
  id: string
  username: string
  role: 'admin' | 'user'
  storageUsed: number
  storageLimit: number
  status?: 'active' | 'disabled'
}

export interface StorageInfo {
  used: number
  limit: number
  percentage: number
  canCreate: boolean
}

export interface AdminUser {
  id: string
  username: string
  role: 'admin' | 'user'
  storageUsed: number
  storageLimit: number
  status: 'active' | 'disabled'
  createdAt: string
}

export interface AdminStats {
  totalUsers: number
  totalStorage: number
  activeUsers: number
}
