import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createReportSite } from '@/lib/api'
import { ArrowLeft, Globe, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard } from 'lucide-react'

interface GeneratedSite {
  slug: string
  title: string
  url: string
}

export function SiteCreatePage() {
  const navigate = useNavigate()
  const [companyName, setCompanyName] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedSite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async () => {
    const name = companyName.trim()
    if (!name) return

    setIsGenerating(true)
    setError(null)
    setResult(null)

    try {
      const res = await createReportSite(name)
      if (res.data) {
        setResult({
          slug: res.data.slug,
          title: res.data.title,
          url: res.data.url,
        })
      } else {
        setError(res.error?.message || '生成失败')
      }
    } catch (e: any) {
      setError(e.message || '生成失败，请稍后重试')
    } finally {
      setIsGenerating(false)
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
        {/* Top navigation bar */}
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
            创建报告网站
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            输入公司名或行业关键词，AI 将自动生成一份专业的行业分析报告页面。
            生成的页面将部署到公开链接，任何人都可以访问。
          </p>
        </div>

        {!result ? (
          <>
            {/* Input form */}
            <div className="border border-border rounded-xl p-6 bg-card">
              <label className="block text-sm font-medium mb-2">
                公司名 / 行业关键词
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isGenerating && companyName.trim()) {
                    handleSubmit()
                  }
                }}
                placeholder="例如：比亚迪、特斯拉、宁德时代..."
                className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                disabled={isGenerating}
              />
              <p className="text-xs text-muted-foreground mt-2">
                输入后点击生成，AI 将在 30-60 秒内完成报告
              </p>
              <button
                onClick={handleSubmit}
                disabled={isGenerating || !companyName.trim()}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    正在生成报告...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    生成报告网站
                  </>
                )}
              </button>
            </div>

            {/* Loading state */}
            {isGenerating && (
              <div className="mt-6 border border-border rounded-xl p-6 bg-card">
                <div className="flex items-start gap-3">
                  <Loader2 size={20} className="animate-spin text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">AI 正在生成行业分析报告...</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      这可能需要 30-60 秒。AI 正在分析行业数据并生成专业的 HTML 报告页面。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
                {error}
              </div>
            )}
          </>
        ) : (
          /* Success result */
          <div className="border border-border rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Sparkles size={20} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-sm font-medium text-green-600 dark:text-green-400">报告生成成功!</h2>
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
                查看报告
              </a>
              <button
                onClick={() => {
                  setResult(null)
                  setCompanyName('')
                  setCopied(false)
                }}
                className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
              >
                再创建一个
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
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium flex-shrink-0">1</div>
                <p className="text-muted-foreground">输入一个具体的公司名（如"比亚迪"），生成的报告会更有针对性</p>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium flex-shrink-0">2</div>
                <p className="text-muted-foreground">你也可以输入行业关键词（如"新能源汽车"），生成该行业的分析报告</p>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium flex-shrink-0">3</div>
                <p className="text-muted-foreground">生成的报告页面是完全公开的，你可以分享链接给任何人查看</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
