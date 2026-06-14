import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AdminPayment } from '../lib/types'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

export default function Payments() {
  const [payments, setPayments] = useState<AdminPayment[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async (p = 1, s = status) => {
    setLoading(true)
    try { const d = await api.payments({ page: p, limit: 20, status: s }); setPayments(d.payments); setTotal(d.total); setPage(p) } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [status])

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>支付订单</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['', 'paid', 'pending', 'expired'].map(s => (
          <button key={s} className={`btn ${status === s ? 'btn-primary' : ''}`} onClick={() => setStatus(s)} style={{ fontSize: 12 }}>
            {s === '' ? '全部' : s === 'paid' ? '已支付' : s === 'pending' ? '待支付' : '已过期'}
          </button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>共 {total} 条</span>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={20} className="spinner" /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead><tr><th>订单号</th><th>用户</th><th>商品</th><th>金额</th><th>方式</th><th>状态</th><th>时间</th></tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td style={{ fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.id}</td>
                  <td>{p.username}</td>
                  <td>{p.product_name}</td>
                  <td style={{ fontWeight: 500 }}>¥{p.amount_yuan}</td>
                  <td><span className="badge badge-gray">{p.payment_method || '-'}</span></td>
                  <td><span className={`badge ${p.status === 'paid' ? 'badge-green' : p.status === 'expired' ? 'badge-red' : 'badge-amber'}`}>{p.status === 'paid' ? '已付' : p.status === 'expired' ? '过期' : p.status}</span></td>
                  <td style={{ fontSize: 11 }}>{p.paid_at ? new Date(p.paid_at).toLocaleString('zh-CN') : p.created_at ? new Date(p.created_at).toLocaleDateString('zh-CN') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12, alignItems: 'center' }}>
            <button className="btn" onClick={() => load(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 12 }}>{page} / {Math.ceil(total / 20)}</span>
            <button className="btn" onClick={() => load(page + 1)} disabled={page >= Math.ceil(total / 20)}><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
