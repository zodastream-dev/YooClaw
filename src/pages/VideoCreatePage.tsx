import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo, videoLogin, videoLoginStatus, videoStatus } from '@/lib/api'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, LogIn, Play, Download, CheckCircle, RefreshCw, X } from 'lucide-react'
import { videoTemplates, templateCategories, getTemplatesByCategory } from '@/data/videoTemplates'
import type { VideoTemplate } from '@/data/videoTemplates'

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
  
  // Login state
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [verificationUri, setVerificationUri] = useState('')
  const [userCode, setUserCode] = useState('')
  const [deviceCode, setDeviceCode] = useState('')
  const [loginPolling, setLoginPolling] = useState(false)
  const [credit, setCredit] = useState('')

  // Template state
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedTemplate, setSelectedTemplate] = useState<VideoTemplate | null>(null)

  // Generate state
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedVideo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Check login status on mount
  useEffect(() => {
    checkLoginStatus()
  }, [])

  const checkLoginStatus = async () => {
    try {
      const res = await videoStatus()
      if (res.data?.loggedIn) {
        setIsLoggedIn(true)
        setCredit(res.data.credit || '')
      }
    } catch {}
  }

  // Start OAuth login flow
  const handleLogin = async () => {
    setIsLoggingIn(true)
    setError(null)
    try {
      const res = await videoLogin()
      if (res.data) {
        setVerificationUri(res.data.verificationUri)
        setUserCode(res.data.userCode)
        setDeviceCode(res.data.deviceCode)
        // Auto-open the verification URL in a new window
        window.open(res.data.verificationUri, '_blank', 'width=600,height=700')
        startPollingLogin(res.data.deviceCode)
      } else {
        setError('登录初始化失败')
      }
    } catch (e: any) {
      setError(e.message || '登录初始化失败')
    } finally {
      setIsLoggingIn(false)
    }
  }

  // Poll login status
  const startPollingLogin = useCallback(async (code: string) => {
    setLoginPolling(true)
    const poll = async () => {
      try {
        const res = await videoLoginStatus(code)
        if (res.data?.status === 'success') {
          setIsLoggedIn(true)
          setLoginPolling(false)
          setVerificationUri('')
          setUserCode('')
          // Get credit info
          const st = await videoStatus()
          if (st.data?.credit) setCredit(st.data.credit)
          return
        }
      } catch {}
      // Continue polling
      setTimeout(() => poll(), 3000)
    }
    poll()
  }, [])

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

  // Template helpers
  const filteredTemplates = getTemplatesByCategory(activeCategory)

  const handleSelectTemplate = (template: VideoTemplate) => {
    setSelectedTemplate(template)
    setPrompt(template.prompt)
    setDuration(template.duration)
    setRatio(template.ratio)
    const formEl = document.getElementById('video-form')
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleClearTemplate = () => {
    setSelectedTemplate(null)
    setPrompt('')
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
          <p className="text-sm text-muted-foreground mt-1">使用即梦 Seedance 2.0 模型，文字描述直接生成精美视频</p>
        </div>

        {!result ? (
          <div className="space-y-5">
            {/* Login Card */}
            <div className="border border-border rounded-xl p-6 bg-card">
              {isLoggedIn ? (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle size={20} className="text-green-600" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-green-600">已登录即梦账号</div>
                    {credit && <div className="text-xs text-muted-foreground">{credit}</div>}
                  </div>
                  <button onClick={() => { setIsLoggedIn(false); handleLogin() }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <RefreshCw size={12} />重新登录
                  </button>
                </div>
              ) : loginPolling ? (
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-sm text-primary">
                    <Loader2 size={16} className="animate-spin" />等待授权中...
                  </div>
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-2 text-left">
                    <p className="text-sm font-medium">请在浏览器中完成授权：</p>
                    <div className="flex items-center gap-2">
                      <a href={verificationUri} target="_blank" rel="noopener" className="text-primary text-xs underline truncate flex-1">
                        {verificationUri}
                      </a>
                      <button onClick={() => { navigator.clipboard.writeText(verificationUri); alert('链接已复制') }} className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded">复制</button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      打开链接后输入验证码：<strong className="text-foreground text-lg tracking-widest select-all">{userCode}</strong>
                    </p>
                    <button onClick={() => { navigator.clipboard.writeText(userCode); alert('验证码已复制') }} className="text-xs text-primary underline">复制验证码</button>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <p className="text-sm text-muted-foreground">使用即梦账号授权登录，无需手动配置 Cookie</p>
                  <button onClick={handleLogin} disabled={isLoggingIn} className="flex items-center justify-center gap-2 mx-auto px-6 py-3 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
                    {isLoggingIn ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                    登录即梦
                  </button>
                </div>
              )}
            </div>

            {/* Template Library */}
            {isLoggedIn && (
              <div className="border border-border rounded-xl p-5 bg-card space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Sparkles size={15} className="text-primary" />视频模板库
                  </h3>
                  {selectedTemplate && (
                    <button onClick={handleClearTemplate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors">
                      <X size={13} />清空模板
                    </button>
                  )}
                </div>

                {/* Category Tabs */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                  {templateCategories.map(cat => (
                    <button
                      key={cat.key}
                      onClick={() => setActiveCategory(cat.key)}
                      className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs transition-all flex-shrink-0 ${
                        activeCategory === cat.key
                          ? 'bg-primary text-primary-foreground font-medium'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {cat.icon} {cat.label}
                    </button>
                  ))}
                </div>

                {/* Template Cards */}
                <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-0.5 scrollbar-thin">
                  {filteredTemplates.map(tpl => (
                    <button
                      key={tpl.id}
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        selectedTemplate?.id === tpl.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                          : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg flex-shrink-0">{tpl.icon}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium truncate">{tpl.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tpl.duration}s</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tpl.ratio}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Video Form (only when logged in) */}
            {isLoggedIn && (
              <div id="video-form" className="border border-border rounded-xl p-6 bg-card space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">视频描述 <span className="text-destructive">*</span></label>
                  <textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); if (selectedTemplate && e.target.value !== selectedTemplate.prompt) setSelectedTemplate(null) }} placeholder="描述你想要生成的视频内容，例如：一只柯基犬在樱花树下奔跑，阳光透过花瓣洒落，慢动作特写" className="w-full min-h-[100px] px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-vertical" />
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
            )}

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
