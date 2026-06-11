import { useEffect, useState, useRef } from 'react'
import { Play, Trash2, Film, Download, Combine, CheckSquare, Square, X, Loader2, GripVertical, Upload } from 'lucide-react'
import type { VideoData } from '@/lib/types'
import { getUserVideos, deleteVideo, batchDeleteVideos, concatVideos, uploadVideo } from '@/lib/api'

function formatDate(raw: string | number | undefined): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return String(raw)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function VideoThumbnail({ url, small }: { url: string; small?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasFrame, setHasFrame] = useState(false)
  const s = small ? 'w-14 h-10' : 'w-20 h-12'
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.addEventListener('loadeddata', () => setHasFrame(true))
    v.currentTime = 0.1
    return () => v.removeEventListener('loadeddata', () => {})
  }, [url])
  return (
    <div className={`${s} rounded overflow-hidden bg-black/60 relative flex-shrink-0`}>
      <video ref={videoRef} src={url} className="w-full h-full object-cover" preload="metadata" muted playsInline onLoadedData={() => setHasFrame(true)} />
      {!hasFrame && <div className="absolute inset-0 flex items-center justify-center"><Film size={small ? 10 : 14} className="text-muted-foreground/60" /></div>}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/40"><Play size={small ? 10 : 14} className="text-white" /></div>
    </div>
  )
}

