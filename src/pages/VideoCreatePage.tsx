import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo } from '@/lib/api'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, Key, Play, Download, Info } from 'lucide-react'

interface GeneratedVideo {
  id: string
  title: string
  url: string
  status?: string
  message?: string
  thumbnail?: string
}

export function VideoCreatePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [jimengCookie, setJimengCookie] = useState('')
  const [jimengUid, setJimengUid] = useState('')
  const [showApiConfig, setShowApiConfig] = useState(true)
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
        jimengCookie: jimengCookie.trim(),
        jimengUid: jimengUid.trim(),
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

              {/* Cookie Configuration */}
              <div className="border-t border-border pt-4">
                <button
                  onClick={() => setShowApiConfig(!showApiConfig)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Key size={14} />
                  即梦账号配置（Cookie 认证）
                  <span className="text-xs">{showApiConfig ? '收起' : '展开'}</span>
                </button>
                {showApiConfig && (
                  <div className="mt-3 space-y-3">
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-blue-700 dark:text-blue-300">
                          <p className="font-medium mb-1">如何获取 Cookie？</p>
                          <ol className="list-decimal list-inside space-y-0.5">
                            <li>用浏览器打开 <a href="https://jimeng.jianying.com/ai-tool/video/generate" target="_blank" rel="noopener" className="underline">即梦视频生成页</a> 并登录</li>
                            <li>按 <kbd className="px-1 bg-blue-100 dark:bg-blue-800 rounded">F12</kbd> 打开开发者工具</li>
                            <li>切换到 <strong>Application</strong>（应用程序）→ <strong>Cookies</strong> → 选择 jimeng.jianying.com</li>
                            <li>复制所有 Cookie 值（或右键任一 Cookie → 复制全部）</li>
                          </ol>
                        </div>
                      </div>
                    </div>
                    <textarea
                      value={jimengCookie}
                      onChange={(e) => setJimengCookie(e.target.value)}
                      placeholder="粘贴即梦网站的完整 Cookie（例如：sessionid=xxx; passport_csrf_token=xxx; ...）"
                      className="w-full min-h-[80px] px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-vertical font-mono"
                    />
                    <input
                      type="text"
                      value={jimengUid}
                      onChange={(e) => setJimengUid(e.target.value)}
                      placeholder="用户 UID（选填，可在 Cookie 的 passport_uid 中找到）"
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all font-mono"
                    />
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
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${result.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
                {result.status === 'processing' ? <Loader2 size={20} className="text-yellow-600 animate-spin" /> : <Play size={20} className="text-green-600 dark:text-green-400" />}
              </div>
              <div>
                <h2 className={`text-sm font-medium ${result.status === 'processing' ? 'text-yellow-600' : 'text-green-600 dark:text-green-400'}`}>
                  {result.status === 'processing' ? '视频生成中...' : '视频生成成功!'}
                </h2>
                <p className="text-xs text-muted-foreground">{result.title}</p>
              </div>
            </div>

            {result.status === 'processing' ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-yellow-700 dark:text-yellow-300">{result.message || '视频正在生成中，请稍后到即梦网站查看结果'}</p>
              </div>
            ) : (
              <>
                <div className="bg-muted rounded-lg p-4 mb-4">
                  <video src={result.url} controls className="w-full rounded-lg" poster={result.thumbnail} style={{ maxHeight: '360px' }}>
                    您的浏览器不支持视频播放
                  </video>
                </div>
                <div className="bg-muted rounded-lg p-4 mb-4">
                  <p className="text-xs text-muted-foreground mb-2">视频链接</p>
                  <div className="flex items-center gap-2">
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary hover:bg-primary/5 hover:border-primary/40 transition-all flex items-center gap-1.5">
                      <ExternalLink size={13} className="flex-shrink-0" />
                      <span className="truncate">{result.url}</span>
                    </a>
                    <button onClick={handleCopy} className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity">
                      {copied ? '已复制' : <Copy size={14} />}
                    </button>
                  </div>
                </div>
                <div className="flex gap-3">
                  <a href={result.url} target="_blank" rel="noopener noreferrer" download className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
                    <Download size={16} />下载视频
                  </a>
                  <button onClick={() => { setResult(null); setCopied(false) }} className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                    再生成一个
                  </button>
                </div>
              </>
            )}
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
