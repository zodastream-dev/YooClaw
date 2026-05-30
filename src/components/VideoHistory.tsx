import { useEffect, useState, useRef } from 'react'
import { Play, Trash2, Film, Download, Combine, CheckSquare, Square, X, Loader2 } from 'lucide-react'
import type { VideoData } from '@/lib/types'
import { getUserVideos, deleteVideo, batchDeleteVideos, concatVideos } from '@/lib/api'

function formatDate(raw: string | number | undefined): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return String(raw)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function VideoThumbnail({ url, title }: { url: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasFrame, setHasFrame] = useState(false)
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => setHasFrame(true)
    v.addEventListener('loadeddata', onLoaded)
    v.currentTime = 0.1
    return () => v.removeEventListener('loadeddata', onLoaded)
  }, [url])
  return (
    <div className="w-20 h-12 rounded overflow-hidden bg-black/60 relative flex-shrink-0">
      <video ref={videoRef} src={url} className="w-full h-full object-cover" preload="metadata" muted playsInline onLoadedData={() => setHasFrame(true)} />
      {!hasFrame && <div className="absolute inset-0 flex items-center justify-center"><Film size={14} className="text-muted-foreground/60" /></div>}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/40"><Play size={14} className="text-white" /></div>
    </div>
  )
}

export function VideoHistory() {
  const [videos, setVideos] = useState<VideoData[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    setLoading(true)
    getUserVideos().then(res => { setVideos(res.data?.items || []); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const toggle = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  const toggleAll = () => {
    if (selected.size === videos.length) setSelected(new Set())
    else setSelected(new Set(videos.map(v => v.id)))
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0) return
    setProcessing(true); setMsg('')
    try {
      const res = await batchDeleteVideos([...selected])
      setMsg(`已删除 ${res.data?.deleted || selected.size} 个视频`)
      setSelected(new Set())
      load()
    } catch (e: any) { setMsg(e.message || '删除失败') }
    finally { setProcessing(false) }
  }

  const handleConcat = async () => {
    if (selected.size < 2) return
    setProcessing(true); setMsg('')
    try {
      const res = await concatVideos([...selected])
      setMsg(`拼接完成！`)
      setSelected(new Set())
      load()
    } catch (e: any) { setMsg(e.message || '拼接失败') }
    finally { setProcessing(false) }
  }

  const handleDownload = () => {
    selected.forEach(id => {
      const v = videos.find(x => x.id === id)
      if (v) {
        const a = document.createElement('a')
        a.href = v.videoUrl; a.download = v.title + '.mp4'; a.click()
      }
    })
  }

  if (loading) return <div className="text-xs text-muted-foreground">加载中...</div>
  if (videos.length === 0) return <div className="text-xs text-muted-foreground">暂无视频记录</div>

  return (
    <div>
      {/* Bulk action bar */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <button onClick={toggleAll} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          {selected.size === videos.length ? <CheckSquare size={13} /> : <Square size={13} />}
          全选 ({selected.size}/{videos.length})
        </button>
        <div className="flex-1" />
        {selected.size > 0 && (
          <div className="flex items-center gap-1.5">
            <button onClick={handleDownload} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 transition-colors" title="下载选中">
              <Download size={11} />下载
            </button>
            {selected.size >= 2 && (
              <button onClick={handleConcat} disabled={processing} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 transition-colors" title="拼接选中视频">
                {processing ? <Loader2 size={11} className="animate-spin" /> : <Combine size={11} />}
                拼接
              </button>
            )}
            <button onClick={handleBatchDelete} disabled={processing} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors" title="删除选中">
              <Trash2 size={11} />删除{selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        )}
      </div>
      {msg && (
        <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded bg-white/5 text-xs">
          <span>{msg}</span>
          <button onClick={() => setMsg('')}><X size={11} className="text-muted-foreground" /></button>
        </div>
      )}
      {/* Video grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {videos.map(v => (
          <div key={v.id} className="border border-border rounded-lg p-3 flex items-center gap-3 group hover:border-primary/40 hover:bg-muted/30 transition-all">
            <button onClick={(e) => { e.stopPropagation(); toggle(v.id) }} className="flex-shrink-0">
              {selected.has(v.id) ? <CheckSquare size={15} className="text-violet-400" /> : <Square size={15} className="text-muted-foreground/50 group-hover:text-muted-foreground" />}
            </button>
            <div className="cursor-pointer flex items-center gap-3 flex-1 min-w-0" onClick={() => window.open(v.videoUrl, '_blank')}>
              <VideoThumbnail url={v.videoUrl} title={v.title} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{v.title || v.prompt?.slice(0, 30) || '未命名视频'}</p>
                <p className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)} · {v.duration}s</p>
              </div>
            </div>
            <button onClick={async e => { e.stopPropagation(); await deleteVideo(v.id); load() }} className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 p-1" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
