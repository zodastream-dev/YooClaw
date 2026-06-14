import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { MembershipPlan, CreditPackage } from '../lib/types'
import { Loader2, Save } from 'lucide-react'

export default function Settings() {
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [packages, setPackages] = useState<CreditPackage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.config().then(d => {
      setPlans(d.membershipPlans.map(p => ({ ...p, features: typeof p.features === 'string' ? JSON.parse(p.features as any) : p.features })))
      setPackages(d.creditPackages)
    }).finally(() => setLoading(false))
  }, [])

  const updatePlan = async (plan: MembershipPlan) => {
    await api.updateMembership(plan.id, { price_yuan: plan.price_yuan, monthly_credits: plan.monthly_credits, duration_days: plan.duration_days, features: plan.features } as any)
    alert('已保存')
  }

  const updatePackage = async (pkg: CreditPackage) => {
    await api.updateCreditPackage(pkg.id, { credits: pkg.credits, price_yuan: pkg.price_yuan })
    alert('已保存')
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Loader2 size={24} className="spinner" /></div>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>系统设置</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>会员套餐</h2>
        <table>
          <thead><tr><th>套餐名</th><th>等级</th><th>价格(元)</th><th>时长(天)</th><th>月积分</th><th></th></tr></thead>
          <tbody>
            {plans.filter(p => p.tier !== 'free').map(p => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td><span className="badge badge-amber">{p.tier}</span></td>
                <td><input type="number" value={p.price_yuan} onChange={e => setPlans(plans.map(x => x.id === p.id ? { ...x, price_yuan: Number(e.target.value) } : x))} style={{ width: 70, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)' }} /></td>
                <td><input type="number" value={p.duration_days} onChange={e => setPlans(plans.map(x => x.id === p.id ? { ...x, duration_days: Number(e.target.value) } : x))} style={{ width: 60, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)' }} /></td>
                <td><input type="number" value={p.monthly_credits} onChange={e => setPlans(plans.map(x => x.id === p.id ? { ...x, monthly_credits: Number(e.target.value) } : x))} style={{ width: 60, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)' }} /></td>
                <td><button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => updatePlan(p)}><Save size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>积分套餐</h2>
        <table>
          <thead><tr><th>套餐名</th><th>积分</th><th>价格(元)</th><th></th></tr></thead>
          <tbody>
            {packages.map(pkg => (
              <tr key={pkg.id}>
                <td>{pkg.name}</td>
                <td><input type="number" value={pkg.credits} onChange={e => setPackages(packages.map(x => x.id === pkg.id ? { ...x, credits: Number(e.target.value) } : x))} style={{ width: 80, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)' }} /></td>
                <td><input type="number" value={pkg.price_yuan} onChange={e => setPackages(packages.map(x => x.id === pkg.id ? { ...x, price_yuan: Number(e.target.value) } : x))} style={{ width: 80, padding: '3px 6px', borderRadius: 4, border: '1px solid var(--border)' }} /></td>
                <td><button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => updatePackage(pkg)}><Save size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
