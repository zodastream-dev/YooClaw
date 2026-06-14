import type { APIResponse, RunData, SessionData, User, StorageInfo, AdminUser, AdminStats, ReportSite, WidgetConfig, VideoData } from './types'
import { API_BASE, TOKEN_KEY } from './constants'

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function headers(contentType = false): Record<string, string> {
  const h: Record<string, string> = {
    'X-CodeBuddy-Request': '1',
  }
  const token = getToken()
  if (token) {
    h['Authorization'] = `Bearer ${token}`
  }
  if (contentType) {
    h['Content-Type'] = 'application/json'
  }
  return h
}

async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<APIResponse<T>> {
  const opts: RequestInit = {
    method,
    headers: headers(!!body),
  }
  if (body) {
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(`${API_BASE}${path}`, opts)
  const json = await res.json()
  if (!res.ok) {
    const errMsg = json?.error?.message || `HTTP ${res.status}`
    throw new Error(errMsg)
  }
  return json
}

// ========== Auth ==========

export async function register(username: string, password: string) {
  const res = await apiRequest<{ token: string; user: User }>('POST', '/api/v1/auth/register', { username, password })
  if (res.data?.token) {
    localStorage.setItem(TOKEN_KEY, res.data.token)
    return res.data
  }
  throw new Error(res.error?.message || 'Registration failed')
}

export async function login(username: string, password: string) {
  const res = await apiRequest<{ token: string; user: User }>('POST', '/api/v1/auth/login', { username, password })
  if (res.data?.token) {
    localStorage.setItem(TOKEN_KEY, res.data.token)
    return res.data
  }
  throw new Error(res.error?.message || 'Login failed')
}

export async function getMe() {
  return apiRequest<{ user: User }>('GET', '/api/v1/auth/me')
}

export async function getAuthStatus() {
  return apiRequest<{ authenticated: boolean; user: User | null }>('GET', '/api/v1/auth/status')
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
}

// ========== Health ==========
export async function getHealth() {
  return apiRequest<{ status: string }>('GET', '/api/v1/health')
}

// ========== Runs ==========
export async function submitRun(text: string, sessionId?: string, sender?: { id: string; name: string }) {
  return apiRequest<RunData>('POST', '/api/v1/runs', { text, sessionId, sender })
}

/**
 * SSE stream using fetch + ReadableStream (instead of EventSource).
 * EventSource cannot send Authorization headers, which breaks cross-origin auth.
 * This async generator yields parsed SSE events.
 */
export async function* streamRun(runId: string, sessionId?: string): AsyncGenerator<any> {
  const token = getToken()
  let url = `${API_BASE}/api/v1/runs/${runId}/stream`
  const params: string[] = []
  if (sessionId) {
    params.push(`sessionId=${encodeURIComponent(sessionId)}`)
  }
  if (params.length > 0) {
    url += `?${params.join('&')}`
  }

  const fetchHeaders: Record<string, string> = {
    'X-CodeBuddy-Request': '1',
  }
  if (token) {
    fetchHeaders['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, {
    headers: fetchHeaders,
  })

  if (!response.ok) {
    throw new Error(`Stream request failed: HTTP ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '{}') continue
        try {
          yield JSON.parse(jsonStr)
        } catch {
          // Ignore parse errors for incomplete events
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function cancelRun(runId: string) {
  return apiRequest('POST', `/api/v1/runs/${runId}/cancel`)
}

// ========== User Sessions (local DB) ==========
export async function getUserSessions() {
  return apiRequest<SessionData[]>('GET', '/api/v1/user/sessions')
}

export async function createUserSession(sessionId: string, name: string) {
  return apiRequest<SessionData>('POST', '/api/v1/user/sessions', { sessionId, name })
}

export async function deleteUserSession(id: string) {
  return apiRequest('DELETE', `/api/v1/user/sessions/${id}`)
}

export async function renameUserSession(id: string, name: string) {
  return apiRequest('POST', `/api/v1/user/sessions/${id}/rename`, { name })
}

export async function getSessionMessages(sessionId: string) {
  return apiRequest<{ id: string; role: string; content: string; timestamp: number }[]>('GET', `/api/v1/user/sessions/${sessionId}/messages`)
}

// ========== User Storage ==========
export async function getStorage() {
  return apiRequest<StorageInfo>('GET', '/api/v1/user/storage')
}

// ========== Admin ==========
export async function getAdminUsers() {
  return apiRequest<AdminUser[]>('GET', '/api/v1/admin/users')
}

export async function updateAdminUser(userId: string, updates: { status?: string }) {
  return apiRequest<AdminUser>('PATCH', `/api/v1/admin/users/${userId}`, updates)
}

export async function deleteAdminUser(userId: string) {
  return apiRequest('DELETE', `/api/v1/admin/users/${userId}`)
}

export async function getAdminStats() {
  return apiRequest<AdminStats>('GET', '/api/v1/admin/stats')
}

// ========== Report Sites ==========

export async function createReportSite(companyName: string) {
  return apiRequest<{ id: string; slug: string; title: string; companyName: string; url: string; createdAt: number }>(
    'POST', '/api/v1/sites/generate', { companyName }
  )
}

export async function getUserReportSites(type?: string) {
  const query = type ? `?type=${encodeURIComponent(type)}` : ''
  return apiRequest<ReportSite[]>('GET', `/api/v1/user/sites${query}`)
}

export async function deleteReportSite(slug: string) {
  return apiRequest('DELETE', `/api/v1/sites/${slug}`)
}

// ========== Games ==========

export async function createGame(gameName: string) {
  return apiRequest<{ id: string; slug: string; title: string; gameName: string; url: string; createdAt: number }>(
    'POST', '/api/v1/games/generate', { gameName }
  )
}

// ========== Wizard: Report Generation ==========

/**
 * SSE stream for Step 2 — Research phase.
 * Yields parsed SSE events: progress_update, stage, research_complete.
 */
export async function* streamResearch(
  formData: {
    companyName: string
    businessDesc: string
    analysisMethods: string[]
    perspective: string
    searchPlatform?: string
    searchApiKey?: string
    searchEndpoint?: string
    searchModel?: string
  }
): AsyncGenerator<any> {
  const token = getToken()
  const response = await fetch(`${API_BASE}/api/v1/sites/research`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-CodeBuddy-Request': '1',
    },
    body: JSON.stringify(formData),
  })

  if (!response.ok) {
    throw new Error(`Research request failed: HTTP ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '{}') continue
        try {
          yield JSON.parse(jsonStr)
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * SSE stream for Step 3 — Report generation + deployment phase.
 * Yields parsed SSE events: progress_update, stage, report_complete.
 */
export async function* streamWizardReport(
  formData: { companyName: string; businessDesc: string; analysisMethods: string[]; perspective: string },
  researchData: string
): AsyncGenerator<any> {
  const token = getToken()
  const response = await fetch(`${API_BASE}/api/v1/sites/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-CodeBuddy-Request': '1',
    },
    body: JSON.stringify({ formData, researchData }),
  })

  if (!response.ok) {
    throw new Error(`Report generation failed: HTTP ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '{}') continue
        try {
          yield JSON.parse(jsonStr)
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ========== User Profile ==========

export async function changePassword(oldPassword: string, newPassword: string) {
  return apiRequest<{ success: boolean }>('POST', '/api/v1/user/change-password', { oldPassword, newPassword })
}

// ========== Portal ==========

export async function deployPortal(siteName: string, siteDesc: string, template: string, slug?: string) {
  return apiRequest<{ id: string; slug: string; title: string; url: string; createdAt: number }>(
    'POST', '/api/v1/sites/portal/deploy', { siteName, siteDesc, template, slug }
  )
}

// ========== Portal Builder (Widget-based) ==========

export async function deployPortalWithWidgets(
  siteName: string,
  siteDesc: string,
  template: string,
  widgets: WidgetConfig[],
  slug?: string,
  customDomain?: string
) {
  return apiRequest<{ id: string; slug: string; title: string; url: string; createdAt: number }>(
    'POST', '/api/v1/sites/portal/deploy', { siteName, siteDesc, template, widgets, slug, customDomain }
  )
}

// ========== Video Generation ==========

export async function videoLogin() {
  return apiRequest<{ verificationUri: string; userCode: string; deviceCode: string }>(
    'POST', '/api/v1/videos/login'
  )
}

export async function videoLoginStatus(deviceCode: string) {
  return apiRequest<{ status: string; message?: string }>(
    'GET', `/api/v1/videos/login/status?device_code=${deviceCode}`
  )
}

export async function videoStatus() {
  return apiRequest<{ loggedIn: boolean; credit?: string }>(
    'GET', '/api/v1/videos/status'
  )
}

export async function generateVideo(params: {
  genType: string
  modelVersion: string
  prompt: string
  duration: string
  resolution: string
  ratio?: string
  provider?: 'dreamina' | 'kling'
  klingModel?: string
  sound?: boolean
  negativePrompt?: string
  cameraControl?: { type: string; config?: { strength: number } }
  image?: string
  images?: string[]
  transitionPrompts?: string[]
  transitionDurations?: string[]
  clips?: any[]
}) {
  return apiRequest<{ id: string; title?: string; url: string; status?: string; message?: string }>(
    'POST', '/api/v1/videos/generate', params
  )
}

export interface VideoTaskStatus {
  id: string
  status: 'completed' | 'failed' | 'processing' | 'concatenating' | 'cancelled' | 'unknown'
  genType: string
  polls: number
  maxPolls: number
  isPolling: boolean
  queueInfo: { queue_idx: number; queue_length: number; queue_status: string } | null
  queueMessage: string
  elapsedMinutes: number
  estimatedMaxMinutes: number
  result: { videoUrl: string | null } | null
  errorMessage: string | null
  multiClip?: { completedClips: number; totalClips: number }
}

export async function videoTaskStatus(submitId: string) {
  return apiRequest<VideoTaskStatus>('GET', `/api/v1/videos/status/${submitId}`)
}

// ========== MP Subscription ==========

export interface MpCandidate {
  id: string
  mpName: string
  mpCover: string
  mpIntro: string
  updateTime: number
  wxsLink: string
}

export async function mpQrLogin() {
  return apiRequest<{ uuid: string; scanUrl: string }>('POST', '/api/mp/qr-login')
}

export async function mpCheckLogin(uuid: string) {
  return apiRequest<{ status: string; vid?: string; token?: string; username?: string; message?: string }>('GET', `/api/mp/check-login/${uuid}`)
}

export async function mpSubscribe(wxsLink: string) {
  return apiRequest<{ mpId: string; mpName: string; mpCover: string }>('POST', '/api/mp/subscribe', { wxsLink })
}

export async function mpUnsubscribe(mpId: string) {
  return apiRequest<void>('DELETE', `/api/mp/subscribe/${mpId}`)
}

export async function mpGetSubscriptions() {
  return apiRequest<{ items: { mpId: string; mpName: string; mpCover: string; subscribedAt: string }[]; count: number; limit: number }>('GET', '/api/mp/subscriptions')
}

export async function mpGetArticles(mpId?: string, page = 1, limit = 20) {
  const path = mpId ? `/api/mp/articles/${mpId}?page=${page}&limit=${limit}` : `/api/mp/articles?limit=${limit}`
  return apiRequest<{ articles: { id: string; title: string; url: string; summary: string; publishTime: string; author: string; mpId?: string }[]; total: number }>('GET', path)
}

/** Search MPs by name via Baidu → WeWe-RSS tRPC */
export async function mpSearchByName(name: string) {
  return apiRequest<{ candidates: MpCandidate[] }>('POST', '/api/mp/search-by-name', { name })
}

/** Subscribe by MP info (from search results) */
export async function mpSubscribeByName(params: { id: string; mpName: string; mpCover: string; mpIntro: string; updateTime: number }) {
  return apiRequest<{ mpId: string; mpName: string }>('POST', '/api/mp/subscribe-by-name', params)
}

/** Lookup MP info from a single WeChat article URL */
export async function mpLookupByUrl(url: string) {
  return apiRequest<MpCandidate>('POST', '/api/mp/lookup-by-url', { url })
}
// ========== Video Management ==========
export async function getUserVideos() {
  return apiRequest<{ items: VideoData[] }>('GET', '/api/v1/videos')
}
export async function deleteVideo(id: string) {
  return apiRequest<void>('DELETE', `/api/v1/videos/${id}`)
}
export async function batchDeleteVideos(ids: string[]) {
  return apiRequest<{ deleted: number }>('POST', '/api/v1/videos/batch-delete', { ids })
}
export async function concatVideos(ids: string[]) {
  return apiRequest<{ videoUrl: string; title: string }>('POST', '/api/v1/videos/concat', { ids })
}
export async function uploadVideo(formData: FormData) {
  const token = localStorage.getItem(TOKEN_KEY)
  const resp = await fetch(`${API_BASE}/api/v1/videos/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err?.error?.message || `上传失败 (${resp.status})`)
  }
  return resp.json()
}
export async function cancelVideoTask(submitId: string) {
  return apiRequest<{ cancelled: boolean }>('POST', `/api/v1/videos/cancel/${submitId}`)
}

// ========== Legacy compatibility ==========
// These map to the new user-scoped APIs
export const getSessions = getUserSessions
export const deleteSession = deleteUserSession

// ========== AI Prompt Optimization ==========
export async function optimizePrompt(rawPrompt: string): Promise<string> {
  const token = getToken()
  const res = await fetch(`${API_BASE}/api/ai-chat`, {
    method: 'POST',
    headers: { ...headers(true), 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ message: `请将以下视频生成提示词进行结构化优化，使其更具逻辑性，便于视频引擎生成高质量视频。优化后的提示词应包含：1)场景描述（时间、地点、氛围）2)主体描述（人物/物体的外观、动作）3)镜头语言（景别、角度、运镜）4)画面细节（光影、色彩、质感）。直接输出优化后的提示词，不要加任何解释说明。\n\n原始提示词：${rawPrompt}` }),
  })
  if (!res.ok) throw new Error('优化失败')
  const data = await res.json()
  return data.reply || ''
}

/** Professional system prompt for video optimization — used by VideoCreatePage workspace */
export const PROMPT_VIDEO_OPTIMIZER = `角色：顶级 AI 视频提示词优化专家，将用户简短碎片化的场景扩写为适合【Seedance 2.0】的电影级中文提示词。

规则：
1. 纯中文输出，画面感强烈的现代汉语。
2. 具象化扩写：不用"好看""炫酷"，转化为具体视觉（如"夕阳逆光勾勒轮廓，丁达尔效应"）。
3. 按"镜头+环境+主体+动作+光影+画质"顺序融合。

必须包含五大要素：
1. 镜头：景别、运镜（推/环绕/低角度/FPV）、节奏（慢动作/延时）
2. 环境：场景设定、时间天气、动态前景/背景元素
3. 主体：外观、服装材质纹理、具体动作、微表情
4. 光影：主光源方向、冷暖对比、画面主色调
5. 风格：电影感、超写实、8K、UE5渲染

输出格式：
[在此处输出优化后的中文提示词，逗号分隔，语言连贯自然。不要加"优化后的中文提示词"等标签文字，直接输出提示词正文]

接着另起一行输出：
【画面分镜拆解】镜头：[景别与运镜] | 主体：[动作/材质/微表情] | 环境光影：[氛围与光影]`;

export async function optimizePromptPro(rawPrompt: string): Promise<string> {
  const token = getToken()
  const res = await fetch(`${API_BASE}/api/ai-chat`, {
    method: 'POST',
    headers: { ...headers(true), 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ message: `${PROMPT_VIDEO_OPTIMIZER}\n\n用户原始提示词：${rawPrompt}` }),
  })
  if (!res.ok) throw new Error('优化失败')
  const data = await res.json()
  return data.reply || ''
}
export const renameSession = renameUserSession

// ========== Payment ==========

export async function getMembershipPlans() {
  return apiRequest<{ plans: import('./types').MembershipPlan[] }>('GET', '/api/v1/pay/plans')
}

export async function getCreditPackages() {
  return apiRequest<{ packages: import('./types').CreditPackage[] }>('GET', '/api/v1/pay/credit-packages')
}

export async function createPayOrder(type: 'membership' | 'credit_package', productId: number) {
  return apiRequest<{ order: import('./types').Order; needPay: boolean }>('POST', '/api/v1/pay/orders', { type, productId })
}

export async function initiatePayment(orderId: string, method: 'wechat' = 'wechat') {
  return apiRequest<import('./types').PayInitiateResult>('POST', `/api/v1/pay/orders/${orderId}/pay`, { method })
}

export async function getPayOrder(orderId: string) {
  return apiRequest<{ order: import('./types').Order }>('GET', `/api/v1/pay/orders/${orderId}`)
}

export async function getUserPayOrders() {
  return apiRequest<{ orders: import('./types').Order[] }>('GET', '/api/v1/pay/orders')
}

export async function getUserMembership() {
  return apiRequest<{ membership: import('./types').UserMembership | null; tier: string }>('GET', '/api/v1/pay/user/membership')
}

export async function getUserCredits() {
  return apiRequest<{ balance: number }>('GET', '/api/v1/pay/user/credits')
}

export async function getCreditTransactions() {
  return apiRequest<{ transactions: import('./types').CreditTransaction[] }>('GET', '/api/v1/pay/user/transactions')
}
