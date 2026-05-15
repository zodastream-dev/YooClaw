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
    setAddMonitorForm({
      title: `情报监控源 #${widgets.filter((w) => w.type === 'intel-monitor').length + 1}`,
      sources: [{
        id: genId('s'),
        name: '新建监控源',
        aiProvider: 'deepseek',
        aiModel: 'deepseek-v3.1',
        apiKey: '',
        keywords: [],
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
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
            
      {/* LEFT: Preview (40%) */}
      <div className="xl:col-span-2 sticky top-6">
        <style>{`@keyframes cardIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
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

            {/* Card row */}
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
      {/* RIGHT: Builder (60%) */}
      <div className="xl:col-span-3 space-y-4 lg:min-w-0 lg:sticky lg:top-6 lg:max-h-screen lg:overflow-y-auto lg:pr-2">
        {/* Site Settings Card */}
        <div className="border border-border rounded-2xl p-5 bg-card shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
              <FileText size={16} className="text-violet-600" />
            </div>
            <span className="text-sm font-semibold">网站设置</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">网站名称</label>
              <input
                type="text" value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="给你的门户起个名字"
                className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                自定义链接 <span className="font-normal text-muted-foreground/60">选填</span>
              </label>
              <input
                type="text" placeholder="例如：my-portal"
                className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">网站描述</label>
            <input
              type="text" value={siteDesc}
              onChange={(e) => setSiteDesc(e.target.value)}
              placeholder="一句话介绍你的门户"
              className="w-full px-3.5 py-2.5 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>

          {/* Theme Selection */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
                <Palette size={14} className="text-violet-600" />
              </div>
              <span className="text-xs font-semibold">视觉主题</span>
              <span className="text-[11px] text-muted-foreground ml-1">{template?.name || '默认'}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
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
                  <div className="h-10 flex items-end p-2" style={{ background: t.preview }}>
                    <div className="flex gap-1">
                      <div className="w-3 h-1 rounded-full bg-white/30" />
                      <div className="w-2 h-1 rounded-full bg-white/20" />
                    </div>
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-semibold">{t.name}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Widget Modules */}
        <div className="border border-border rounded-2xl p-5 bg-card shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
                <BarChart3 size={16} className="text-violet-600" />
              </div>
              <span className="text-sm font-semibold">Widget 模块</span>
              <span className="text-[11px] text-muted-foreground ml-1">{widgets.length} 个</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <GripVertical size={12} /> 拖拽排序
            </div>
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
                      className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                      onClick={() => toggleWidget(w.id)}
                    >
                      <GripVertical size={14} className="text-muted-foreground flex-shrink-0" />
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs flex-shrink-0 ${
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
                      <div className="flex gap-1 flex-shrink-0 items-center">
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-violet-100 dark:bg-violet-900/20 text-violet-600 rounded-full">
                          {isReport ? '报告' : '监控'}
                        </span>
                        {isReport && methodCount > 0 && (
                          <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{methodCount} 框架</span>
                        )}
                        {isMonitor && kwCount > 0 && (
                          <span className="text-[10px] px-2 py-0.5 bg-muted rounded-full text-muted-foreground">{kwCount} 关键词</span>
                        )}
                      </div>
                      <div className="flex gap-0.5 flex-shrink-0">
                        <button
                          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                          disabled={i === 0}
                          onClick={(e) => { e.stopPropagation(); moveWidget(i, i - 1) }}
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                          disabled={i === widgets.length - 1}
                          onClick={(e) => { e.stopPropagation(); moveWidget(i, i + 1) }}
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 transition-colors"
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Widget 标题</label>
                                <input
                                  type="text" value={w.title}
                                  onChange={(e) => updateWidgetTitle(w.id, e.target.value)}
                                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">默认公司名</label>
                                <input
                                  type="text" value={w.config.defaultCompany || ''}
                                  placeholder="例如：宁德时代"
                                  onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, defaultCompany: e.target.value } }))}
                                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">分析框架</label>
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
                                      {m}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
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
                              <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">API Key</label>
                                <input
                                  type="password" value={w.config.searchApiKey || ''}
                                  placeholder="输入 API Key"
                                  onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, searchApiKey: e.target.value } }))}
                                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-1 focus:ring-violet-500/30"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">系统提示词</label>
                              <textarea
                                value={w.config.sysPrompt || ''}
                                onChange={(e) => updateWidget(w.id, (w) => ({ ...w, config: { ...w.config, sysPrompt: e.target.value } }))}
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
                            <div className="space-y-3">
                              {sources.map((s) => (
                                <div key={s.id} className="bg-muted/50 border border-border rounded-xl p-3 space-y-2">
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
                                          🔑 {s.keywords.length}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">名称</label>
                                      <input
                                        type="text" value={s.name}
                                        onChange={(e) => updateSourceField(w.id, s.id, 'name', e.target.value)}
                                        className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-violet-500/30"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">更新频率</label>
                                      <select
                                        value={s.updateFrequency}
                                        onChange={(e) => updateSourceField(w.id, s.id, 'updateFrequency', e.target.value)}
                                        className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-violet-500/30"
                                      >
                                        <option value="realtime">实时</option>
                                        <option value="hourly">每小时</option>
                                        <option value="daily">每天</option>
                                        <option value="weekly">每周</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">AI 接口</label>
                                      <select
                                        value={s.aiProvider}
                                        onChange={(e) => updateSourceField(w.id, s.id, 'aiProvider', e.target.value)}
                                        className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-violet-500/30"
                                      >
                                        {AI_PROVIDERS.map((p) => (
                                          <option key={p.value} value={p.value}>{p.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">AI 模型</label>
                                      <input
                                        type="text" value={s.aiModel || ''}
                                        placeholder="deepseek-v3.1"
                                        onChange={(e) => updateSourceField(w.id, s.id, 'aiModel', e.target.value)}
                                        className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:ring-1 focus:ring-violet-500/30"
                                      />
                                    </div>
                                  </div>
                                  <KeywordInput
                                    keywords={s.keywords}
                                    sourceId={s.id}
                                    widgetId={w.id}
                                    onAdd={addKeyword}
                                    onRemove={removeKeyword}
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      onClick={() => deleteMonitorSource(w.id, s.id)}
                                      className="px-2 py-1 text-[10px] font-medium text-red-600 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded hover:bg-red-100 transition-colors"
                                    >
                                      🗑 删除
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => addMonitorSource(w.id)}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-border rounded-lg text-xs text-muted-foreground hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50/30 transition-all"
                            >
                              <Plus size={12} /> 添加监控源
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
          <div className="border-2 border-dashed border-border rounded-xl p-4 text-center bg-muted/30 hover:border-violet-400 hover:bg-violet-50/30 transition-all">
            <div className="flex gap-2 justify-center flex-wrap">
              <button
                onClick={() => openAddModal('report-generator')}
                className="relative flex items-center gap-2 px-3 py-2.5 bg-card border border-border rounded-xl text-xs font-medium hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 transition-all group"
              >
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-violet-500 text-white flex items-center justify-center text-[9px] font-bold shadow-sm group-hover:scale-110 transition-transform">+</span>
                <span className="w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-xs">📊</span>
                <div className="text-left leading-tight">
                  <div className="font-semibold">报告生成器</div>
                </div>
              </button>
              <button
                onClick={() => openAddModal('intel-monitor')}
                className="relative flex items-center gap-2 px-3 py-2.5 bg-card border border-border rounded-xl text-xs font-medium hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all group"
              >
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-bold shadow-sm group-hover:scale-110 transition-transform">+</span>
                <span className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center text-xs">🛰️</span>
                <div className="text-left leading-tight">
                  <div className="font-semibold">情报监控源</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Deploy Card */}
        <div className="border-2 border-violet-300 dark:border-violet-800 rounded-2xl p-5 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 shadow-sm">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center">
              <Globe size={16} className="text-violet-600" />
            </div>
            <span className="text-sm font-semibold">确认并部署</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            一键生成完整的情报分析门户网站，部署到可公开访问的链接。
          </p>
          <div className="flex gap-3 mb-4 flex-wrap text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {reportCount} 个报告
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {monitorCount} 个监控
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
              {template?.name}
            </span>
          </div>
          <button
            onClick={handleDeploy}
            disabled={isDeploying}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-md shadow-violet-500/20"
          >
            {isDeploying ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                正在部署...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                一键部署情报分析门户
              </>
            )}
          </button>
          {error && (
            <div className="mt-3 p-2.5 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded-lg text-xs text-red-600">
              {error}
            </div>
          )}
        </div>
      </div>
