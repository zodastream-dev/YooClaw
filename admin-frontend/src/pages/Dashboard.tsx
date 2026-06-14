import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { DashboardData } from '../lib/types'
import { Users, CreditCard, Globe, Zap, Loader2 } from 'lucide-react'

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { api.dashboard().then(setData).finally(() => setLoading(false)) }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Loader2 size={24} className="spinner" /></div>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>仪表盘</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="stat"><div className="stat-title">总用户</div><div className="stat-value">{data?.users.total}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>今日 +{data?.users.today}</div></div>
        <div className="stat"><div className="stat-title">支付总额</div><div className="stat-value">¥{((data?.payments.totalAmount || 0) / 100).toFixed(0)}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>订单 {data?.payments.totalOrders}</div></div>
        <div className="stat"><div className="stat-title">本月收入</div><div className="stat-value">¥{((data?.payments.monthAmount || 0) / 100).toFixed(0)}</div></div>
        <div className="stat"><div className="stat-title">门户数</div><div className="stat-value">{data?.portals}</div></div>
        <div className="stat"><div className="stat-title">视频数</div><div className="stat-value">{data?.videos}</div></div>
        <div className="stat"><div className="stat-title">总积分</div><div className="stat-value">{data?.creditsTotal}</div></div>
      </div>
      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>会员分布</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          {Object.entries(data?.memberships || {}).map(([tier, cnt]) => (
            <div key={tier} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 600 }}>{cnt}</div>
              <div className="badge badge-gray">{tier === 'free' ? '免费' : tier === 'basic' ? '基础' : tier === 'premium' ? '高级' : tier}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
