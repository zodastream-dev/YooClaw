import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { streamResearch, streamWizardReport } from '@/lib/api'
import {
  ArrowLeft, Globe, Sparkles, ExternalLink, Copy, Loader2,
  LayoutDashboard, CheckCircle2, Search, FileText, Check
} from 'lucide-react'

const ANALYSIS_METHODS = [
  { id: 'SWOT', label: 'SWOT 分析', desc: '优势/劣势/机会/威胁' },
  { id: 'PEST', label: 'PEST 分析', desc: '政治/经济/社会/技术' },
  { id: 'PORTER', label: '波特五力', desc: '供应商/买方/新进入者/替代品/竞争' },
  { id: '3C', label: '3C 分析', desc: '公司/顾客/竞争对手' },
]

const PERSPECTIVES = [
  { id: 'investor', label: '投资者视角' },
  { id: 'management', label: '管理层视角' },
  { id: 'academic', label: '学术视角' },
  { id: 'general', label: '通用视角' },
]

interface ReportResult {
  slug: string
  title: string
  url: string
}

export function SiteCreatePage() {
  const navigate = useNavigate()
  const abortRef = useRef<AbortController | null>(null)

  // Step navigation
  const [step, setStep] = useState(1)

  // Step 1 - Form
  const [companyName, setCompanyName] = useState('')
  const [businessDesc, setBusinessDesc] = useState('')
  const [selectedMethods, setSelectedMethods] = useState<string[]>(['SWOT', 'PEST'])
  const [perspective, setPerspective] = useState('investor')
  const [formError, setFormError] = useState<string | null>(null)

  // Step 2 - Research
  const [searchProgress, setSearchProgress] = useState(0)
  const [searchStage, setSearchStage] = useState('')
  const [researchData, setResearchData] = useState('')
  const [isResearching, setIsResearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Step 3 - Report generation
  const [reportProgress, setReportProgress] = useState(0)
  const [reportStage, setReportStage] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [reportResult, setReportResult] = useState<ReportResult | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const toggleMethod = (id: string) => {
    setSelectedMethods((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    )
  }

  const handleStartResearch = () => {
    const name = companyName.trim()
    if (!name) {
      setFormError('请输入公司或行业名称')
      return
    }
    setFormError(null)
    setStep(2)
    runResearch(name)
  }

  const runResearch = async (name: string) => {
    setIsResearching(true)
    setSearchProgress(0)
    setSearchStage('')
    setResearchData('')
    setSearchError(null)

    try {
      let researchText = ''
      for await (const event of streamResearch({
        companyName: name,
        businessDesc: businessDesc.trim(),
        analysisMethods: selectedMethods,
        perspective,
      })) {
        if (event.type === 'progress_update') {
          setSearchProgress(event.percent)
        } else if (event.type === 'stage') {
          setSearchStage(event.text)
        } else if (event.type === 'research_complete') {
          researchText = event.data || ''
          setResearchData(researchText)
        }
      }
      // Auto advance to step 3 after research completes
      setStep(3)
      runReport(name, researchText || '')
    } catch (e: any) {
      setSearchError(e.message || '搜索失败，请稍后重试')
    } finally {
      setIsResearching(false)
    }
  }

  const runReport = async (name: string, research: string) => {
    setIsGenerating(true)
    setReportProgress(0)
    setReportStage('')
    setReportResult(null)
    setReportError(null)

    try {
      for await (const event of streamWizardReport(
        {
          companyName: name,
          businessDesc: businessDesc.trim(),
          analysisMethods: selectedMethods,
          perspective,
        },
        research
      )) {
        if (event.type === 'progress_update') {
          setReportProgress(event.percent)
        } else if (event.type === 'stage') {
          setReportStage(event.text)
        } else if (event.type === 'report_complete') {
          setReportResult({
            slug: event.slug || '',
            title: event.title || `${name} 行业分析报告`,
            url: event.url || '',
          })
        }
      }
    } catch (e: any) {
      setReportError(e.message || '报告生成失败，请稍后重试')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleBackToForm = () => {
    if (abortRef.current) abortRef.current.abort()
    setStep(1)
    setSearchProgress(0)
    setSearchStage('')
    setResearchData('')
    setSearchError(null)
    setReportProgress(0)
    setReportStage('')
    setReportResult(null)
    setReportError(null)
  }

  const handleCopy = async () => {
    if (!reportResult) return
    try {
      const fullUrl = window.location.origin + reportResult.url
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const input = document.createElement('input')
      input.value = window.location.origin + reportResult.url
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
            创建行业分析报告
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            三步完成从信息采集到报告上线的全流程，体验 AI 驱动的工作流。
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8">
          <div className={`flex items-center gap-2 ${step >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
              ${step > 1
                ? 'bg-primary text-primary-foreground'
                : step === 1
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'}`}>
              {step > 1 ? <Check size={14} /> : 1}
            </div>
            <span className="text-sm font-medium">输入信息</span>
          </div>
          <div className={`flex-1 h-px mx-3 ${step >= 2 ? 'bg-primary' : 'bg-border'}`} />
          <div className={`flex items-center gap-2 ${step >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
              ${step > 2
                ? 'bg-primary text-primary-foreground'
                : step === 2
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'}`}>
              {step > 2 ? <Check size={14} /> : 2}
            </div>
            <span className="text-sm font-medium">联网搜索</span>
          </div>
          <div className={`flex-1 h-px mx-3 ${step >= 3 ? 'bg-primary' : 'bg-border'}`} />
          <div className={`flex items-center gap-2 ${step >= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
              ${step > 3
                ? 'bg-primary text-primary-foreground'
                : step === 3
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'}`}>
              {step > 3 ? <Check size={14} /> : 3}
            </div>
            <span className="text-sm font-medium">生成并部署</span>
          </div>
        </div>

        {/* Step 1: Input Form */}
        {step === 1 && (
          <div className="border border-border rounded-xl p-6 bg-card space-y-5">
            {/* Company name */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                公司 / 行业名称 <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && companyName.trim()) handleStartResearch()
                }}
                placeholder="例如：比亚迪、特斯拉、宁德时代..."
                className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>

            {/* Business description */}
            <div>
              <label className="block text-sm font-medium mb-1.5">
                主营业务描述 <span className="text-muted-foreground text-xs">（选填）</span>
              </label>
              <input
                type="text"
                value={businessDesc}
                onChange={(e) => setBusinessDesc(e.target.value)}
                placeholder="例如：新能源汽车制造与电池研发"
                className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>

            {/* Analysis methods */}
            <div>
              <label className="block text-sm font-medium mb-2">
                分析框架 <span className="text-muted-foreground text-xs">（可多选）</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ANALYSIS_METHODS.map((method) => (
                  <button
                    key={method.id}
                    onClick={() => toggleMethod(method.id)}
                    className={`text-left px-4 py-3 rounded-lg border text-sm transition-all
                      ${selectedMethods.includes(method.id)
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:border-primary/40'}`}
                  >
                    <div className="font-medium">{method.label}</div>
                    <div className="text-xs mt-0.5 opacity-70">{method.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Perspective */}
            <div>
              <label className="block text-sm font-medium mb-2">报告视角</label>
              <div className="flex flex-wrap gap-2">
                {PERSPECTIVES.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPerspective(p.id)}
                    className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all
                      ${perspective === p.id
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Form error */}
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleStartResearch}
              disabled={!companyName.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search size={16} />
              开始分析 — 联网搜索行业信息
            </button>
          </div>
        )}

        {/* Step 2: Research in progress */}
        {step === 2 && (
          <div className="border border-border rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Search size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-medium">正在联网搜索行业信息</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{companyName}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span>搜索进度</span>
                <span>{searchProgress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${searchProgress}%` }}
                />
              </div>
            </div>

            {/* Stage text */}
            {searchStage && (
              <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                <Loader2 size={14} className="animate-spin text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">{searchStage}</p>
              </div>
            )}

            {/* Error */}
            {searchError && (
              <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
                {searchError}
                <button
                  onClick={() => runResearch(companyName)}
                  className="block mt-2 text-sm font-medium underline"
                >
                  重试
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Report generation */}
        {step === 3 && (
          <>
            {/* In progress */}
            {(isGenerating || reportProgress < 100) && !reportResult && (
              <div className="border border-border rounded-xl p-6 bg-card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <FileText size={20} className="text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-medium">正在生成深度分析报告</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{companyName}</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                    <span>报告进度</span>
                    <span>{reportProgress}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-pink-500 to-orange-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${reportProgress}%` }}
                    />
                  </div>
                </div>

                {/* Stage text */}
                {reportStage && (
                  <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
                    <Loader2 size={14} className="animate-spin text-primary mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-muted-foreground">{reportStage}</p>
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {reportError && (
              <div className="border border-destructive/20 rounded-xl p-6 bg-destructive/5">
                <p className="text-sm text-destructive">{reportError}</p>
                <button
                  onClick={() => runReport(companyName, researchData)}
                  className="mt-3 text-sm font-medium text-destructive underline"
                >
                  重试
                </button>
              </div>
            )}

            {/* Success result */}
            {reportResult && (
              <div className="border border-border rounded-xl p-6 bg-card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CheckCircle2 size={20} className="text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-medium text-green-600 dark:text-green-400">报告生成成功!</h2>
                    <p className="text-xs text-muted-foreground">{reportResult.title}</p>
                  </div>
                </div>

                <div className="bg-muted rounded-lg p-4 mb-4">
                  <p className="text-xs text-muted-foreground mb-2">访问链接</p>
                  <div className="flex items-center gap-2">
                    <a
                      href={reportResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary hover:bg-primary/5 hover:border-primary/40 transition-all flex items-center gap-1.5"
                    >
                      <ExternalLink size={13} className="flex-shrink-0" />
                      <span className="truncate">{window.location.origin}{reportResult.url}</span>
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
                    href={reportResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    <ExternalLink size={16} />
                    查看报告
                  </a>
                  <button
                    onClick={() => {
                      setStep(1)
                      setCompanyName('')
                      setBusinessDesc('')
                      setReportProgress(0)
                      setReportStage('')
                      setReportResult(null)
                      setCopied(false)
                    }}
                    className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                  >
                    再创建一个
                  </button>
                </div>
              </div>
            )}

            {/* Back button */}
            {!reportResult && !reportError && (
              <button
                onClick={handleBackToForm}
                className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft size={14} />
                返回修改输入信息
              </button>
            )}
          </>
        )}

        {/* Tips (only on Step 1) */}
        {step === 1 && (
          <div className="mt-8">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">三步建站流程</h3>
            <div className="grid gap-3 text-sm">
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 text-xs font-medium flex-shrink-0">1</div>
                <div>
                  <p className="font-medium">填写分析信息</p>
                  <p className="text-muted-foreground mt-0.5">输入公司名，选择分析框架和报告视角</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 text-xs font-medium flex-shrink-0">2</div>
                <div>
                  <p className="font-medium">联网搜索行业数据</p>
                  <p className="text-muted-foreground mt-0.5">AI 自动搜索并整理行业概况、市场数据、竞争对手等信息</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-card border border-border rounded-lg">
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 text-xs font-medium flex-shrink-0">3</div>
                <div>
                  <p className="font-medium">AI 深度分析并部署</p>
                  <p className="text-muted-foreground mt-0.5">基于搜索数据生成专业报告，自动上线到公开访问链接</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
