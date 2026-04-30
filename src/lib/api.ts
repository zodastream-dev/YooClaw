import type { APIResponse, RunData, SessionData, User, StorageInfo, AdminUser, AdminStats } from './types'
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
  return apiRequest<User>('GET', '/api/v1/auth/me')
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

// ========== Legacy compatibility ==========
// These map to the new user-scoped APIs
export const getSessions = getUserSessions
export const deleteSession = deleteUserSession
export const renameSession = renameUserSession
