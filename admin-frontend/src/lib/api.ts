import type { DashboardData, AdminUser, AdminPayment, AdminPortal, AdminVideo, UserDetail, MembershipPlan, CreditPackage } from './types'

const API = 'https://yooclaw.yookeer.com/api/v1/admin'
let TOKEN = ''

export function setToken(t: string) { TOKEN = t }

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    ...options,
    headers: { ...options?.headers, 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
  })
  if (r.status === 401) { localStorage.removeItem('admin_token'); location.reload() }
  const data = await r.json()
  if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`)
  return data.data
}

export const api = {
  dashboard: () => req<DashboardData>('/dashboard'),

  users: (params: { page?: number; limit?: number; search?: string }) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.limit) q.set('limit', String(params.limit))
    if (params.search) q.set('search', params.search)
    return req<{ users: AdminUser[]; total: number; page: number; limit: number }>('/users?' + q)
  },

  userDetail: (id: string) => req<UserDetail>('/users/' + id),
  setUserStatus: (id: string, status: 'active' | 'disabled') => req('/users/' + id + '/status', { method: 'POST', body: JSON.stringify({ status }) }),
  addCredits: (id: string, amount: number, description: string) => req('/users/' + id + '/credits', { method: 'POST', body: JSON.stringify({ amount, description }) }),

  payments: (params: { page?: number; limit?: number; status?: string }) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.limit) q.set('limit', String(params.limit))
    if (params.status) q.set('status', params.status)
    return req<{ payments: AdminPayment[]; total: number; page: number; limit: number }>('/payments?' + q)
  },

  portals: (params: { page?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.limit) q.set('limit', String(params.limit))
    return req<{ portals: AdminPortal[]; total: number; page: number; limit: number }>('/portals?' + q)
  },

  videos: (params: { page?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.limit) q.set('limit', String(params.limit))
    return req<{ videos: AdminVideo[]; total: number; page: number; limit: number }>('/videos?' + q)
  },

  config: () => req<{ membershipPlans: MembershipPlan[]; creditPackages: CreditPackage[] }>('/config'),
  updateMembership: (id: number, data: Partial<MembershipPlan>) => req('/config/membership/' + id, { method: 'PUT', body: JSON.stringify(data) }),
  updateCreditPackage: (id: number, data: Partial<CreditPackage>) => req('/config/credits/' + id, { method: 'PUT', body: JSON.stringify(data) }),
}
