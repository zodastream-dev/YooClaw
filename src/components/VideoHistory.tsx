import { useEffect, useState, useRef } from 'react'
import { Play, Trash2, Film } from 'lucide-react'
import type { VideoData } from '@/lib/types'
import { getUserVideos, deleteVideo } from '@/lib/api'

function formatDate(raw: string | number | undefined): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return String(raw)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
    // Force load first frame
    v.currentTime = 0.1
    return () => v.removeEventListener('loadeddata', onLoaded)
  }, [url])

  return (
    <div className="w-20 h-12 rounded overflow-hidden bg-black/60 relative flex-shrink-0">
      <video
        ref={videoRef}
        src={url}
        className="w-full h-full object-cover"
        preload="metadata"
        muted
        playsInline
        onLoadedData={() => setHasFrame(true)}
      />
      {!hasFrame && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Film size={14} className="text-muted-foreground/60" />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/40">
        <Play size={14} className="text-white" />
      </div>
    </div>
  )
}

export function VideoHistory() {
  const [videos, setVideos] = useState<VideoData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getUserVideos()
      .then(res => {
        setVideos(res.data?.items || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-xs text-muted-foreground">加载中...</div>
  if (videos.length === 0) return <div className="text-xs text-muted-foreground">暂无视频记录</div>

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {videos.map(v => (
        <div
          key={v.id}
          className="border border-border rounded-lg p-3 flex items-center gap-3 group cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-all"
          onClick={() => window.open(v.videoUrl, '_blank')}
        >
          <VideoThumbnail url={v.videoUrl} title={v.title} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{v.title || v.prompt?.slice(0, 30) || '未命名视频'}</p>
            <p className="text-[10px] text-muted-foreground">{formatDate(v.createdAt)}</p>
          </div>
          <button
            onClick={async e => {
              e.stopPropagation()
              await deleteVideo(v.id)
              setVideos(vs => vs.filter(x => x.id !== v.id))
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 p-1"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
