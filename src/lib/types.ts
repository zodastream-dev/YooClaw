export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  toolCalls?: ToolCall[]
  gameUrl?: string
  gameTitle?: string
  progress?: number
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

export interface ReportSite {
  id: string
  slug: string
  title: string
  companyName: string
  type: string
  viewCount: number
  isPublished: boolean
  url: string
  createdAt: number
  updatedAt: number
}

// ========== Wizard Types ==========

export interface WizardFormData {
  companyName: string
  businessDesc: string
  analysisMethods: string[]
  perspective: string
}

export interface ResearchData {
  overview: string
  marketData: string
  competitors: string
  news: string
  opportunities: string
}

// ========== Portal Builder Types ==========

export interface WidgetSourceConfig {
  id: string
  name: string
  aiProvider: string
  aiModel: string
  apiKey: string
  keywords: string[]
  updateFrequency: string
  customPrompt: string
}

export interface WidgetConfig {
  type: 'report-generator' | 'intel-monitor'
  title: string
  config: Record<string, unknown>
}

// ========= Video Types ==========

export interface VideoData {
  id: string
  userId: string
  title: string
  prompt: string
  duration: string
  resolution: string
  ratio: string
  inputType: string
  videoUrl: string
  videoPath: string
  submitId: string
  createdAt: string
}

// ========== Payment Types ==========

export interface MembershipPlan {
  id: number
  name: string
  tier: 'free' | 'basic' | 'premium'
  priceYuan: number
  durationDays: number
  monthlyCredits: number
  features: string[]
  isActive: boolean
}

export interface CreditPackage {
  id: number
  name: string
  credits: number
  priceYuan: number
  isActive: boolean
}

export interface UserMembership {
  id: number
  userId: string
  planId: number
  tier: 'free' | 'basic' | 'premium'
  startedAt: string
  expiresAt: string
  autoRenew: boolean
}

export interface Order {
  id: string
  userId: string
  orderType: 'membership' | 'credit_package'
  productId: number
  productName: string
  amountYuan: number
  status: 'pending' | 'paid' | 'expired' | 'refunded'
  paymentMethod: 'wechat' | 'alipay' | null
  paymentUrl: string
  paidAt: string | null
  createdAt: string
  expiredAt: string
}

export interface CreditTransaction {
  id: number
  userId: string
  type: 'charge' | 'consume' | 'refund' | 'monthly_grant'
  amount: number
  balanceAfter: number
  description: string
  relatedId: string
  createdAt: string
}

export interface PayInitiateResult {
  paymentUrl: string
  qrCode?: string
  method: 'wechat' | 'alipay'
}
