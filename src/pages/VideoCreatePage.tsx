import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo } from '@/lib/api'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, Key, Play, Download } from 'lucide-react'

interface GeneratedVideo {
  id: string
  title: string
  url: string
  thumbnail?: string
}

export function VideoCreatePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [showApiConfig, setShowApiConfig] = useState(false)
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
      const res = await generateVideo({
        prompt: p,
        duration,
        resolution,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
      })
      if (res.data) {
        setResult({
          id: res.data.id,
          title: res.data.title || p.slice(0, 30) + ' 视频',
          url: res.data.url,
          thumbnail: res.data.thumbnail,
        })
      } else {
        setError(res.error?.message || '视频生成失败')
      }
    } catch (e: any) {
      setError(e.message || '视频生成失败，请稍后重试')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      const fullUrl = result.url
      await navigator.clipboard.writeText(fullUrl)
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
        {/* Top navigation */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            返回首页
          </button>
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutDashboard size={14} />
            回到对话
          </button>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Clapperboard size={22} className="text-primary" />
            AI 视频创作
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            使用即梦 AI 模型，将文字描述转化为精美的视频内容。
            支持 720p/1080p 分辨率，最长 10 秒视频生成。
          </p>
        </div>

        {!result ? (
          <div className="space-y-5">
            {/* Video description */}
            <div className="border border-border rounded-xl p-6 bg-card space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  视频描述 <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想要生成的视频内容，例如：一只柯基犬在樱花树下奔跑，阳光透过花瓣洒落，慢动作特写，电影级画质"
                  className="w-full min-h-[120px] px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-vertical"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  提示：描述越详细，生成的视频越精准。可以指定场景、动作、光线、镜头运动等。
                </p>
              </div>

              {/* Duration & Resolution */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">视频时长</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  >
                    <option value="3">3 秒</option>
                    <option value="5">5 秒</option>
                    <option value="10">10 秒</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">分辨率</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  >
                    <option value="720p">720p (标清)</option>
                    <option value="1080p">1080p (全高清)</option>
                  </select>
                </div>
              </div>

              {/* API Configuration */}
              <div className="border-t border-border pt-4">
                <button
                  onClick={() => setShowApiConfig(!showApiConfig)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Key size={14} />
                  即梦 API 配置
                  <span className="text-xs">{showApiConfig ? '收起' : '展开'}</span>
                </button>
                {showApiConfig && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      请前往 <a href="https://console.volcengine.com/ark" target="_blank" rel="noopener" className="text-primary hover:underline">火山引擎控制台</a> 获取即梦 API 的 Access Key 和 Secret Key。
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <input
                        type="text"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Access Key ID"
                        className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                      />
                      <input
                        type="password"
                        value={apiSecret}
                        onChange={(e) => setApiSecret(e.target.value)}
                        placeholder="Secret Access Key"
                        className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Generate button */}
              <button
                onClick={handleSubmit}
                disabled={isGenerating || !prompt.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    正在生成视频...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    开始生成
                  </>
                )}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        ) : (
          /* Success */
          <div className="border border-border rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Play size={20} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-sm font-medium text-green-600 dark:text-green-400">视频生成成功!</h2>
                <p className="text-xs text-muted-foreground">{result.title}</p>
              </div>
            </div>

            {/* Video Preview */}
            <div className="bg-muted rounded-lg p-4 mb-4">
              <video
                src={result.url}
                controls
                className="w-full rounded-lg"
                poster={result.thumbnail}
                style={{ maxHeight: '360px' }}
              >
                您的浏览器不支持视频播放
              </video>
            </div>

            {/* URL */}
            <div className="bg-muted rounded-lg p-4 mb-4">
              <p className="text-xs text-muted-foreground mb-2">视频链接</p>
              <div className="flex items-center gap-2">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary hover:bg-primary/5 hover:border-primary/40 transition-all flex items-center gap-1.5"
                >
                  <ExternalLink size={13} className="flex-shrink-0" />
                  <span className="truncate">{result.url}</span>
                </a>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  {copied ? '已复制' : <Copy size={14} />}
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Download size={16} />
                下载视频
              </a>
              <button
                onClick={() => {
                  setResult(null)
                  setCopied(false)
                }}
                className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                再生成一个
              </button>
            </div>
          </div>
        )}

        {/* Tips */}
        {!result && !isGenerating && (
          <div className="mt-8">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">使用提示</h3>
            <div className="grid gap-3 text-sm">
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center text-orange-600 text-xs font-medium flex-shrink-0">1</div>
                <div>
                  <p className="font-medium">即梦 AI 视频生成</p>
                  <p className="text-muted-foreground mt-0.5">使用字节跳动 Seedance 模型，支持文生视频功能</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center text-orange-600 text-xs font-medium flex-shrink-0">2</div>
                <div>
                  <p className="font-medium">配置 API 密钥</p>
                  <p className="text-muted-foreground mt-0.5">在火山引擎控制台获取 Access Key 和 Secret Key，填入上方配置区域</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center text-orange-600 text-xs font-medium flex-shrink-0">3</div>
                <div>
                  <p className="font-medium">优化描述词</p>
                  <p className="text-muted-foreground mt-0.5">详细的场景描述、镜头语言和光影描述可以让 AI 生成更高质量的视频</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
