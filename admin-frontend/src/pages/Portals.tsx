import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AdminPortal } from '../lib/types'
import { Loader2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

export default function Portals() {
  const [portals, setPortals] = useState<AdminPortal[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = async (p = 1) => {
    setLoading(true)
    try { const d = await api.portals({ page: p }); setPortals(d.portals); setTotal(d.total); setPage(p) } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>门户管理 <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>共 {total}</span></h1>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={20} className="spinner" /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead><tr><th>标题</th><th>用户</th><th>状态</th><th>访问量</th><th>大小</th><th>创建时间</th><th>链接</th></tr></thead>
            <tbody>
              {portals.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 500 }}>{p.title || p.slug}</td>
                  <td>{p.username}</td>
                  <td><span className={`badge ${p.is_published ? 'badge-green' : 'badge-amber'}`}>{p.is_published ? '在线' : '草稿'}</span></td>
                  <td>{p.view_count}</td>
                  <td style={{ fontSize: 11 }}>{(p.size_bytes / 1024 / 1024).toFixed(1)}MB</td>
                  <td style={{ fontSize: 11 }}>{new Date(p.created_at).toLocaleDateString('zh-CN')}</td>
                  <td><a href={`https://yooclaw.yookeer.com/portal/${p.slug}`} target="_blank"><ExternalLink size={14} /></a></td>
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
