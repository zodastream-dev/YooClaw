import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { deployPortalWithWidgets } from '@/lib/api'
import {
  ArrowLeft, Globe, Sparkles, ExternalLink, Copy, Loader2,
  Palette, CheckCircle2, GripVertical, Plus, Trash2, ChevronUp,
  ChevronDown, X, Monitor, Search, Wand2, BarChart3, Satellite,
  FileText
} from 'lucide-react'

// ========== Types ==========

interface WidgetSource {
  id: string
  name: string
  aiProvider: string
  aiModel: string
  apiKey: string
  keywords: string[]
  updateFrequency: string
  customPrompt: string
}

interface WidgetConfig {
  defaultCompany?: string
  analysisMethods?: string[]
  searchPlatform?: string
  searchApiKey?: string
  sysPrompt?: string
  userPrompt?: string
  sources?: WidgetSource[]
}

interface Widget {
  id: string
  type: 'report-generator' | 'intel-monitor'
  title: string
  expanded: boolean
  config: WidgetConfig
}

interface DeployResult {
  id: string
  slug: string
  title: string
  url: string
}

// ========== Templates ==========

const TEMPLATES = [
  { id: 'business-blue', name: '商务蓝', desc: '简洁专业，适合金融企业', primary: '#2563eb', preview: 'linear-gradient(135deg, #2563eb, #1e40af)' },
  { id: 'tech-black', name: '科技黑', desc: '深色炫酷，适合科技互联网', primary: '#0f172a', preview: 'linear-gradient(135deg, #0f172a, #1e293b)' },
  { id: 'simple-white', name: '简约白', desc: '极简留白，适合个人分析师', primary: '#1a1a2e', preview: '#ffffff' },
]

const AI_PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'metaso', label: '秘塔 (Metaso)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'custom', label: '自定义 API' },
]

const SEARCH_PLATFORMS = [
  { value: '', label: '默认 (CodeBuddy)' },
  { value: 'metaso', label: '秘塔 (Metaso)' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'deepseek', label: 'DeepSeek' },
]

const ANALYSIS_METHODS = ['SWOT', 'PEST', 'PORTER', '3C', 'STOCK']

// ========== Helpers ==========

let idCounter = 10
function genId(prefix = 'w'): string {
  return `${prefix}-${idCounter++}`
}

// ========== Initial State ==========

const initialWidgets: Widget[] = [
  {
    id: 'w-1', type: 'report-generator', title: '行业分析报告', expanded: false,
    config: {
      defaultCompany: '',
      analysisMethods: ['SWOT', 'PEST', 'PORTER', '3C'],
      searchPlatform: 'metaso',
      searchApiKey: '',
      sysPrompt: '你是一个行业研究分析师，输出结构化研究资料，用中文。',
      userPrompt: '请用完整的 HTML 格式输出行业研究报告…',
    },
  },
  {
    id: 'w-2', type: 'intel-monitor', title: '行业情报监控', expanded: false,
    config: {
      sources: [
        {
          id: 's-1', name: '光伏产业监控', aiProvider: 'deepseek', aiModel: 'deepseek-v3.1',
          apiKey: '', keywords: ['光伏', '太阳能', 'N型电池', 'TOPCon', 'HJT', '钙钛矿', '隆基绿能', '通威股份'],
          updateFrequency: 'daily', customPrompt: '你是新能源光伏行业专家。请监控光伏产业最新动态，重点关注技术突破、产能变化、政策调整和龙头企业动向。以中文输出结构化摘要。',
        },
        {
          id: 's-2', name: '储能市场追踪', aiProvider: 'metaso', aiModel: 'metaso-pro',
          apiKey: '', keywords: ['储能', '锂电池', '钠离子电池', '宁德时代', '比亚迪储能', '阳光电源'],
          updateFrequency: 'daily', customPrompt: '你是储能行业分析师。请追踪储能市场最新情报，关注锂电池价格走势、钠离子电池产业化进展。以中文输出结构化摘要。',
        },
      ],
    },
  },
]

// ========== Component ==========

