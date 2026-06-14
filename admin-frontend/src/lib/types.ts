export interface DashboardData {
  users: { total: number; today: number; month: number }
  payments: { totalOrders: number; totalAmount: number; monthAmount: number }
  memberships: Record<string, number>
  creditsTotal: number
  portals: number
  videos: number
  storageTotal: number
}

export interface AdminUser {
  id: string; username: string; email?: string; role: string; status: string; created_at: string
  tier: string; member_expires: string | null; credits: number
  portal_count: number; storage_used: number
}

export interface AdminPayment {
  id: string; user_id: string; username: string; order_type: string
  product_name: string; amount_yuan: number; status: string
  payment_method: string | null; paid_at: string | null; created_at: string
}

export interface AdminPortal {
  id: number; user_id: string; username: string; title: string; slug: string
  is_published: boolean; view_count: number; size_bytes: number; created_at: string; url: string
}

export interface AdminVideo {
  id: number; user_id: string; username: string; title: string; duration: number; created_at: string
}

export interface UserDetail {
  user: any; membership: any; credits: number; portals: any[]; videos: any[]; orders: any[]; transactions: any[]
}

export interface MembershipPlan {
  id: number; name: string; tier: string; price_yuan: number; duration_days: number; monthly_credits: number; features: string[]
}

export interface CreditPackage {
  id: number; name: string; credits: number; price_yuan: number
}
