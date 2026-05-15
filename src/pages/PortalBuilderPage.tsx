import { useState, useCallback, useEffect, useMemo } from 'react'
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
          id: 's-1', name: '光伏产业监控', aiProvider: 'deepseek', aiModel: 'deepseek-v4-flash',
          apiKey: '', keywords: ['光伏', '太阳能', 'N型电池', 'TOPCon', 'HJT', '钙钛矿', '隆基绿能', '通威股份'],
          updateFrequency: 'daily', customPrompt: '你是新能源光伏行业专家。请监控光伏产业最新动态，重点关注技术突破、产能变化、政策调整和龙头企业动向。以中文输出结构化摘要。',
        },
        {
          id: 's-2', name: '储能市场追踪', aiProvider: 'metaso', aiModel: 'metaso-pro',
          apiKey: '', keywords: ['储能', '锂电池', '钠离子电池', '宁德时代', '比亚迪储能', '阳光电源'],
          updateFrequency: 'daily', customPrompt: '你是储能行业分析师。请追踪储能市场最新情报，关注锂电池价格走势、钠离子电池产业化进展。以中文输出结构化摘要。',
        },
        {
          id: 's-3', name: '特朗普动态', aiProvider: 'metaso', aiModel: 'metaso-pro',
          apiKey: '', keywords: ['特朗普', 'Trump', '关税', '贸易战', '中美关系', '美国大选', '白宫'],
          updateFrequency: 'daily', customPrompt: '你是国际政治经济分析师。请监控特朗普最新动态，重点关注关税政策、中美贸易关系、外交动向及其对全球金融市场的影响。以中文输出结构化摘要。',
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

  // ========== Add Widget Modal ==========
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalType, setAddModalType] = useState<'report-generator' | 'intel-monitor' | null>(null)
  const [addReportForm, setAddReportForm] = useState({
    title: '行业分析报告',
    defaultCompany: '',
    analysisMethods: ['SWOT', 'PEST'] as string[],
    searchPlatform: 'metaso',
    searchApiKey: '',
    sysPrompt: '你是一个行业研究分析师。',
    userPrompt: '请用 HTML 格式输出行业研究报告。',
  })
  const [addMonitorForm, setAddMonitorForm] = useState({
    title: '',
    sources: [{
      id: '',
      name: '新建监控源',
      aiProvider: 'deepseek',
      aiModel: 'deepseek-v3.1',
      apiKey: '',
      keywords: [] as string[],
      updateFrequency: 'daily',
      customPrompt: '',
    }],
  })

  const openAddModal = useCallback((type: 'report-generator' | 'intel-monitor') => {
    setAddReportForm({
      title: '行业分析报告',
      defaultCompany: '',
      analysisMethods: ['SWOT', 'PEST'],
      searchPlatform: 'metaso',
      searchApiKey: '',
      sysPrompt: '你是一个行业研究分析师。',
      userPrompt: '请用 HTML 格式输出行业研究报告。',
    })
    const existingIntelCount = widgets.filter((w) => w.type === 'intel-monitor').length
    let defaultProvider = 'deepseek'
    let defaultModel = 'deepseek-v3.1'
    let defaultKeywords: string[] = []
    if (existingIntelCount === 0) {
      // 第一次添加情报源：deepseek搜索特朗普动态
      defaultProvider = 'deepseek'
      defaultModel = 'deepseek-v3.1'
      defaultKeywords = ['特朗普', 'Trump', '关税', '贸易战', '中美关系', '美国大选', '白宫']
    } else if (existingIntelCount === 1) {
      // 第二次添加情报源：秘塔搜索比亚迪电动汽车
      defaultProvider = 'metaso'
      defaultModel = 'metaso-pro'
      defaultKeywords = ['比亚迪', 'BYD', '电动汽车', '新能源车', '动力电池', '刀片电池']
    }
    setAddMonitorForm({
      title: `情报监控源 #${existingIntelCount + 1}`,
      sources: [{
        id: genId('s'),
        name: '新建监控源',
        aiProvider: defaultProvider,
        aiModel: defaultModel,
        apiKey: '',
        keywords: defaultKeywords,
        updateFrequency: 'daily',
        customPrompt: '',
      }],
    })
    setAddModalType(type)
    setShowAddModal(true)
  }, [widgets])

  const confirmAddWidget = useCallback(() => {
    if (addModalType === 'report-generator') {
      setWidgets((prev) => [...prev, {
        id: genId(),
        type: 'report-generator',
        title: addReportForm.title || '行业分析报告',
        expanded: true,
        config: {
          defaultCompany: addReportForm.defaultCompany,
          analysisMethods: addReportForm.analysisMethods,
          searchPlatform: addReportForm.searchPlatform,
          searchApiKey: addReportForm.searchApiKey,
          sysPrompt: addReportForm.sysPrompt,
          userPrompt: addReportForm.userPrompt,
        },
      }])
    } else if (addModalType === 'intel-monitor') {
      setWidgets((prev) => [...prev, {
        id: genId(),
        type: 'intel-monitor',
        title: addMonitorForm.title || `情报监控源 #${widgets.filter((w) => w.type === 'intel-monitor').length + 1}`,
        expanded: true,
        config: {
          sources: addMonitorForm.sources.map((s) => ({ ...s, id: s.id || genId('s') })),
        },
      }])
    }
    setShowAddModal(false)
    setAddModalType(null)
  }, [addModalType, addReportForm, addMonitorForm, widgets])

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
            id: genId('s'), name: '新建监控源', aiProvider: 'deepseek', aiModel: 'deepseek-v4-flash',
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
        aiProvider: 'deepseek', aiModel: 'deepseek-v4-flash', apiKey: '',
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
        // 直接在新窗口打开部署后的门户页面
        const portalFullUrl = window.location.origin + res.data.url
        window.open(portalFullUrl, '_blank')
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

  // ========== Preview Theme Colors ==========

  const previewColors = useMemo(() => {
    switch (selectedTheme) {
      case 'tech-black':
        return { primary: '#38bdf8', bg: '#020617', cardBg: '#0f172a', text: '#e2e8f0', muted: '#64748b', border: '#1e293b', reportAccent: '#818cf8', monitorAccent: '#fbbf24' }
      case 'simple-white':
        return { primary: '#1a1a2e', bg: '#ffffff', cardBg: '#ffffff', text: '#1a1a2e', muted: '#94a3b8', border: '#e5e7eb', reportAccent: '#6366f1', monitorAccent: '#f59e0b' }
      default: // business-blue
        return { primary: '#2563eb', bg: '#ffffff', cardBg: '#ffffff', text: '#1f2937', muted: '#94a3b8', border: '#e5e7eb', reportAccent: '#6366f1', monitorAccent: '#f59e0b' }
    }
  }, [selectedTheme])

  const pc = previewColors

  // ========== Preview Cards (matching portal card style) ==========

  const previewCards = widgets.length > 0 ? widgets.map((w, i) => {
    if (w.type === 'report-generator') {
      const methods = w.config.analysisMethods || []
      return (
        <div
          key={w.id}
          className="relative flex flex-col items-center justify-center gap-2 rounded-xl border cursor-pointer transition-all select-none overflow-hidden"
          style={{
            width: 200, height: 126,
            background: pc.cardBg,
            borderColor: pc.border,
            boxShadow: `0 1px 3px rgba(0,0,0,${pc.bg === '#020617' ? '.20' : '.04'})`,
            animation: `cardIn .5s cubic-bezier(.4,0,.2,1) backwards`,
            animationDelay: `${i * 0.06}s`,
          }}
          title={w.title}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ background: `linear-gradient(135deg,rgba(99,102,241,.12),rgba(129,140,248,.08))`, color: pc.reportAccent }}>
            📊
          </div>
          <div className="text-xs font-bold text-center px-2 leading-tight" style={{ color: pc.text }}>
            {w.title}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-medium" style={{ color: pc.muted }}>
            {methods.slice(0, 3).map((m, j) => (
              <span key={m}>{m}{j < Math.min(methods.length, 3) - 1 ? ' · ' : ''}</span>
            ))}
            {methods.length > 3 && <span> +{methods.length - 3}</span>}
            {methods.length === 0 && <span>未选框架</span>}
          </div>
        </div>
      )
    }
    if (w.type === 'intel-monitor') {
      const sources = w.config.sources || []
      const kwCount = sources.reduce((sum, s) => sum + (s.keywords || []).length, 0)
      const freq = sources[0]?.updateFrequency || 'daily'
      const freqLabel = freq === 'realtime' ? '实时' : freq === 'daily' ? '每日' : '每周'
      return (
        <div
          key={w.id}
          className="relative flex flex-col items-center justify-center gap-2 rounded-xl border cursor-pointer transition-all select-none overflow-hidden"
          style={{
            width: 200, height: 126,
            background: pc.cardBg,
            borderColor: pc.border,
            boxShadow: `0 1px 3px rgba(0,0,0,${pc.bg === '#020617' ? '.20' : '.04'})`,
            animation: `cardIn .5s cubic-bezier(.4,0,.2,1) backwards`,
            animationDelay: `${i * 0.06}s`,
          }}
          title={w.title}
        >
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ background: `linear-gradient(135deg,rgba(245,158,11,.12),rgba(251,191,36,.08))`, color: pc.monitorAccent }}>
            🛰️
          </div>
          <div className="text-xs font-bold text-center px-2 leading-tight" style={{ color: pc.text }}>
            {w.title}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-medium" style={{ color: pc.muted }}>
            <span>{kwCount} 关键词</span>
            <span className="w-1 h-1 rounded-full inline-block" style={{ background: pc.border }} />
            <span>{freqLabel}</span>
          </div>
        </div>
      )
    }
    return null
  }) : (
    <div className="text-center py-10" style={{ color: pc.muted }}>
      <div className="text-3xl mb-2 opacity-30">🧩</div>
      <p className="text-xs">在左侧添加 Widget 模块来构建你的门户</p>
    </div>
  )

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

          {/* Main grid */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-7 items-start">
            {/* LEFT: Preview */}
              <style>{`@keyframes cardIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
              <div className="border border-border rounded-2xl overflow-hidden bg-card shadow-lg">
                {/* Preview topbar */}
                <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                  </div>
            {/* LEFT: Builder */}
            <div className="space-y-4 lg:min-w-0 lg:sticky lg:top-6 lg:max-h-screen lg:overflow-y-auto lg:pr-2">
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
                  <div className="flex-1 ml-2.5 text-[10px] text-muted-foreground bg-background px-3 py-1 rounded-md border border-border truncate">
                    🔒 yooclaw.yookeer.com/p/...
                  </div>
                </div>

                {/* Preview body */}
                <div className="max-h-[calc(100vh-120px)] overflow-y-auto" style={{ background: pc.bg }}>
                  {/* Site header */}
                  <div
                    className="p-5 text-center relative overflow-hidden"
                    style={{
                      background: selectedTheme === 'tech-black'
                        ? 'linear-gradient(135deg, #0f172a, #1e293b)'
                        : selectedTheme === 'simple-white'
                          ? pc.bg
                          : template?.preview || 'linear-gradient(135deg, #2563eb, #1e40af)',
                      color: selectedTheme === 'simple-white' ? '#1a1a2e' : '#ffffff',
                      borderBottom: selectedTheme === 'simple-white' ? '2px solid #e5e7eb' : selectedTheme === 'tech-black' ? '2px solid #38bdf8' : 'none',
                    }}
                  >
                    <h3 className="text-lg font-extrabold tracking-tight">{siteName || '情报分析门户'}</h3>
                    {siteDesc && <p className="text-xs mt-1.5 opacity-75 max-w-lg mx-auto leading-relaxed">{siteDesc}</p>}
                  </div>

                  {/* Card row — centered, matches portal .card-row-wrap */}
                  <div className="flex justify-center gap-3 flex-wrap px-5 py-5">
                    {previewCards}
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-3 px-5 pb-3">
                    <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: pc.muted }}>报告输出</span>
                    <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${pc.border}, transparent)` }} />
                  </div>

                  {/* Content area placeholder */}
                  <div className="px-5 pb-8">
                    <div className="text-center py-12 rounded-xl border border-dashed mx-auto" style={{ borderColor: pc.border, background: pc.cardBg }}>
                      <div className="text-3xl mb-3 opacity-20" style={{ filter: 'grayscale(0.5)' }}>📄</div>
                      <p className="text-xs leading-relaxed" style={{ color: pc.muted }}>
                        选择一个 Widget 卡片开始分析
                      </p>
                      <p className="text-[10px] mt-1 opacity-50" style={{ color: pc.muted }}>
                        报告生成后将在此区域展示
                      </p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="text-center py-4 text-[10px]" style={{ color: pc.muted, borderTop: `1px solid ${pc.border}` }}>
                    Powered by YooClaw AI
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========== Add Widget Modal ========== */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowAddModal(false); setAddModalType(null) }}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Modal */}
            <div
              className="relative bg-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto w-full mx-4"
              style={{ maxWidth: addModalType === 'intel-monitor' ? 560 : 520 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/95 backdrop-blur-sm rounded-t-2xl">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-sm">
                    {addModalType === 'report-generator' ? '📊' : '🛰️'}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">
                      添加{addModalType === 'report-generator' ? '报告生成器' : '情报监控源'}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      {addModalType === 'report-generator' ? '配置 AI 自动生成分析报告' : '配置 AI 持续监控关键词情报'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowAddModal(false); setAddModalType(null) }}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                {addModalType === 'report-generator' && (
                  <>
                    {/* Title */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">报告标题</label>
                      <input
                        type="text"
                        value={addReportForm.title}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="行业分析报告"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      />
                    </div>

                    {/* Default Company */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">默认分析标的 (可选)</label>
                      <input
                        type="text"
                        value={addReportForm.defaultCompany}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, defaultCompany: e.target.value }))}
                        placeholder="如：阳光电源、宁德时代"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      />
                    </div>

                    {/* Analysis Methods */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">分析框架</label>
                      <div className="flex flex-wrap gap-1.5">
                        {ANALYSIS_METHODS.map((m) => (
                          <button
                            key={m}
                            onClick={() => setAddReportForm((f) => {
                              const methods = f.analysisMethods.includes(m)
                                ? f.analysisMethods.filter((x) => x !== m)
                                : [...f.analysisMethods, m]
                              return { ...f, analysisMethods: methods }
                            })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              addReportForm.analysisMethods.includes(m)
                                ? 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                                : 'bg-background border-border text-muted-foreground hover:border-violet-300'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Search Platform */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">搜索平台</label>
                      <select
                        value={addReportForm.searchPlatform}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, searchPlatform: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      >
                        {SEARCH_PLATFORMS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* API Key */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">API Key (可选)</label>
                      <input
                        type="text"
                        value={addReportForm.searchApiKey}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, searchApiKey: e.target.value }))}
                        placeholder="输入自定义 API Key…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      />
                    </div>

                    {/* System Prompt */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">系统提示词</label>
                      <textarea
                        value={addReportForm.sysPrompt}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, sysPrompt: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none"
                      />
                    </div>

                    {/* User Prompt */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">用户提示词</label>
                      <textarea
                        value={addReportForm.userPrompt}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, userPrompt: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none"
                      />
                    </div>
                  </>
                )}

                {addModalType === 'intel-monitor' && (
                  <>
                    {/* Title */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">监控源标题</label>
                      <input
                        type="text"
                        value={addMonitorForm.title}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="情报监控源"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      />
                    </div>

                    {/* Source Name */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">监控源名称</label>
                      <input
                        type="text"
                        value={addMonitorForm.sources[0]?.name || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({
                          ...f, sources: [{ ...f.sources[0], name: e.target.value }],
                        }))}
                        placeholder="如：光伏产业监控"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      />
                    </div>

                    {/* AI Provider & Model */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">AI 提供商</label>
                        <select
                          value={addMonitorForm.sources[0]?.aiProvider || 'deepseek'}
                          onChange={(e) => setAddMonitorForm((f) => ({
                            ...f, sources: [{ ...f.sources[0], aiProvider: e.target.value }],
                          }))}
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                        >
                          {AI_PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">AI 模型</label>
                        <input
                          type="text"
                          value={addMonitorForm.sources[0]?.aiModel || ''}
                          onChange={(e) => setAddMonitorForm((f) => ({
                            ...f, sources: [{ ...f.sources[0], aiModel: e.target.value }],
                          }))}
                          placeholder="如：deepseek-v3.1"
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                        />
                      </div>
                    </div>

                    {/* API Key */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">API Key (可选)</label>
                      <input
                        type="text"
                        value={addMonitorForm.sources[0]?.apiKey || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({
                          ...f, sources: [{ ...f.sources[0], apiKey: e.target.value }],
                        }))}
                        placeholder="输入自定义 API Key…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      />
                    </div>

                    {/* Keywords */}
                    <KeywordInput
                      keywords={addMonitorForm.sources[0]?.keywords || []}
                      sourceId={addMonitorForm.sources[0]?.id || 'modal'}
                      widgetId="modal"
                      onAdd={(_, __, keyword) => {
                        setAddMonitorForm((f) => {
                          const s = f.sources[0]
                          if (s.keywords.includes(keyword)) return f
                          return { ...f, sources: [{ ...s, keywords: [...s.keywords, keyword] }] }
                        })
                      }}
                      onRemove={(_, __, keyword) => {
                        setAddMonitorForm((f) => ({
                          ...f, sources: [{ ...f.sources[0], keywords: f.sources[0].keywords.filter((k) => k !== keyword) }],
                        }))
                      }}
                    />

                    {/* Update Frequency */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">更新频率</label>
                      <select
                        value={addMonitorForm.sources[0]?.updateFrequency || 'daily'}
                        onChange={(e) => setAddMonitorForm((f) => ({
                          ...f, sources: [{ ...f.sources[0], updateFrequency: e.target.value }],
                        }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all"
                      >
                        <option value="hourly">每小时</option>
                        <option value="daily">每天</option>
                        <option value="weekly">每周</option>
                        <option value="monthly">每月</option>
                      </select>
                    </div>

                    {/* Custom Prompt */}
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">自定义提示词</label>
                      <textarea
                        value={addMonitorForm.sources[0]?.customPrompt || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({
                          ...f, sources: [{ ...f.sources[0], customPrompt: e.target.value }],
                        }))}
                        rows={3}
                        placeholder="描述情报监控的具体要求…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border bg-card/95 backdrop-blur-sm rounded-b-2xl">
                <button
                  onClick={() => { setShowAddModal(false); setAddModalType(null) }}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmAddWidget}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                  确认添加
                </button>
              </div>
            </div>
          </div>
        )}

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
