import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AdminUser, UserDetail } from '../lib/types'
import { Loader2, Search, ChevronLeft, ChevronRight, X, Zap } from 'lucide-react'

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [creditAmount, setCreditAmount] = useState(0)
  const [creditDesc, setCreditDesc] = useState('管理员充值')

  const load = async (p = page, s = search) => {
    setLoading(true)
    try {
      const d = await api.users({ page: p, limit: 20, search: s })
      setUsers(d.users); setTotal(d.total); setPage(p)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openDetail = async (id: string) => {
    try { setDetail(await api.userDetail(id)) } catch (e) { console.error(e) }
  }

  const toggleStatus = async (id: string, current: string) => {
    const newStatus = current === 'active' ? 'disabled' : 'active'
    await api.setUserStatus(id, newStatus)
    load()
  }

  const addCredits = async (id: string) => {
    await api.addCredits(id, creditAmount, creditDesc)
    alert('积分已更新')
    setCreditAmount(0)
    if (detail?.user?.id === id) openDetail(id)
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>用户管理</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px' }}>
          <Search size={14} color="var(--muted)" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(1, search)}
            placeholder="搜索用户名..." style={{ border: 'none', outline: 'none', flex: 1, padding: '8px 0', background: 'transparent' }}
          />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>共 {total} 用户</span>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={20} className="spinner" /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead><tr><th>用户名</th><th>角色</th><th>会员</th><th>积分</th><th>门户</th><th>存储</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(u.id)}>
                  <td style={{ fontWeight: 500 }}>{u.username}</td>
                  <td><span className="badge badge-gray">{u.role}</span></td>
                  <td><span className="badge badge-amber">{u.tier}</span></td>
                  <td>{u.credits}</td>
                  <td>{u.portal_count}</td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>{u.storage_used > 0 ? (u.storage_used / 1024 / 1024).toFixed(1) + 'MB' : '-'}</td>
                  <td><span className={`badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}`}>{u.status === 'active' ? '正常' : '禁用'}</span></td>
                  <td style={{ fontSize: 11 }}>{new Date(u.created_at).toLocaleDateString('zh-CN')}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => toggleStatus(u.id, u.status)}>
                      {u.status === 'active' ? '禁用' : '启用'}
                    </button>
                  </td>
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

      {/* Detail Modal */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <button onClick={() => setDetail(null)} style={{ position: 'absolute', top: 16, right: 16, border: 'none', background: 'transparent', fontSize: 18 }}><X size={18} /></button>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{detail.user.username}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 13 }}>
              <div>ID: <code>{detail.user.id}</code></div>
              <div>角色: <span className="badge badge-gray">{detail.user.role}</span></div>
              <div>会员: {detail.membership?.tier || 'free'}</div>
              <div>积分: <strong>{detail.credits}</strong></div>
              <div>注册: {new Date(detail.user.created_at).toLocaleDateString()}</div>
            </div>

            {/* Credit management */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>积分管理</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="number" value={creditAmount || ''} onChange={e => setCreditAmount(Number(e.target.value))} placeholder="数量(正为充值,负为扣除)" style={{ width: 160, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
                <input value={creditDesc} onChange={e => setCreditDesc(e.target.value)} placeholder="备注" style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
                <button className="btn btn-primary" onClick={() => addCredits(detail.user.id)}>确认</button>
              </div>
            </div>

            {detail.orders?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>支付记录 ({detail.orders.length})</h3>
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  <table><thead><tr><th>订单号</th><th>商品</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
                    <tbody>{detail.orders.map((o: any) => (
                      <tr key={o.id}><td style={{ fontSize: 11 }}>{o.id}</td><td>{o.product_name}</td><td>¥{o.amount_yuan}</td><td><span className={`badge ${o.status === 'paid' ? 'badge-green' : 'badge-gray'}`}>{o.status}</span></td><td style={{ fontSize: 11 }}>{o.paid_at ? new Date(o.paid_at).toLocaleDateString() : '-'}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}

            {detail.portals?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>门户 ({detail.portals.length})</h3>
                <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                  <table><thead><tr><th>标题</th><th>访问</th><th>大小</th></tr></thead>
                    <tbody>{detail.portals.map((p: any) => (
                      <tr key={p.id}><td><a href={`https://yooclaw.yookeer.com${p.url}`} target="_blank">{p.title || p.slug}</a></td><td>{p.view_count}</td><td style={{ fontSize: 11 }}>{(p.size_bytes / 1024 / 1024).toFixed(2)}MB</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