export function PortalBuilderPage() {
  const navigate = useNavigate()

  const [siteName, setSiteName] = useState('情报分析站')
  const [siteDesc, setSiteDesc] = useState('专注行业研究的AI驱动情报分析平台')
  const [selectedTheme, setSelectedTheme] = useState('business-blue')
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets)
  const [isDeploying, setIsDeploying] = useState(false)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragIdx, setDragIdx] = useState(-1)

  // ========== Widget Operations ==========

  const addWidget = useCallback((type: 'report-generator' | 'intel-monitor') => {
    const defaults: Record<string, { title: string; config: WidgetConfig }> = {
      'report-generator': {
        title: '行业分析报告',
        config: {
          defaultCompany: '', analysisMethods: ['SWOT', 'PEST'],
          searchPlatform: 'metaso', searchApiKey: '',
          sysPrompt: '你是一个行业研究分析师。', userPrompt: '请用 HTML 格式输出行业研究报告。',
        },
      },
      'intel-monitor': {
        title: `情报监控源 #${widgets.filter((w) => w.type === 'intel-monitor').length + 1}`,
        config: {
          sources: [{
            id: genId('s'), name: '新建监控源', aiProvider: 'deepseek', aiModel: 'deepseek-v3.1',
            apiKey: '', keywords: [], updateFrequency: 'daily', customPrompt: '',
          }],
        },
      },
    }
    const def = defaults[type]
    setWidgets((prev) => [...prev, { id: genId(), type, title: def.title, expanded: true, config: JSON.parse(JSON.stringify(def.config)) }])
  }, [widgets])

  const deleteWidget = useCallback((id: string) => {
    const w = widgets.find((w) => w.id === id)
    if (!w || !window.confirm(`确定删除「${w.title}」？此操作不可撤销。`)) return
    setWidgets((prev) => prev.filter((w) => w.id !== id))
  }, [widgets])

  const toggleWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, expanded: !w.expanded } : w)))
  }, [])

  const updateWidgetTitle = useCallback((id: string, title: string) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, title } : w)))
  }, [])

  const updateWidget = useCallback((id: string, updater: (w: Widget) => Widget) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? updater(w) : w)))
  }, [])

  const moveWidget = useCallback((fromIdx: number, toIdx: number) => {
    setWidgets((prev) => {
      const arr = [...prev]
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      return arr
    })
  }, [])

  // ========== Monitor Source Operations ==========

  const addMonitorSource = useCallback((widgetId: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      const sources = [...(w.config.sources || [])]
      sources.push({
        id: genId('s'), name: `新建监控源 #${sources.length + 1}`,
        aiProvider: 'deepseek', aiModel: 'deepseek-v3.1', apiKey: '',
        keywords: [], updateFrequency: 'daily', customPrompt: '',
      })
      return { ...w, config: { ...w.config, sources } }
    })
  }, [updateWidget])

  const deleteMonitorSource = useCallback((widgetId: string, sourceId: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      const s = w.config.sources?.find((s) => s.id === sourceId)
      if (!window.confirm(`确定删除监控源「${s?.name || sourceId}」？`)) return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).filter((s) => s.id !== sourceId) } }
    })
  }, [updateWidget])

  const updateSourceField = useCallback((widgetId: string, sourceId: string, field: keyof WidgetSource, value: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return {
        ...w,
        config: {
          ...w.config,
          sources: (w.config.sources || []).map((s) =>
            s.id === sourceId ? { ...s, [field]: value } : s
          ),
        },
      }
    })
  }, [updateWidget])

  const addKeyword = useCallback((widgetId: string, sourceId: string, keyword: string) => {
    const kw = keyword.trim()
    if (!kw) return
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return {
        ...w,
        config: {
          ...w.config,
          sources: (w.config.sources || []).map((s) => {
            if (s.id !== sourceId) return s
            if (s.keywords.includes(kw)) return s
            return { ...s, keywords: [...s.keywords, kw] }
          }),
        },
      }
    })
  }, [updateWidget])

  const removeKeyword = useCallback((widgetId: string, sourceId: string, keyword: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return {
        ...w,
        config: {
          ...w.config,
          sources: (w.config.sources || []).map((s) =>
            s.id === sourceId ? { ...s, keywords: s.keywords.filter((k) => k !== keyword) } : s
          ),
        },
      }
    })
  }, [updateWidget])

  const toggleMethod = useCallback((widgetId: string, method: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'report-generator') return w
      const methods = [...(w.config.analysisMethods || [])]
      const idx = methods.indexOf(method)
      if (idx > -1) methods.splice(idx, 1)
      else methods.push(method)
      return { ...w, config: { ...w.config, analysisMethods: methods } }
    })
  }, [updateWidget])

  // ========== Drag & Drop ==========

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx !== -1 && dragIdx !== idx) {
      moveWidget(dragIdx, idx)
    }
    setDragIdx(-1)
  }

  // ========== Deploy ==========

  const handleDeploy = async () => {
    const name = siteName.trim() || '情报分析门户'
    setIsDeploying(true)
    setError(null)
    setResult(null)
    try {
      const res = await deployPortalWithWidgets(name, siteDesc.trim(), selectedTheme, widgets)
      if (res.data) {
        setResult({ id: res.data.id, slug: res.data.slug, title: res.data.title, url: res.data.url })
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
      await navigator.clipboard.writeText(window.location.origin + result.url)
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

  // ========== Stats ==========

  const reportCount = widgets.filter((w) => w.type === 'report-generator').length
  const monitorCount = widgets.filter((w) => w.type === 'intel-monitor').length
  const template = TEMPLATES.find((t) => t.id === selectedTheme)

  // ========== Preview Content ==========

  const previewWidgets = widgets.map((w) => {
    if (w.type === 'report-generator') {
      return (
        <div key={w.id} className="bg-muted/50 border border-border rounded-lg p-4 mb-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2.5">
            <div className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />
            {w.title}
          </div>
          <input
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-xs"
            placeholder="输入公司/行业名称…"
            readOnly
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {(w.config.analysisMethods || []).map((m) => (
              <span key={m} className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-full text-[10px] font-medium">
                {m}
              </span>
            ))}
          </div>
        </div>
      )
    }
    if (w.type === 'intel-monitor') {
      const sources = w.config.sources || []
      return (
        <div key={w.id} className="bg-muted/50 border border-border rounded-lg p-4 mb-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
            {w.title}
          </div>
          {sources.map((s) => (
            <div key={s.id} className="mb-2.5 pb-2.5 border-b border-border last:mb-0 last:pb-0 last:border-b-0">
              <div className="text-xs font-semibold mb-1">📡 {s.name}</div>
              <div className="text-[10px] text-muted-foreground mb-1">
                🤖 {s.aiProvider} · {s.aiModel || '默认'} · 更新: {s.updateFrequency}
              </div>
              <div className="flex flex-wrap gap-1 mb-1">
                {(s.keywords || []).map((k) => (
                  <span key={k} className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-full text-[10px] font-medium">{k}</span>
                ))}
                {(!s.keywords || s.keywords.length === 0) && (
                  <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-[10px]">暂无关键词</span>
                )}
              </div>
              {s.customPrompt && (
                <div className="text-[10px] text-muted-foreground mt-1.5 p-2 bg-background rounded border border-border leading-relaxed">
                  💬 {s.customPrompt.substring(0, 80)}{s.customPrompt.length > 80 ? '…' : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )
    }
    return null
  })

  // ========== Build Mode ==========

  if (!result) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigate('/sites')}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={16} /> 返回列表
            </button>
            <span className="px-3 py-1 bg-violet-100 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-[11px] font-semibold rounded-full">
              🧪 建站工具 Beta
            </span>
          </div>

          {/* Header */}
          <div className="mb-7">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-lg">🏗️</span>
              创建情报分析门户
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
              拖拽排列、自由组合 Widget 模块，打造专属的 AI 驱动情报收集与分析网站。配置完成后一键部署到公开链接。
            </p>
          </div>

          {/* Main layout: sidebar + preview */}
          <div className="flex flex-col lg:flex-row gap-7 items-start">
            {/* LEFT: Builder */}
            <div className="space-y-4 lg:w-[380px] lg:min-w-[340px] lg:sticky lg:top-6 lg:max-h-screen lg:overflow-y-auto lg:pr-2">
              {/* Basic Info */}
              <div className="border border-border rounded-2xl p-6 bg-card shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
                    <FileText size={16} className="text-violet-600" />
                  </div>
                  <span className="text-sm font-semibold">门户基本信息</span>
                </div>
                <div className="flex gap-3 mb-3">
                  <div className="flex-[2]">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">网站名称</label>
                    <input
                      type="text" value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      placeholder="给你的门户起个名字"
                      className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                      自定义链接 <span className="font-normal text-muted-foreground/60">选填</span>
                    </label>
                    <input
                      type="text" placeholder="例如：my-portal"
                      className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">留空则自动生成</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">网站描述</label>
                  <input
                    type="text" value={siteDesc}
                    onChange={(e) => setSiteDesc(e.target.value)}
                    placeholder="一句话介绍你的门户"
                    className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                  />
                </div>
              </div>

              {/* Theme */}
              <div className="border border-border rounded-2xl p-6 bg-card shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
                    <Palette size={16} className="text-violet-600" />
                  </div>
                  <span className="text-sm font-semibold">视觉主题</span>
                  <span className="text-[11px] text-muted-foreground ml-1">选择门户的整体风格</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTheme(t.id)}
                      className={`overflow-hidden rounded-xl border-2 text-left transition-all ${
                        selectedTheme === t.id
                          ? 'border-violet-500 ring-2 ring-violet-500/20'
                          : 'border-border hover:border-violet-500/40'
                      }`}
                    >
                      <div className="h-14 flex items-end p-3" style={{ background: t.preview }}>
                        <div className="flex gap-1">
                          <div className="w-4 h-1 rounded-full bg-white/30" />
                          <div className="w-2.5 h-1 rounded-full bg-white/20" />
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="text-xs font-semibold">{t.name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</div>
                      </div>
                      {selectedTheme === t.id && (
                        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                          ✓
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Widgets */}
              <div className="border border-border rounded-2xl p-6 bg-card shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
                    <BarChart3 size={16} className="text-violet-600" />
                  </div>
                  <span className="text-sm font-semibold">Widget 模块</span>
                  <span className="text-[11px] text-muted-foreground ml-1">拖拽排序 · 点击展开配置</span>
                </div>

                {/* Widget list */}
                <div className="space-y-2.5 mb-4">
                  {widgets.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">
                      <div className="text-3xl mb-2 opacity-40">🧩</div>
                      <p className="text-sm font-medium">还没有添加 Widget</p>
                      <p className="text-[11px] opacity-60 mt-1">点击下方按钮开始构建你的情报门户</p>
                    </div>
                  ) : (
                    widgets.map((w, i) => {
                      const isReport = w.type === 'report-generator'
                      const isMonitor = w.type === 'intel-monitor'
                      const sources = isMonitor ? (w.config.sources || []) : []
                      const methodCount = isReport ? (w.config.analysisMethods || []).length : 0
                      const kwCount = isMonitor ? sources.reduce((sum, s) => sum + (s.keywords || []).length, 0) : 0

                      return (
                        <div
                          key={w.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, i)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, i)}
                          className={`border rounded-xl overflow-hidden transition-all ${
                            dragIdx === i
                              ? 'opacity-50 scale-[0.97] border-dashed border-violet-400'
                              : 'border-border hover:border-violet-300 bg-card'
                          }`}
                        >
                          {/* Widget header */}
                          <div
                            className="flex items-center gap-2.5 px-4 py-3.5 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                            onClick={() => toggleWidget(w.id)}
                          >
                            <GripVertical size={14} className="text-muted-foreground flex-shrink-0" />
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
                              isReport ? 'bg-violet-100 dark:bg-violet-900/20 text-violet-600' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-600'
                            }`}>
                              {isReport ? '📊' : '🛰️'}
                            </div>
                            <input
                              className="flex-1 bg-transparent border-none text-sm font-semibold outline-none min-w-0 hover:bg-muted/50 focus:bg-background focus:ring-1 focus:ring-violet-500/30 rounded px-1 py-0.5 transition-all"
                              value={w.title}
                              onChange={(e) => updateWidgetTitle(w.id, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              title="点击编辑标题"
                            />
                            <div className="flex gap-1.5 flex-shrink-0 items-center">
                              <span className="text-[10px] font-semibold px-2 py-0.5 bg-violet-100 dark:bg-violet-900/20 text-violet-600 rounded-full">
                                {isReport ? '报告生成器' : '情报监控源'}
                              </span>
                              {isReport && methodCount > 0 && (
                                <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{methodCount} 框架</span>
                              )}
                              {isMonitor && (
                                <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{sources.length} 源</span>
                              )}
                              {kwCount > 0 && (
                                <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{kwCount} 关键词</span>
                              )}
                            </div>
                            <div className="flex gap-0.5 flex-shrink-0">
                              <button
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                                disabled={i === 0}
                                onClick={(e) => { e.stopPropagation(); moveWidget(i, i - 1) }}
                              >
                                <ChevronUp size={14} />
                              </button>
                              <button
                                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                                disabled={i === widgets.length - 1}
                                onClick={(e) => { e.stopPropagation(); moveWidget(i, i + 1) }}
                              >
                                <ChevronDown size={14} />
                              </button>
                              <button
                                className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 transition-colors"
                                onClick={(e) => { e.stopPropagation(); deleteWidget(w.id) }}
                              >
                                <Trash2 size={14} />
                              </button>
                              <span className={`text-[10px] text-muted-foreground transition-transform ${w.expanded ? 'rotate-180' : ''}`}>
                                <ChevronDown size={14} />
                              </span>
                            </div>
                          </div>

                          {/* Widget body */}
                          {w.expanded && (
                            <div className="border-t border-border px-4 py-4 bg-muted/10" onClick={(e) => e.stopPropagation()}>
                              {isReport && (
                                <div className="space-y-3">
                                  <div className="flex gap-3">
                                    <div className="flex-[2]">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Widget 标题</label>
                                      <input
                                        type="text" value={w.title}
                                        onChange={(e) => updateWidgetTitle(w.id, e.target.value)}
                                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                        默认公司名 <span className="font-normal text-muted-foreground/60">选填</span>
                                      </label>
                                      <input
                                        type="text" value={w.config.defaultCompany || ''}
                                        placeholder="例如：宁德时代"
                                        onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, defaultCompany: e.target.value } }))}
                                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                      分析框架 <span className="font-normal text-muted-foreground/60">可多选</span>
                                    </label>
                                    <div className="flex flex-wrap gap-1.5">
                                      {ANALYSIS_METHODS.map((m) => {
                                        const checked = (w.config.analysisMethods || []).includes(m)
                                        return (
                                          <button
                                            key={m}
                                            onClick={() => toggleMethod(w.id, m)}
                                            className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                                              checked
                                                ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 font-semibold'
                                                : 'border-border hover:border-violet-300 text-muted-foreground'
                                            }`}
                                          >
                                            {m} 分析
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <div className="flex gap-3">
                                    <div className="flex-1">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">搜索平台</label>
                                      <select
                                        value={w.config.searchPlatform || ''}
                                        onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, searchPlatform: e.target.value } }))}
                                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                      >
                                        {SEARCH_PLATFORMS.map((p) => (
                                          <option key={p.value} value={p.value}>{p.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="flex-1">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">API Key</label>
                                      <input
                                        type="password" value={w.config.searchApiKey || ''}
                                        placeholder="输入该平台的 API Key"
                                        onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, searchApiKey: e.target.value } }))}
                                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                      系统提示词 <span className="font-normal text-muted-foreground/60">选填</span>
                                    </label>
                                    <textarea
                                      value={w.config.sysPrompt || ''}
                                      onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, sysPrompt: e.target.value } }))}
                                      rows={2}
                                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30 resize-y"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                      用户提示词 <span className="font-normal text-muted-foreground/60">选填</span>
                                    </label>
                                    <textarea
                                      value={w.config.userPrompt || ''}
                                      onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, userPrompt: e.target.value } }))}
                                      rows={2}
                                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30 resize-y"
                                    />
                                  </div>
                                </div>
                              )}

                              {isMonitor && (
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Widget 标题</label>
                                    <input
                                      type="text" value={w.title}
                                      onChange={(e) => updateWidgetTitle(w.id, e.target.value)}
                                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                    />
                                  </div>
                                  <div className="space-y-4">
                                    <label className="block text-xs font-semibold text-muted-foreground">
                                      📡 监控源 <span className="font-normal text-muted-foreground/60">每个源独立配置 AI 接口与监控关键词</span>
                                    </label>
                                    {sources.map((s) => (
                                      <div key={s.id} className="bg-muted/50 border border-border rounded-xl p-4 space-y-3">
                                        {/* Source header */}
                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                          <span className="text-sm font-semibold flex items-center gap-1.5">
                                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                                            {s.name}
                                          </span>
                                          <div className="flex gap-1">
                                            <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-full">
                                              🤖 {s.aiProvider}
                                            </span>
                                            {s.keywords.length > 0 && (
                                              <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">
                                                🔑 {s.keywords.length} 关键词
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Source fields */}
                                        <div className="flex gap-3">
                                          <div className="flex-1">
                                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">监控源名称</label>
                                            <input
                                              type="text" value={s.name}
                                              onChange={(e) => updateSourceField(w.id, s.id, 'name', e.target.value)}
                                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                            />
                                          </div>
                                          <div className="flex-1">
                                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">更新频率</label>
                                            <select
                                              value={s.updateFrequency}
                                              onChange={(e) => updateSourceField(w.id, s.id, 'updateFrequency', e.target.value)}
                                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                            >
                                              <option value="realtime">实时</option>
                                              <option value="hourly">每小时</option>
                                              <option value="daily">每天</option>
                                              <option value="weekly">每周</option>
                                            </select>
                                          </div>
                                        </div>

                                        <div className="flex gap-3">
                                          <div className="flex-1">
                                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">AI 接口</label>
                                            <select
                                              value={s.aiProvider}
                                              onChange={(e) => updateSourceField(w.id, s.id, 'aiProvider', e.target.value)}
                                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                            >
                                              {AI_PROVIDERS.map((p) => (
                                                <option key={p.value} value={p.value}>{p.label}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="flex-1">
                                            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">AI 模型</label>
                                            <input
                                              type="text" value={s.aiModel || ''}
                                              placeholder="例如：deepseek-v3.1"
                                              onChange={(e) => updateSourceField(w.id, s.id, 'aiModel', e.target.value)}
                                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                            />
                                          </div>
                                        </div>

                                        <div>
                                          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">API Key</label>
                                          <input
                                            type="password" value={s.apiKey || ''}
                                            placeholder="输入 API Key"
                                            onChange={(e) => updateSourceField(w.id, s.id, 'apiKey', e.target.value)}
                                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                          />
                                        </div>

                                        {/* Keywords */}
                                        <KeywordInput
                                          keywords={s.keywords}
                                          sourceId={s.id}
                                          widgetId={w.id}
                                          onAdd={addKeyword}
                                          onRemove={removeKeyword}
                                        />

                                        {/* Custom prompt */}
                                        <div>
                                          <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                                            自定义 AI 提示词 <span className="font-normal text-muted-foreground/60">针对此监控源的 AI 行为指令</span>
                                          </label>
                                          <textarea
                                            value={s.customPrompt || ''}
                                            onChange={(e) => updateSourceField(w.id, s.id, 'customPrompt', e.target.value)}
                                            placeholder="例如：你是新能源行业专家，请监控最新动态并输出结构化摘要…"
                                            rows={3}
                                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30 resize-y"
                                          />
                                        </div>

                                        <div className="text-right">
                                          <button
                                            onClick={() => deleteMonitorSource(w.id, s.id)}
                                            className="px-3 py-1.5 text-[11px] font-medium text-red-600 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                                          >
                                            🗑 删除此监控源
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <button
                                    onClick={() => addMonitorSource(w.id)}
                                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-all"
                                  >
                                    <Plus size={14} /> 添加监控源
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Add widget buttons */}
                <div className="border-2 border-dashed border-border rounded-xl p-5 text-center bg-muted/30 hover:border-violet-400 hover:bg-violet-50/30 dark:hover:bg-violet-900/5 transition-all">
                  <p className="text-xs text-muted-foreground mb-3 font-medium">＋ 添加 Widget</p>
                  <div className="flex gap-2.5 justify-center flex-wrap">
                    <button
                      onClick={() => addWidget('report-generator')}
                      className="flex items-center gap-2.5 px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-all"
                    >
                      <span className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-sm">📊</span>
                      <div className="text-left leading-tight">
                        <div className="font-semibold text-xs">报告生成器</div>
                        <div className="text-[10px] text-muted-foreground">AI 自动生成分析报告</div>
                      </div>
                    </button>
                    <button
                      onClick={() => addWidget('intel-monitor')}
                      className="flex items-center gap-2.5 px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all"
                    >
                      <span className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center text-sm">🛰️</span>
                      <div className="text-left leading-tight">
                        <div className="font-semibold text-xs">情报监控源</div>
                        <div className="text-[10px] text-muted-foreground">AI 持续监控关键词情报</div>
                      </div>
                    </button>
                    <button className="flex items-center gap-2.5 px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium opacity-40 cursor-not-allowed" disabled>
                      <span className="w-7 h-7 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center text-sm">📝</span>
                      <div className="text-left leading-tight">
                        <div className="font-semibold text-xs">文本块</div>
                        <div className="text-[10px] text-muted-foreground">即将推出</div>
                      </div>
                    </button>
                    <button className="flex items-center gap-2.5 px-4 py-3 bg-card border border-border rounded-xl text-sm font-medium opacity-40 cursor-not-allowed" disabled>
                      <span className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center text-sm">🔗</span>
                      <div className="text-left leading-tight">
                        <div className="font-semibold text-xs">快捷链接</div>
                        <div className="text-[10px] text-muted-foreground">即将推出</div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              {/* Deploy */}
              <div className="border-2 border-violet-300 dark:border-violet-800 rounded-2xl p-6 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 shadow-sm">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
                    <Globe size={16} className="text-violet-600" />
                  </div>
                  <span className="text-sm font-semibold">确认并部署</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  检查配置无误后，一键生成完整的情报分析门户网站，部署到可公开访问的链接。
                </p>
                <div className="flex gap-4 mb-4 flex-wrap text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    {reportCount} 个报告生成器
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {monitorCount} 个情报监控源
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                    {template?.name || '默认'} 主题
                  </span>
                </div>
                <button
                  onClick={handleDeploy}
                  disabled={isDeploying}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-violet-500/20"
                >
                  {isDeploying ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      正在部署门户网站...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      一键部署情报分析门户
                    </>
                  )}
                </button>

                {error && (
                  <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-xl text-xs text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* CENTER: Preview */}
            <div className="flex-1 sticky top-6">
              <div className="border border-border rounded-2xl overflow-hidden bg-card shadow-lg">
                {/* Preview topbar */}
                <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 ml-2.5 text-[10px] text-muted-foreground bg-background px-3 py-1 rounded-md border border-border truncate">
                    🔒 yooclaw.yookeer.com/p/...
                  </div>
                </div>

                {/* Preview body */}
                <div className="p-4 max-h-[calc(100vh-120px)] overflow-y-auto">
                  {/* Site header */}
                  <div
                    className="rounded-xl p-5 mb-3.5 text-white"
                    style={{
                      background: template?.preview || 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                      ...(selectedTheme === 'simple-white' ? { color: '#1a1a2e', border: '1px solid #e5e7eb' } : {}),
                    }}
                  >
                    <h3 className="text-base font-bold">{siteName || '情报分析门户'}</h3>
                    {siteDesc && <p className={`text-xs mt-1.5 opacity-80 leading-relaxed`}>{siteDesc}</p>}
                  </div>

                  {/* Preview widgets */}
                  {previewWidgets}

                  {/* Footer */}
                  <div className="text-center py-2.5 text-[10px] text-muted-foreground">
                    Powered by YooClaw AI
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ========== Success Mode ==========

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto px-4 md:px-6 py-6">
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
              onClick={() => { setResult(null); setSiteName(''); setSiteDesc(''); setCopied(false) }}
              className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              再部署一个
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ========== Keyword Input Subcomponent ==========

function KeywordInput({
  keywords, sourceId, widgetId,
  onAdd, onRemove,
}: {
  keywords: string[]
  sourceId: string
  widgetId: string
  onAdd: (widgetId: string, sourceId: string, keyword: string) => void
  onRemove: (widgetId: string, sourceId: string, keyword: string) => void
}) {
  const [input, setInput] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (input.trim()) {
        onAdd(widgetId, sourceId, input)
        setInput('')
      }
    }
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
        监控关键词 <span className="font-normal text-muted-foreground/60">按 Enter 添加</span>
      </label>
      <div className="flex flex-wrap gap-1 mb-2">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-full text-[11px] font-medium">
            {k}
            <button
              onClick={() => onRemove(widgetId, sourceId, k)}
              className="ml-0.5 text-violet-400 hover:text-red-500 transition-colors"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入关键词，按 Enter 添加…"
          className="flex-1 px-3 py-2 bg-background border border-dashed border-border rounded-lg text-sm outline-none focus:border-violet-400 focus:border-solid transition-all"
        />
        <button
          onClick={() => { if (input.trim()) { onAdd(widgetId, sourceId, input); setInput('') } }}
          className="px-3 py-2 border border-border rounded-lg text-xs font-medium hover:border-violet-400 hover:text-violet-600 transition-all"
        >
          + 添加
        </button>
      </div>
    </div>
  )
}
