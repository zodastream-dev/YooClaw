import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, QrCode, Plus, Trash2, Loader2, RefreshCw, ExternalLink, BookOpen, Clock, AlertCircle, Check, X, UserPlus, Rss } from 'lucide-react'

// Types
interface MpSubscription {
  mpId: string
  mpName: string
  mpCover: string
  subscribedAt: string
}

interface MpArticle {
  id: string
  title: string
  url: string
  summary: string
  publishTime: string
  author: string
  mpId?: string
}

interface SubscriptionsResponse {
  data: {
    items: MpSubscription[]
    count: number
    limit: number
  }
}

interface ArticlesResponse {
  data: {
    articles: MpArticle[]
    total: number
    page?: number
  }
}

// API helpers
const API_BASE = window.location.origin
const TOKEN_KEY = 'codebuddy_token'

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${getToken()}`,
    'X-CodeBuddy-Request': '1',
  }
  if (body) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json?.error?.message || `HTTP ${res.status}`)
  }
  return json
}

// API functions
async function qrLogin(): Promise<{ uuid: string; scanUrl: string }> {
  const res = await apiRequest<{ success: boolean; data: { uuid: string; scanUrl: string } }>('POST', '/api/mp/qr-login')
  return res.data
}

async function checkLogin(uuid: string): Promise<{ status: string; vid?: string; token?: string; username?: string; message?: string }> {
  const res = await apiRequest<{ success: boolean; data: any }>('GET', `/api/mp/check-login/${uuid}`)
  return res.data
}

async function subscribeMp(wxsLink: string): Promise<{ mpId: string; mpName: string; mpCover: string }> {
  const res = await apiRequest<{ success: boolean; data: any }>('POST', '/api/mp/subscribe', { wxsLink })
  return res.data
}

async function unsubscribeMp(mpId: string): Promise<void> {
  await apiRequest<{ success: boolean }>('DELETE', `/api/mp/subscribe/${mpId}`)
}

async function getSubscriptions(): Promise<SubscriptionsResponse['data']> {
  const res = await apiRequest<SubscriptionsResponse>('GET', '/api/mp/subscriptions')
  return res.data
}

async function refreshArticles(mpId?: string) {
  await apiRequest<{ status: string; total?: number; refreshed?: number }>('POST', '/api/mp/refresh', mpId ? { mpId } : {})
}

async function getArticles(mpId?: string, page = 1): Promise<ArticlesResponse['data']> {
  const path = mpId ? `/api/mp/articles/${mpId}?page=${page}` : `/api/mp/articles`
  const res = await apiRequest<ArticlesResponse>('GET', path)
  return res.data
}

// Components
function LoginSection({ onLogin }: { onLogin: () => void }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'qr' | 'polling' | 'success' | 'error'>('idle')
  const [qrUrl, setQrUrl] = useState('')
  const [uuid, setUuid] = useState('')
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')

  const startLogin = async () => {
    setStep('loading')
    setError('')
    try {
      const data = await qrLogin()
      // Use a QR code API to render the scanUrl as an image
      setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.scanUrl)}`)
      setUuid(data.uuid)
      setStep('qr')
    } catch (e: any) {
      setError(e.message)
      setStep('error')
    }
  }

  const startPolling = useCallback(() => {
    if (!uuid) return
    setStep('polling')
    const poll = async () => {
      try {
        const result = await checkLogin(uuid)
        if (result.status === 'logged_in') {
          setUsername(result.username || 'WeRead User')
          setStep('success')
          onLogin()
          return
        }
        if (result.status === 'timeout') {
          setError('登录超时，请重新获取二维码')
          setStep('error')
          return
        }
        // Still waiting, poll again
        setTimeout(poll, 2000)
      } catch (e: any) {
        setError(e.message)
        setStep('error')
      }
    }
    setTimeout(poll, 1000)
  }, [uuid, onLogin])

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">正在生成二维码...</span>
      </div>
    )
  }

  if (step === 'success') {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <Check size={20} className="text-emerald-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">登录成功</p>
          <p className="text-xs text-muted-foreground">已绑定微信读书账号：{username}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-xl p-5 bg-card">
      <div className="flex items-center gap-2 mb-4">
        <UserPlus size={18} className="text-primary" />
        <h2 className="text-sm font-semibold">微信读书账号绑定</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        首次使用需要绑定一个微信读书账号，用于获取公众号文章数据
      </p>

      {step === 'qr' || step === 'polling' ? (
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <img
              src={qrUrl}
              alt="QR Code"
              className="w-48 h-48 rounded-xl border border-border bg-white"
            />
            {step === 'polling' && (
              <div className="absolute inset-0 bg-background/80 rounded-xl flex items-center justify-center">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={24} className="animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">等待扫码...</span>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            请使用微信读书 APP 扫描二维码授权登录
          </p>
          <div className="flex gap-2">
            <button
              onClick={startPolling}
              disabled={step === 'polling'}
              className="px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {step === 'polling' ? '等待扫码中...' : '已扫码，开始检测'}
            </button>
            <button
              onClick={() => { setStep('idle'); setQrUrl(''); setUuid(''); }}
              className="px-4 py-2 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
            >
              重新获取
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startLogin}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <QrCode size={16} />
          获取二维码登录
        </button>
      )}

      {error && (
        <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </div>
  )
}

function SubscribeForm({ onSubscribed }: { onSubscribed: () => void }) {
  const [link, setLink] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!link.trim()) {
      setError('请输入公众号文章链接')
      return
    }
    if (!link.startsWith('https://mp.weixin.qq.com/s/')) {
      setError('请输入有效的公众号文章链接（以 https://mp.weixin.qq.com/s/ 开头）')
      return
    }

    setLoading(true)
    try {
      const data = await subscribeMp(link.trim())
      setSuccess(`已成功订阅「${data.mpName}」`)
      setLink('')
      onSubscribed()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-border rounded-xl p-5 bg-card">
      <div className="flex items-center gap-2 mb-4">
        <Plus size={18} className="text-primary" />
        <h2 className="text-sm font-semibold">订阅新公众号</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        粘贴一篇公众号文章的链接，系统将自动识别并订阅该公众号（最多 10 个）
      </p>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://mp.weixin.qq.com/s/..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !link.trim()}
          className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          订阅
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
          <Check size={14} />
          {success}
        </div>
      )}
    </div>
  )
}

