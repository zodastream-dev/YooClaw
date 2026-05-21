import { useEffect, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import type { VideoData } from '@/lib/types'
import { getUserVideos, deleteVideo } from '@/lib/api'

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
    <div className="grid grid-cols-2 gap-3">
      {videos.map(v => (
        <div key={v.id} className="border border-border rounded-lg p-3 flex items-center gap-3 group">
          <video
            src={v.videoUrl}
            className="w-20 h-12 object-cover rounded cursor-pointer hover:opacity-80"
            muted
            onClick={() => window.open(v.videoUrl, '_blank')}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{v.title || v.prompt?.slice(0, 30)}</p>
            <p className="text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
          </div>
          <button
            onClick={async () => {
              await deleteVideo(v.id)
              setVideos(vs => vs.filter(x => x.id !== v.id))
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