// --- Concat Ordering Modal ---
function ConcatModal({ videos, orderedIds, onConfirm, onClose }: {
  videos: VideoData[]
  orderedIds: string[]
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const [items, setItems] = useState(orderedIds)
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)

  const handleDragStart = (index: number) => { dragItem.current = index }
  const handleDragEnter = (index: number) => { dragOverItem.current = index }
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    const arr = [...items]
    const [moved] = arr.splice(dragItem.current, 1)
    arr.splice(dragOverItem.current, 0, moved)
    setItems(arr)
    dragItem.current = null
    dragOverItem.current = null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold">调整拼接顺序</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors"><X size={16} /></button>
        </div>
        <div className="px-5 py-3 text-[10px] text-muted-foreground border-b border-white/5">
          拖拽视频块调整顺序 · 最上面为第 1 段 · 下方为后续段落
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {items.map((id, i) => {
            const v = videos.find(x => x.id === id)
            if (!v) return null
            return (
              <div key={id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragEnd={handleDragEnd}
                onDragOver={e => e.preventDefault()}
                className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] cursor-grab active:cursor-grabbing transition-colors group"
              >
                <GripVertical size={14} className="text-white/20 group-hover:text-white/40 flex-shrink-0" />
                <span className="text-xs font-bold text-violet-400 w-5 flex-shrink-0">{i + 1}</span>
                <VideoThumbnail url={v.videoUrl} small />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{v.title || '未命名'}</p>
                  <p className="text-[10px] text-muted-foreground">{v.duration}s · {formatDate(v.createdAt)}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t border-white/5 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded-xl bg-white/5 hover:bg-white/10 transition-colors">取消</button>
          <button onClick={() => { onConfirm(items); onClose() }} className="px-4 py-2 text-xs rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 transition-colors font-medium">
            确认拼接
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Main export ---
export function VideoHistory({ onSelectVideo }: { onSelectVideo?: (video: VideoData) => void }) {
  const [videos, setVideos] = useState<VideoData[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [processing, setProcessing] = useState(false)
  const [msg, setMsg] = useState('')
  const [showConcat, setShowConcat] = useState(false)

  const load = () => {
    setLoading(true)
    getUserVideos().then(res => { setVideos(res.data?.items || []); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const isSelected = (id: string) => selected.includes(id)
  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleAll = () => {
    if (selected.length === videos.length) setSelected([])
    else setSelected(videos.map(v => v.id))
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setProcessing(true); setMsg('')
    try {
      const fd = new FormData()
      for (let i = 0; i < Math.min(files.length, 6); i++) {
        fd.append('videos', files[i])
      }
      await uploadVideo(fd)
      setMsg(`已上传 ${Math.min(files.length, 6)} 个视频`)
      load()
    } catch (e: any) { setMsg(e.message || '上传失败') }
    finally { setProcessing(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleBatchDelete = async () => {
    if (selected.length === 0) return
    setProcessing(true); setMsg('')
    try {
      const res = await batchDeleteVideos(selected)
      setMsg(`已删除 ${res.data?.deleted || selected.length} 个视频`)
      setSelected([])
      load()
    } catch (e: any) { setMsg(e.message || '删除失败') }
    finally { setProcessing(false) }
  }

  const handleConcatConfirm = async (orderedIds: string[]) => {
    setProcessing(true); setMsg('')
    try {
      const res = await concatVideos(orderedIds)
      setMsg(`拼接完成！`)
      setSelected([])
      load()
    } catch (e: any) { setMsg(e.message || '拼接失败') }
    finally { setProcessing(false) }
  }

  const handleDownload = () => {
    selected.forEach((id, i) => {
      const v = videos.find(x => x.id === id)
      if (v) setTimeout(() => {
        const a = document.createElement('a')
        a.href = v.videoUrl; a.download = (i + 1) + '-' + (v.title || 'video') + '.mp4'; a.click()
      }, i * 200)
    })
  }

  if (loading) return <div className="text-xs text-muted-foreground">加载中...</div>
  if (videos.length === 0) return <div className="text-xs text-muted-foreground">暂无视频记录</div>

  return (
    <div>
      {showConcat && (
        <ConcatModal
          videos={videos}
          orderedIds={selected}
          onConfirm={handleConcatConfirm}
          onClose={() => setShowConcat(false)}
        />
      )}

      {/* Action bar */}
      <div className="mb-3 space-y-2 px-1">
        {/* Row 1: selection */}
        <div className="flex items-center gap-3">
          <button onClick={toggleAll} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            {selected.length === videos.length ? <CheckSquare size={15} /> : <Square size={15} />}
            全选 ({selected.length}/{videos.length})
          </button>
          {selected.length > 0 && (
            <span className="text-xs text-violet-400/70">已选 {selected.length} 个</span>
          )}
        </div>
        {/* Row 2: action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-foreground/80 hover:text-foreground transition-all">
            <Upload size={14} />上传视频
          </button>
          <input ref={fileInputRef} type="file" accept="video/*" multiple className="hidden" onChange={handleUpload} />
          {selected.length > 0 && (
            <>
              <button onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-foreground/80 hover:text-foreground transition-all">
                <Download size={14} />下载选中
              </button>
              {selected.length >= 2 && (
                <button onClick={() => setShowConcat(true)} disabled={processing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-500/20 bg-violet-500/[0.06] hover:bg-violet-500/[0.12] text-violet-400 transition-all">
                  {processing ? <Loader2 size={14} className="animate-spin" /> : <Combine size={14} />}
                  拼接 ({selected.length})
                </button>
              )}
              <button onClick={handleBatchDelete} disabled={processing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/20 bg-red-500/[0.06] hover:bg-red-500/[0.12] text-red-400 transition-all">
                <Trash2 size={14} />删除 ({selected.length})
              </button>
            </>
          )}
        </div>
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
          <div key={v.id} className={`border rounded-lg p-3 flex items-center gap-3 group transition-all ${
              isSelected(v.id) ? 'border-violet-500/40 bg-violet-500/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'
            }`}>
            <button onClick={(e) => { e.stopPropagation(); toggle(v.id) }} className="flex-shrink-0">
              {isSelected(v.id) ? (
                <CheckSquare size={15} className="text-violet-400" />
              ) : (
                <Square size={15} className="text-muted-foreground/50 group-hover:text-muted-foreground" />
              )}
            </button>
            <div className="cursor-pointer flex items-center gap-3 flex-1 min-w-0" onClick={() => onSelectVideo?.(v)}>
              <VideoThumbnail url={v.videoUrl} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{v.title || v.prompt?.slice(0, 30) || '未命名视频'}</p>
                <p className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)} · {v.duration}s</p>
              </div>
            </div>
            <button onClick={async e => { e.stopPropagation(); await deleteVideo(v.id); load() }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 p-1" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
