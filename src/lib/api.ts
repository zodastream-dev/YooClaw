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
  const token = localStorage.getItem('yooclaw_token')
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
export const renameSession = renameUserSession
