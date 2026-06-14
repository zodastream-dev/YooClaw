import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AdminVideo } from '../lib/types'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

export default function Videos() {
  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = async (p = 1) => {
    setLoading(true)
    try { const d = await api.videos({ page: p }); setVideos(d.videos); setTotal(d.total); setPage(p) } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>视频管理 <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>共 {total}</span></h1>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={20} className="spinner" /></div> : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table>
            <thead><tr><th>标题</th><th>用户</th><th>时长(秒)</th><th>创建时间</th></tr></thead>
            <tbody>
              {videos.map(v => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 500 }}>{v.title}</td>
                  <td>{v.username}</td>
                  <td>{v.duration || '-'}</td>
                  <td style={{ fontSize: 11 }}>{new Date(v.created_at).toLocaleDateString('zh-CN')}</td>
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
