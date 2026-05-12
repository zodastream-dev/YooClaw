import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo } from '@/lib/api'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, Play, Download } from 'lucide-react'

interface GeneratedVideo {
  id: string
  title: string
  url: string
  status?: string
  message?: string
}

export function VideoCreatePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')

  // Generate state
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedVideo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async () => {
    const p = prompt.trim()
    if (!p) return

    setIsGenerating(true)
    setError(null)
    setResult(null)

    try {
      const res = await generateVideo({ prompt: p, duration, resolution, ratio })
      if (res.data) {
        setResult({
          id: res.data.id,
          title: res.data.title || p.slice(0, 30) + ' 视频',
          url: res.data.url,
          status: res.data.status,
          message: res.data.message,
        })
      } else {
        setError(res.error?.message || '视频生成失败')
      }
    } catch (e: any) {
      setError(e.message || '生成失败，请稍后重试')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async () => {
    if (!result?.url) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        {/* Top nav */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />返回首页
          </button>
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <LayoutDashboard size={14} />回到对话
          </button>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Clapperboard size={22} className="text-primary" />AI 视频创作
          </h1>
          <p className="text-sm text-muted-foreground mt-1">管理员账号无感登录 · 使用即梦 Seedance 2.0 模型，文字描述直接生成精美视频</p>
        </div>

        {!result ? (
          <div className="space-y-5">
            {/* Video Form — admin token auto-login, no OAuth */}
            <div className="border border-border rounded-xl p-6 bg-card space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">视频描述 <span className="text-destructive">*</span></label>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="描述你想要生成的视频内容，例如：一只柯基犬在樱花树下奔跑，阳光透过花瓣洒落，慢动作特写" className="w-full min-h-[100px] px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-vertical" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">时长</label>
                  <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm outline-none">
                    <option value="4">4 秒</option><option value="5">5 秒</option><option value="8">8 秒</option><option value="10">10 秒</option><option value="15">15 秒</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">分辨率</label>
                  <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm outline-none">
                    <option value="720p">720p</option><option value="1080p">1080p</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">比例</label>
                  <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm outline-none">
                    <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option>
                  </select>
                </div>
              </div>

              <button onClick={handleSubmit} disabled={isGenerating || !prompt.trim()} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                {isGenerating ? <><Loader2 size={16} className="animate-spin" />正在生成视频...</> : <><Sparkles size={16} />开始生成</>}
              </button>
            </div>

            {error && <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">{error}</div>}
          </div>
        ) : (
          /* Result */
          <div className="border border-border rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${result.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
                {result.status === 'processing' ? <Loader2 size={20} className="text-yellow-600 animate-spin" /> : <Play size={20} className="text-green-600" />}
              </div>
              <div>
                <h2 className={`text-sm font-medium ${result.status === 'processing' ? 'text-yellow-600' : 'text-green-600'}`}>
                  {result.status === 'processing' ? '视频生成中...' : '视频生成成功!'}
                </h2>
                <p className="text-xs text-muted-foreground">{result.title}</p>
              </div>
            </div>

            {result.status === 'processing' ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">{result.message || '视频正在即梦后台生成中，请稍后到即梦网站查看'}</p>
              </div>
            ) : (
              result.url && <>
                <div className="bg-muted rounded-lg p-4 mb-4">
                  <video src={result.url} controls className="w-full rounded-lg" style={{ maxHeight: '360px' }}>您的浏览器不支持视频播放</video>
                </div>
                <div className="bg-muted rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2">
                    <a href={result.url} target="_blank" rel="noopener" className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary flex items-center gap-1.5">
                      <ExternalLink size={13} />{result.url}
                    </a>
                    <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium">{copied ? '已复制' : <Copy size={14} />}</button>
                  </div>
                </div>
                <div className="flex gap-3">
                  <a href={result.url} target="_blank" rel="noopener" download className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium">
                    <Download size={16} />下载视频
                  </a>
                  <button onClick={() => { setResult(null); setCopied(false) }} className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium">再生成一个</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
