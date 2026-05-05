import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deployPortal } from '@/lib/api'
import {
  ArrowLeft, Globe, Sparkles, ExternalLink, Copy, Loader2,
  LayoutDashboard, CheckCircle2, Palette
} from 'lucide-react'

const TEMPLATES = [
  {
    id: 'business-blue',
    name: '商务蓝',
    desc: '简洁专业，适合金融、咨询、企业用户',
    primary: '#2563eb',
    secondary: '#1e40af',
    bg: '#ffffff',
    preview: 'linear-gradient(135deg, #2563eb, #1e40af)',
  },
  {
    id: 'tech-black',
    name: '科技黑',
    desc: '深色炫酷，适合科技、互联网、创业公司',
    primary: '#0f172a',
    secondary: '#38bdf8',
    bg: '#0f172a',
    preview: 'linear-gradient(135deg, #0f172a, #1e293b)',
  },
  {
    id: 'simple-white',
    name: '简约白',
    desc: '极简留白，适合个人博客、独立分析师',
    primary: '#1a1a2e',
    secondary: '#f59e0b',
    bg: '#ffffff',
    preview: '#ffffff',
  },
]

interface DeployResult {
  slug: string
  title: string
  url: string
}

export function PortalCreatePage() {
  const navigate = useNavigate()

  const [siteName, setSiteName] = useState('')
  const [siteDesc, setSiteDesc] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('business-blue')
  const [isDeploying, setIsDeploying] = useState(false)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleDeploy = async () => {
    const name = siteName.trim()
    if (!name) return

    setIsDeploying(true)
    setError(null)
    setResult(null)

    try {
      const res = await deployPortal(name, siteDesc.trim(), selectedTemplate)
      if (res.data) {
        setResult({
          slug: res.data.slug,
          title: res.data.title,
          url: res.data.url,
        })
      } else {
        setError(res.error?.message || '部署失败')
      }
    } catch (e: any) {
      setError(e.message || '部署失败，请稍后重试')
    } finally {
      setIsDeploying(false)
    }
  }

  const handleCopy = async () => {
    if (!result) return
    try {
      const fullUrl = window.location.origin + result.url
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const input = document.createElement('input')
      input.value = window.location.origin + result.url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
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
            onClick={() => navigate('/sites')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            返回列表
          </button>
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutDashboard size={14} />
            回到首页
          </button>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Globe size={22} className="text-primary" />
            部署分析门户网站
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            创建一个人人都可以使用的行业分析门户，部署到公开链接。
            访客输入公司名即可自动生成分析报告。
          </p>
        </div>

        {!result ? (
          <div className="space-y-5">
            {/* Template Selection */}
            <div className="border border-border rounded-xl p-6 bg-card">
              <label className="flex items-center gap-2 text-sm font-medium mb-3">
                <Palette size={16} className="text-primary" />
                选择网站风格
              </label>
              <div className="grid grid-cols-3 gap-3">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplate(t.id)}
                    className={`overflow-hidden rounded-xl border-2 text-left transition-all
                      ${selectedTemplate === t.id
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border hover:border-primary/40'}`}
                  >
                    {/* Preview bar */}
                    <div
                      className="h-16 flex items-end p-3"
                      style={{ background: t.preview }}
                    >
                      <div className="flex gap-1">
                        <div className="w-5 h-1.5 rounded-full bg-white/30" />
                        <div className="w-3 h-1.5 rounded-full bg-white/20" />
                      </div>
                    </div>
                    {/* Info */}
                    <div className="p-3 bg-card">
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                        {t.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Site info */}
            <div className="border border-border rounded-xl p-6 bg-card space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  网站名称 <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="例如：张三的行业分析站"
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  网站描述 <span className="text-muted-foreground text-xs">（选填）</span>
                </label>
                <input
                  type="text"
                  value={siteDesc}
                  onChange={(e) => setSiteDesc(e.target.value)}
                  placeholder="例如：专业的行业深度分析报告"
                  className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>

              {/* Deploy button */}
              <button
                onClick={handleDeploy}
                disabled={isDeploying || !siteName.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeploying ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    正在部署门户网站...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    一键部署
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
                <CheckCircle2 size={20} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-sm font-medium text-green-600 dark:text-green-400">门户部署成功!</h2>
                <p className="text-xs text-muted-foreground">{result.title}</p>
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4 mb-4">
              <p className="text-xs text-muted-foreground mb-2">访问链接</p>
              <div className="flex items-center gap-2">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary hover:bg-primary/5 hover:border-primary/40 transition-all flex items-center gap-1.5"
                >
                  <ExternalLink size={13} className="flex-shrink-0" />
                  <span className="truncate">{window.location.origin}{result.url}</span>
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
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <ExternalLink size={16} />
                查看门户
              </a>
              <button
                onClick={() => {
                  setResult(null)
                  setSiteName('')
                  setSiteDesc('')
                  setCopied(false)
                }}
                className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                再部署一个
              </button>
            </div>
          </div>
        )}

        {/* Tips */}
        {!result && !isDeploying && (
          <div className="mt-8">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">部署后</h3>
            <div className="grid gap-3 text-sm">
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-violet-600 text-xs font-medium flex-shrink-0">1</div>
                <div>
                  <p className="font-medium">访客无需登录</p>
                  <p className="text-muted-foreground mt-0.5">任何人都可以访问你的门户，输入公司名即可生成报告</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-violet-600 text-xs font-medium flex-shrink-0">2</div>
                <div>
                  <p className="font-medium">可分享链接</p>
                  <p className="text-muted-foreground mt-0.5">门户部署在 yooclaw.yookeer.com 的子目录下，可分享给任何人</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-violet-600 text-xs font-medium flex-shrink-0">3</div>
                <div>
                  <p className="font-medium">多种风格可选</p>
                  <p className="text-muted-foreground mt-0.5">商务蓝、科技黑、简约白三种模板，一键切换</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