function SubscriptionList({
  subscriptions,
  onUnsubscribe,
  onSelect,
  selectedMpId,
  loading,
}: {
  subscriptions: MpSubscription[]
  onUnsubscribe: (mpId: string) => void
  onSelect: (mpId: string | null) => void
  selectedMpId: string | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">加载订阅列表...</span>
      </div>
    )
  }

  if (subscriptions.length === 0) {
    return (
      <div className="text-center py-8">
        <BookOpen size={32} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">还没有订阅任何公众号</p>
        <p className="text-xs text-muted-foreground/60 mt-1">粘贴文章链接开始订阅吧</p>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rss size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">我的订阅</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {subscriptions.length} / 10
        </span>
      </div>
      <div className="divide-y divide-border">
        {subscriptions.map((sub) => (
          <div
            key={sub.mpId}
            onClick={() => onSelect(selectedMpId === sub.mpId ? null : sub.mpId)}
            className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
              selectedMpId === sub.mpId
                ? 'bg-primary/5 border-l-2 border-l-primary'
                : 'hover:bg-muted/50 border-l-2 border-l-transparent'
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {sub.mpCover ? (
                <img src={sub.mpCover} alt={sub.mpName} className="w-full h-full object-cover" />
              ) : (
                <BookOpen size={18} className="text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{sub.mpName}</p>
              <p className="text-xs text-muted-foreground">
                订阅于 {new Date(sub.subscribedAt).toLocaleDateString('zh-CN')}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onUnsubscribe(sub.mpId)
              }}
              className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="取消订阅"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ArticleFeed({
  articles,
  loading,
  mpId,
}: {
  articles: MpArticle[]
  loading: boolean
  mpId: string | null
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">加载文章...</span>
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div className="text-center py-12">
        <Rss size={32} className="mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">暂无文章</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          {mpId ? '选定公众号暂未抓取到文章，等待定时刷新' : '请选择公众号或点击上方查看全部订阅源'}
        </p>
      </div>
    )
  }

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - d.getTime()
      const hours = Math.floor(diff / 3600000)
      if (hours < 1) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`
      if (hours < 24) return `${hours} 小时前`
      if (hours < 48) return '昨天'
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="space-y-2">
      {articles.map((article) => (
        <a
          key={article.id}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block border border-border rounded-xl p-4 bg-card hover:bg-muted/30 transition-colors group"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                {article.title}
              </h3>
              {article.summary && (
                <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{article.summary}</p>
              )}
              <div className="flex items-center gap-3 mt-2">
                {article.author && (
                  <span className="text-xs text-primary/70 font-medium">{article.author}</span>
                )}
                <span className="text-xs text-muted-foreground/60 flex items-center gap-1">
                  <Clock size={10} />
                  {formatDate(article.publishTime)}
                </span>
              </div>
            </div>
            <ExternalLink size={14} className="text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0 mt-1" />
          </div>
        </a>
      ))}
    </div>
  )
}

export function MpSubscriptionPage() {
  const navigate = useNavigate()
  const [subscriptions, setSubscriptions] = useState<MpSubscription[]>([])
  const [articles, setArticles] = useState<MpArticle[]>([])
  const [selectedMpId, setSelectedMpId] = useState<string | null>(null)
  const [loadingSubs, setLoadingSubs] = useState(true)
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [error, setError] = useState('')

  const loadSubscriptions = useCallback(async () => {
    setLoadingSubs(true)
    try {
      const data = await getSubscriptions()
      setSubscriptions(data.items)
      // Check if we have any accounts (proxy for login)
      setLoggedIn(data.items.length > 0)
    } catch (e: any) {
      console.error('Failed to load subscriptions:', e)
    } finally {
      setLoadingSubs(false)
    }
  }, [])

  const loadArticles = useCallback(async (mpId: string | null) => {
    setLoadingArticles(true)
    try {
      const data = await getArticles(mpId || undefined)
      setArticles(data.articles)
    } catch (e: any) {
      console.error('Failed to load articles:', e)
      setArticles([])
    } finally {
      setLoadingArticles(false)
    }
  }, [])

  useEffect(() => {
    loadSubscriptions()
  }, [loadSubscriptions])

  useEffect(() => {
    loadArticles(selectedMpId)
  }, [selectedMpId, loadArticles])

  const handleUnsubscribe = async (mpId: string) => {
    try {
      await unsubscribeMp(mpId)
      setSubscriptions((prev) => prev.filter((s) => s.mpId !== mpId))
      if (selectedMpId === mpId) {
        setSelectedMpId(null)
      }
    } catch (e: any) {
      setError(e.message)
      setTimeout(() => setError(''), 3000)
    }
  }

  const handleLogin = () => {
    setLoggedIn(true)
    loadSubscriptions()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        {/* Top navigation */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium">公众号订阅</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              Beta
            </span>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutDashboard size={14} />
            回到首页
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            <AlertCircle size={16} />
            {error}
            <button onClick={() => setError('')} className="ml-auto">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column: Login + Subscribe */}
          <div className="space-y-4">
            <LoginSection onLogin={handleLogin} />
            <SubscribeForm onSubscribed={loadSubscriptions} />
            <SubscriptionList
              subscriptions={subscriptions}
              onUnsubscribe={handleUnsubscribe}
              onSelect={setSelectedMpId}
              selectedMpId={selectedMpId}
              loading={loadingSubs}
            />
          </div>

          {/* Right column: Article Feed */}
          <div className="lg:col-span-2">
            <div className="border border-border rounded-xl bg-card">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Rss size={16} className="text-primary" />
                  <h2 className="text-sm font-semibold">
                    {selectedMpId
                      ? subscriptions.find((s) => s.mpId === selectedMpId)?.mpName || '文章列表'
                      : '全部文章'}
                  </h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={async () => {
                      try {
                        await refreshArticles(selectedMpId || undefined)
                        await loadArticles(selectedMpId)
                      } catch (e: any) {
                        setError(e.message)
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1.5"
                    title="强制刷新（从微信读书获取最新文章）"
                  >
                    <RefreshCw size={12} className={loadingArticles ? 'animate-spin' : ''} />
                    同步文章
                  </button>
                  <button
                    onClick={() => loadArticles(selectedMpId)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                    title="刷新列表"
                  >
                  <RefreshCw size={14} className={loadingArticles ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <div className="p-4">
                <ArticleFeed articles={articles} loading={loadingArticles} mpId={selectedMpId} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
