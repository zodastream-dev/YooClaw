import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { deployPortalWithWidgets } from '@/lib/api'
import {
  ArrowLeft, Globe, ExternalLink, Copy, Loader2,
  Plus, Trash2, X,
  Settings, LayoutGrid, GripVertical
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
  { id: 'intel-station', name: '酷炫风', desc: '暗色情报站，三段式布局', primary: '#00d4ff', preview: 'linear-gradient(135deg, #00d4ff, #a855f7)', textColor: '#e2e8f0', bg: '#020617', cardBg: '#0f172a', muted: '#94a3b8', border: 'rgba(255,255,255,0.1)', reportAccent: '#818cf8', monitorAccent: '#fbbf24', navBg: '#020617', heroBg: 'linear-gradient(135deg, #0f172a, #1e293b)' },
  { id: 'business-blue', name: '商务蓝', desc: '简洁专业，适合金融企业', primary: '#2563eb', preview: 'linear-gradient(135deg, #2563eb, #1e40af)', textColor: '#ffffff', bg: '#f8fafc', cardBg: '#ffffff', muted: '#64748b', border: '#e2e8f0', reportAccent: '#6366f1', monitorAccent: '#f59e0b', navBg: '#1e3a8a', heroBg: 'linear-gradient(135deg, #2563eb, #1e40af)' },
  { id: 'tech-black', name: '科技黑', desc: '深色炫酷，适合科技互联网', primary: '#38bdf8', preview: 'linear-gradient(135deg, #0f172a, #1e293b)', textColor: '#e2e8f0', bg: '#020617', cardBg: '#0f172a', muted: '#64748b', border: '#1e293b', reportAccent: '#818cf8', monitorAccent: '#fbbf24', navBg: '#020617', heroBg: 'linear-gradient(135deg, #0f172a, #1e293b)' },
  { id: 'simple-white', name: '简约白', desc: '极简留白，适合个人分析师', primary: '#1a1a2e', preview: '#ffffff', textColor: '#1a1a2e', bg: '#ffffff', cardBg: '#ffffff', muted: '#94a3b8', border: '#e5e7eb', reportAccent: '#6366f1', monitorAccent: '#f59e0b', navBg: '#f8fafc', heroBg: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)' },
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
      analysisMethods: ['SWOT', 'PEST'],
      searchPlatform: 'metaso',
      searchApiKey: '',
      sysPrompt: '你是一个行业研究分析师。',
      userPrompt: '请用 HTML 格式输出行业研究报告。',
    },
  },
  {
    id: 'w-2', type: 'intel-monitor', title: '行业情报监控', expanded: false,
    config: {
      sources: [
        {
          id: 's-1', name: '光伏产业监控', aiProvider: 'deepseek', aiModel: 'deepseek-v4-flash',
          apiKey: '', keywords: ['光伏', '太阳能', 'N型电池', 'TOPCon', 'HJT'],
          updateFrequency: 'daily', customPrompt: '你是新能源光伏行业专家。',
        },
        {
          id: 's-2', name: '储能市场追踪', aiProvider: 'metaso', aiModel: 'metaso-pro',
          apiKey: '', keywords: ['储能', '锂电池', '钠离子电池', '宁德时代'],
          updateFrequency: 'daily', customPrompt: '你是储能行业分析师。',
        },
      ],
    },
  },
]

// ========== KeywordInput Subcomponent ==========

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
    if (e.key === 'Enter') { e.preventDefault(); if (input.trim()) { onAdd(widgetId, sourceId, input); setInput('') } }
  }
  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted-foreground mb-1">监控关键词 <span className="font-normal opacity-60">按 Enter 添加</span></label>
      <div className="flex flex-wrap gap-1 mb-2">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-full text-[11px] font-medium">
            {k}<button onClick={() => onRemove(widgetId, sourceId, k)} className="ml-0.5 text-violet-400 hover:text-red-500">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="输入关键词…" className="flex-1 px-3 py-1.5 bg-background border border-dashed border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
        <button onClick={() => { if (input.trim()) { onAdd(widgetId, sourceId, input); setInput('') } }}
          className="px-2 py-1.5 border border-border rounded-lg text-[11px] font-medium hover:border-violet-400 transition-all">+</button>
      </div>
    </div>
  )
}

// ========== Main Component ==========

export function PortalBuilderPage() {
  const navigate = useNavigate()

  const [siteName, setSiteName] = useState('情报分析站')
  const [siteDesc, setSiteDesc] = useState('专注行业研究的AI驱动情报分析平台')
  const [selectedTheme, setSelectedTheme] = useState('intel-station')
  const [widgets, setWidgets] = useState<Widget[]>(initialWidgets)
  const [isDeploying, setIsDeploying] = useState(false)
  const [result, setResult] = useState<DeployResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deploySuccess, setDeploySuccess] = useState<{slug:string;url:string} | null>(null)
  const [dragIdx, setDragIdx] = useState(-1)

  // 三栏布局新增状态
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<'site' | 'widget'>('site')

  // ========== Add Widget Modal ==========
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalType, setAddModalType] = useState<'report-generator' | 'intel-monitor' | null>(null)
  const [addReportForm, setAddReportForm] = useState({
    title: '行业分析报告', defaultCompany: '',
    analysisMethods: ['SWOT', 'PEST'] as string[],
    searchPlatform: 'metaso', searchApiKey: '',
    sysPrompt: '你是一个行业研究分析师。', userPrompt: '请用 HTML 格式输出行业研究报告。',
  })
  const [addMonitorForm, setAddMonitorForm] = useState({
    title: '', sources: [{
      id: '', name: '新建监控源', aiProvider: 'deepseek', aiModel: 'deepseek-v3.1',
      apiKey: '', keywords: [] as string[], updateFrequency: 'daily', customPrompt: '',
    }],
  })

  const openAddModal = useCallback((type: 'report-generator' | 'intel-monitor') => {
    setAddReportForm({ title: '行业分析报告', defaultCompany: '', analysisMethods: ['SWOT', 'PEST'], searchPlatform: 'metaso', searchApiKey: '', sysPrompt: '你是一个行业研究分析师。', userPrompt: '请用 HTML 格式输出行业研究报告。' })
    const existingIntelCount = widgets.filter((w) => w.type === 'intel-monitor').length
    let defaultProvider = 'deepseek', defaultModel = 'deepseek-v3.1', defaultKeywords: string[] = []
    if (existingIntelCount === 0) { defaultKeywords = ['特朗普', 'Trump', '关税', '贸易战', '中美关系'] }
    else if (existingIntelCount === 1) { defaultProvider = 'metaso'; defaultModel = 'metaso-pro'; defaultKeywords = ['比亚迪', 'BYD', '电动汽车', '新能源车'] }
    setAddMonitorForm({ title: `情报监控源 #${existingIntelCount + 1}`, sources: [{ id: genId('s'), name: '新建监控源', aiProvider: defaultProvider, aiModel: defaultModel, apiKey: '', keywords: defaultKeywords, updateFrequency: 'daily', customPrompt: '' }] })
    setAddModalType(type)
    setShowAddModal(true)
  }, [widgets])

  const confirmAddWidget = useCallback(() => {
    if (addModalType === 'report-generator') {
      setWidgets((prev) => [...prev, { id: genId(), type: 'report-generator', title: addReportForm.title || '行业分析报告', expanded: false, config: { defaultCompany: addReportForm.defaultCompany, analysisMethods: addReportForm.analysisMethods, searchPlatform: addReportForm.searchPlatform, searchApiKey: addReportForm.searchApiKey, sysPrompt: addReportForm.sysPrompt, userPrompt: addReportForm.userPrompt } }])
    } else if (addModalType === 'intel-monitor') {
      setWidgets((prev) => [...prev, { id: genId(), type: 'intel-monitor', title: addMonitorForm.title || `情报监控源 #${widgets.filter((w) => w.type === 'intel-monitor').length + 1}`, expanded: false, config: { sources: addMonitorForm.sources.map((s) => ({ ...s, id: s.id || genId('s') })) } }])
    }
    setShowAddModal(false)
    setAddModalType(null)
  }, [addModalType, addReportForm, addMonitorForm, widgets])

  // ========== Widget Operations ==========
  const deleteWidget = useCallback((id: string) => {
    const w = widgets.find((w) => w.id === id)
    if (!w || !window.confirm(`确定删除「${w.title}」？此操作不可撤销。`)) return
    setWidgets((prev) => prev.filter((w) => w.id !== id))
    if (selectedWidgetId === id) { setSelectedWidgetId(null); setRightTab('site') }
  }, [widgets, selectedWidgetId])

  const updateWidget = useCallback((id: string, updater: (w: Widget) => Widget) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? updater(w) : w)))
  }, [])

  const moveWidget = useCallback((fromIdx: number, toIdx: number) => {
    setWidgets((prev) => { const arr = [...prev]; const [moved] = arr.splice(fromIdx, 1); arr.splice(toIdx, 0, moved); return arr })
  }, [])

  const handleDragStart = (e: React.DragEvent, idx: number) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)) }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const handleDrop = (e: React.DragEvent, idx: number) => { e.preventDefault(); if (dragIdx !== -1 && dragIdx !== idx) moveWidget(dragIdx, idx); setDragIdx(-1) }

  const handleWidgetClick = useCallback((id: string) => {
    setSelectedWidgetId(id)
    setRightTab('widget')
  }, [])

  const selectedWidget = useMemo(() => widgets.find((w) => w.id === selectedWidgetId) || null, [widgets, selectedWidgetId])

  // ========== Source Operations ==========
  const addMonitorSource = useCallback((widgetId: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      const sources = [...(w.config.sources || [])]
      sources.push({ id: genId('s'), name: `监控源 #${sources.length + 1}`, aiProvider: 'deepseek', aiModel: 'deepseek-v4-flash', apiKey: '', keywords: [], updateFrequency: 'daily', customPrompt: '' })
      return { ...w, config: { ...w.config, sources } }
    })
  }, [updateWidget])

  const deleteMonitorSource = useCallback((widgetId: string, sourceId: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).filter((s) => s.id !== sourceId) } }
    })
  }, [updateWidget])

  const updateSourceField = useCallback((widgetId: string, sourceId: string, field: keyof WidgetSource, value: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? { ...s, [field]: value } : s) } }
    })
  }, [updateWidget])

  const addKeyword = useCallback((widgetId: string, sourceId: string, keyword: string) => {
    const kw = keyword.trim()
    if (!kw) return
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? (s.keywords.includes(kw) ? s : { ...s, keywords: [...s.keywords, kw] }) : s) } }
    })
  }, [updateWidget])

  const removeKeyword = useCallback((widgetId: string, sourceId: string, keyword: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? { ...s, keywords: s.keywords.filter((k) => k !== keyword) } : s) } }
    })
  }, [updateWidget])

  const toggleMethod = useCallback((widgetId: string, method: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'report-generator') return w
      const methods = [...(w.config.analysisMethods || [])]
      const idx = methods.indexOf(method)
      if (idx > -1) methods.splice(idx, 1); else methods.push(method)
      return { ...w, config: { ...w.config, analysisMethods: methods } }
    })
  }, [updateWidget])

  // ========== Deploy ==========
  const handleDeploy = async () => {
    const name = siteName.trim() || '情报分析门户'
    setIsDeploying(true); setError(null); setResult(null)
    try {
      const res = await deployPortalWithWidgets(name, siteDesc.trim(), selectedTheme, widgets)
      if (res.data) {
        const portalUrl = window.location.origin + res.data.url
        window.open(portalUrl, '_blank')
        // 重置表单回初始建站页，显示成功横幅
        setSiteName('')
        setSiteDesc('')
        setCopied(false)
        setResult(null)
        setDeploySuccess({ slug: res.data.slug, url: res.data.url })
        setTimeout(() => setDeploySuccess(null), 5000)
      } else { setError(res.error?.message || '部署失败') }
    } catch (e: any) { setError(e.message || '部署失败') } finally { setIsDeploying(false) }
  }

  const handleCopy = async () => {
    if (!result) return
    const url = window.location.origin + result.url
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {
      const input = document.createElement('input'); input.value = url; document.body.appendChild(input); input.select(); document.execCommand('copy'); document.body.removeChild(input)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }
  }

  // ========== Theme ==========
  const theme = useMemo(() => TEMPLATES.find((t) => t.id === selectedTheme) || TEMPLATES[0], [selectedTheme])

  // ========== Build Mode ==========
  if (!result) {
    return (
      <div className="flex flex-col h-full overflow-hidden">

        {/* ========== Top Bar ========== */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-border bg-card z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/sites')} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={14} /> 返回
            </button>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center text-xs">🏗️</span>
              <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)}
                className="bg-transparent text-sm font-semibold border-none outline-none hover:bg-muted px-2 py-1 rounded-md transition-colors w-48"
                placeholder="站点名称" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 mr-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => setSelectedTheme(t.id)}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${selectedTheme === t.id ? 'border-foreground scale-110' : 'border-transparent opacity-50 hover:opacity-80'}`}
                  style={{ background: t.primary }} title={t.name} />
              ))}
            </div>
            <button onClick={handleDeploy} disabled={isDeploying}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold transition-colors">
              {isDeploying ? <><Loader2 size={13} className="animate-spin" /> 部署中…</> : <><Globe size={13} /> 部署门户</>}
            </button>
          </div>
        </div>

        {/* ========== Three Column Layout ========== */}
        <div className="flex flex-1 overflow-hidden">

          {/* ========== LEFT: Component Library + Widget List ========== */}
          <aside className="w-[280px] flex-shrink-0 flex flex-col border-r border-border bg-card overflow-hidden">

            {/* Component Library */}
            <div className="flex-shrink-0 p-4 border-b border-border">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">组件库</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => openAddModal('report-generator')}
                  className="aspect-square flex flex-col items-center justify-center gap-2 p-2.5 rounded-2xl border-2 border-border hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all text-center group">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/20 flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-110 transition-transform">📊</div>
                  <div>
                    <div className="text-[11px] font-semibold text-foreground group-hover:text-indigo-700 dark:group-hover:text-indigo-300">报告生成器</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">AI 自动生成分析报告</div>
                  </div>
                </button>
                <button onClick={() => openAddModal('intel-monitor')}
                  className="aspect-square flex flex-col items-center justify-center gap-2 p-2.5 rounded-2xl border-2 border-border hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all text-center group">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-110 transition-transform">🛰️</div>
                  <div>
                    <div className="text-[11px] font-semibold text-foreground group-hover:text-amber-700 dark:group-hover:text-amber-300">情报监控源</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">AI 持续监控关键词情报</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Widget List */}
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">我的组件</p>
              {widgets.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <div className="text-2xl mb-2 opacity-30">🧩</div>
                  <p className="text-[11px]">从上方添加组件</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {widgets.map((w, i) => (
                    <div key={w.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, i)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, i)}
                      className={`group rounded-2xl border-2 transition-all cursor-pointer aspect-square flex flex-col items-center justify-center gap-1.5 p-2.5 relative ${
                        selectedWidgetId === w.id
                          ? w.type === 'report-generator' ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20 shadow-md' : 'border-amber-400 bg-amber-50 dark:bg-amber-950/20 shadow-md'
                          : 'border-border hover:border-muted-foreground/40 bg-background hover:bg-muted/40'
                      }`}
                      onClick={() => handleWidgetClick(w.id)}
                    >
                      <div className="absolute top-1.5 right-1.5 text-muted-foreground/25 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical size={12} />
                      </div>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm ${
                        w.type === 'report-generator' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                      }`}>
                        {w.type === 'report-generator' ? '📊' : '🛰️'}
                      </div>
                      <div className="text-[11px] font-semibold text-center leading-tight line-clamp-2 px-1">{w.title}</div>
                      <div className="text-[9px] text-muted-foreground text-center">
                        {w.type === 'report-generator' ? (w.config.analysisMethods || []).slice(0, 2).join(' · ') : `${(w.config.sources || []).length}个源`}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteWidget(w.id) }}
                        className="absolute bottom-1.5 right-1.5 p-1 rounded-lg text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* ========== CENTER: Portal Preview ========== */}
          <main className="flex-1 overflow-auto bg-muted/30" style={{ minWidth: 0 }}>
            <div className="min-h-full flex items-start justify-center py-6 px-8">
              <div className="w-full" style={{ maxWidth: 960 }}>
                {/* Browser chrome */}
                <div className="rounded-t-xl border border-b-0 border-border bg-muted/80 px-4 py-2 flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 h-5 bg-background/60 rounded-md border border-border flex items-center px-2">
                    <span className="text-[10px] text-muted-foreground truncate">yooclaw.yookeer.com/p/preview</span>
                  </div>
                </div>
                {/* Portal content */}
                <div className="border border-border rounded-b-xl overflow-hidden shadow-xl" style={{ background: theme.bg, color: theme.textColor }}>
                  {/* Nav Bar */}
                  <nav className="h-11 flex items-center px-6 gap-6" style={{ background: theme.navBg }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: theme.textColor }}>🏢 {siteName}</span>
                    </div>
                    <div className="flex-1" />
                    {widgets.map((w) => (
                      <button key={w.id} className="text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity" style={{ color: theme.textColor }}>
                        {w.title}
                      </button>
                    ))}
                  </nav>
                  {/* Hero */}
                  <div className="px-8 py-10 text-center relative overflow-hidden" style={{ background: theme.heroBg }}>
                    <h1 className="text-2xl font-extrabold tracking-tight mb-2" style={{ color: theme.textColor }}>{siteName || '情报分析门户'}</h1>
                    {siteDesc && <p className="text-sm opacity-75 max-w-xl mx-auto leading-relaxed" style={{ color: theme.textColor }}>{siteDesc}</p>}
                    <div className="absolute bottom-0 left-0 right-0 h-px opacity-20" style={{ background: theme.textColor }} />
                  </div>
                  {/* Widget Cards / Layout Preview */}
                  <div className="px-8 py-8">
                    {selectedTheme === 'intel-station' ? (
                      /* 酷炫风三段式预览 */
                      <div className="rounded-xl border overflow-hidden" style={{ borderColor: theme.border, background: theme.bg, minHeight: 280 }}>
                        {/* Mock top bar */}
                        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: theme.border, background: theme.navBg }}>
                          <span className="text-[11px] font-bold" style={{ color: theme.primary }}>🚀 {siteName || '情报站'}</span>
                          <div className="flex gap-2">
                            <span className="text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(0,212,255,0.1)', color: theme.primary }}>全部</span>
                            <span className="text-[9px] px-2 py-0.5 rounded opacity-40" style={{ color: theme.textColor }}>新闻</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981' }} />
                            <span className="text-[9px] opacity-60" style={{ color: theme.textColor }}>实时监控</span>
                          </div>
                        </div>
                        {/* Mock 3-col layout */}
                        <div className="flex" style={{ minHeight: 220 }}>
                          {/* Left col */}
                          <div className="w-[28%] border-r p-3" style={{ borderColor: theme.border }}>
                            <div className="text-[9px] font-bold mb-2 uppercase tracking-wider opacity-60" style={{ color: theme.textColor }}>📡 情报过滤器</div>
                            <div className="space-y-1.5">
                              <div className="text-[9px] px-2 py-1 rounded border" style={{ borderColor: theme.border, background: 'rgba(255,255,255,0.03)' }}>
                                <span style={{ color: theme.primary }}>📰</span> <span style={{ color: theme.textColor }}>新闻资讯</span>
                              </div>
                              <div className="text-[9px] px-2 py-1 rounded border" style={{ borderColor: theme.border, background: 'rgba(255,255,255,0.03)' }}>
                                <span style={{ color: theme.primary }}>💬</span> <span style={{ color: theme.textColor }}>社交媒体</span>
                              </div>
                            </div>
                          </div>
                          {/* Center col */}
                          <div className="flex-1 p-3">
                            <div className="text-[9px] font-bold mb-2 uppercase tracking-wider opacity-60" style={{ color: theme.textColor }}>📊 动态情报流</div>
                            <div className="space-y-2">
                              <div className="text-[9px] p-2 rounded border" style={{ borderColor: theme.border, background: 'rgba(15,23,42,0.4)' }}>
                                <div className="flex justify-between mb-1"><span className="font-semibold" style={{ color: theme.textColor }}>光伏产业政策更新</span><span style={{ color: theme.primary }}>新闻</span></div>
                                <div className="opacity-60" style={{ color: theme.textColor }}>工信部发布最新光伏产业政策...</div>
                              </div>
                              <div className="text-[9px] p-2 rounded border" style={{ borderColor: theme.border, background: 'rgba(15,23,42,0.4)' }}>
                                <div className="flex justify-between mb-1"><span className="font-semibold" style={{ color: theme.textColor }}>储能技术突破</span><span style={{ color: theme.primary }}>新闻</span></div>
                                <div className="opacity-60" style={{ color: theme.textColor }}>新型钠离子电池能量密度提升...</div>
                              </div>
                            </div>
                          </div>
                          {/* Right col */}
                          <div className="w-[28%] border-l p-3" style={{ borderColor: theme.border }}>
                            <div className="text-[9px] font-bold mb-2 uppercase tracking-wider opacity-60" style={{ color: theme.textColor }}>🧠 AI 摘要看板</div>
                            <div className="space-y-2">
                              <div className="text-[9px] p-2 rounded border" style={{ borderColor: theme.border, background: 'rgba(0,212,255,0.03)' }}>
                                <div className="font-semibold mb-0.5" style={{ color: theme.primary }}>📈 情感分析</div>
                                <div className="opacity-60" style={{ color: theme.textColor }}>中性 52%</div>
                              </div>
                              <div className="text-[9px] p-2 rounded border" style={{ borderColor: theme.border, background: 'rgba(0,212,255,0.03)' }}>
                                <div className="font-semibold mb-0.5" style={{ color: theme.primary }}>🤖 AI 简报</div>
                                <div className="opacity-60" style={{ color: theme.textColor }}>正在分析情报数据...</div>
                              </div>
                            </div>
                          </div>
                        </div>
                        {/* Mock bottom bar */}
                        <div className="px-4 py-2 border-t flex items-center justify-center" style={{ borderColor: theme.border, background: 'rgba(2,6,23,0.98)' }}>
                          <div className="flex items-center gap-2 px-3 py-1 rounded-full text-[9px] w-full max-w-[280px]" style={{ border: `1px solid ${theme.primary}`, background: 'rgba(0,212,255,0.05)' }}>
                            <span className="opacity-40" style={{ color: theme.textColor }}>请在这里提问...</span>
                            <div className="flex-1" />
                            <span style={{ color: theme.primary }}>➤</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* 其他风格通用卡片预览 */
                      <>
                        {widgets.length > 0 ? (
                          <div className="flex flex-wrap gap-4 justify-center">
                            {widgets.map((w) => (
                              <div key={w.id} className="flex flex-col items-center gap-2 rounded-xl border p-4 cursor-pointer hover:shadow-md transition-all"
                                style={{ width: 200, background: theme.cardBg, borderColor: theme.border }}>
                                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base"
                                  style={{ background: w.type === 'report-generator' ? `linear-gradient(135deg, rgba(99,102,241,0.12), rgba(129,140,248,0.08))` : `linear-gradient(135deg, rgba(245,158,11,0.12), rgba(251,191,36,0.08))`, color: w.type === 'report-generator' ? theme.reportAccent : theme.monitorAccent }}>
                                  {w.type === 'report-generator' ? '📊' : '🛰️'}
                                </div>
                                <div className="text-xs font-bold text-center" style={{ color: theme.textColor }}>{w.title}</div>
                                <div className="text-[10px] text-center" style={{ color: theme.muted }}>
                                  {w.type === 'report-generator'
                                    ? (w.config.analysisMethods || []).slice(0, 2).join(' · ')
                                    : `${(w.config.sources || []).reduce((s, src) => s + src.keywords.length, 0)} 关键词 · ${(w.config.sources || [])[0]?.updateFrequency === 'daily' ? '每日' : (w.config.sources || [])[0]?.updateFrequency === 'realtime' ? '实时' : '每周'}更新`}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-12 rounded-xl border border-dashed" style={{ borderColor: theme.border }}>
                            <div className="text-3xl mb-2 opacity-30">🧩</div>
                            <p className="text-xs" style={{ color: theme.muted }}>从左侧添加组件开始构建</p>
                          </div>
                        )}
                        {/* Report output area */}
                        <div className="mt-8">
                          <div className="flex items-center gap-3 mb-4">
                            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: theme.muted }}>报告输出</span>
                            <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${theme.border}, transparent)` }} />
                          </div>
                          <div className="rounded-xl border border-dashed text-center py-12" style={{ borderColor: theme.border, background: theme.cardBg }}>
                            <div className="text-2xl mb-2 opacity-20">📄</div>
                            <p className="text-xs" style={{ color: theme.muted }}>点击上方组件开始分析</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {/* Footer */}
                  <div className="text-center py-4 text-[10px] border-t" style={{ color: theme.muted, borderColor: theme.border }}>
                    Powered by YooClaw AI · {new Date().getFullYear()}
                  </div>
                </div>
              </div>
            </div>
          </main>

          {/* ========== RIGHT: Configuration Panel ========== */}
          <aside className="w-[300px] flex-shrink-0 flex flex-col border-l border-border bg-card overflow-hidden">

            {/* Tab Bar */}
            <div className="flex-shrink-0 flex border-b border-border">
              <button onClick={() => setRightTab('site')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-colors ${rightTab === 'site' ? 'border-violet-500 text-violet-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                <Settings size={13} /> 站点配置
              </button>
              <button onClick={() => setRightTab('widget')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-colors ${rightTab === 'widget' ? 'border-violet-500 text-violet-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                <LayoutGrid size={13} /> 组件属性
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">

              {/* ===== SITE CONFIG TAB ===== */}
              {rightTab === 'site' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">网站标题</label>
                    <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)}
                      placeholder="情报分析门户"
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">网站描述</label>
                    <textarea value={siteDesc} onChange={(e) => setSiteDesc(e.target.value)} rows={2}
                      placeholder="描述你的门户…"
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-2">主题色</label>
                    <div className="grid grid-cols-3 gap-2">
                      {TEMPLATES.map((t) => (
                        <button key={t.id} onClick={() => setSelectedTheme(t.id)}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${selectedTheme === t.id ? 'border-violet-500' : 'border-border hover:border-muted-foreground/40'}`}>
                          <div className="w-8 h-8 rounded-full border border-black/10" style={{ background: t.preview }} />
                          <span className="text-[10px] font-medium">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleDeploy} disabled={isDeploying}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-xl text-xs font-semibold transition-colors">
                    {isDeploying ? <><Loader2 size={13} className="animate-spin" /> 部署中…</> : <><Globe size={13} /> 一键部署</>}
                  </button>
                  {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">{error}</p>}
                  {deploySuccess && (
                    <div className="flex items-center justify-between gap-2 text-xs bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg px-3 py-2">
                      <span>✅ 门户已成功部署！</span>
                      <a href={deploySuccess.url} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:opacity-80">查看</a>
                    </div>
                  )}
                </div>
              )}

              {/* ===== WIDGET CONFIG TAB ===== */}
              {rightTab === 'widget' && (
                !selectedWidget ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <LayoutGrid size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-xs">从左侧选择一个组件</p>
                    <p className="text-[11px] mt-1 opacity-60">点击组件列表中的任意项进行配置</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Widget header */}
                    <div className="flex items-center gap-2 pb-3 border-b border-border">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${selectedWidget.type === 'report-generator' ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                        {selectedWidget.type === 'report-generator' ? '📊' : '🛰️'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{selectedWidget.title}</div>
                        <div className="text-[10px] text-muted-foreground">{selectedWidget.type === 'report-generator' ? '报告生成器' : '情报监控源'}</div>
                      </div>
                      <button onClick={() => deleteWidget(selectedWidget.id)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Widget Title */}
                    <div>
                      <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">组件标题</label>
                      <input type="text" value={selectedWidget.title}
                        onChange={(e) => updateWidget(selectedWidget.id, (w) => ({ ...w, title: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
                    </div>

                    {/* Report Generator Config */}
                    {selectedWidget.type === 'report-generator' && (
                      <>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">默认分析标的</label>
                          <input type="text" value={selectedWidget.config.defaultCompany || ''}
                            onChange={(e) => updateWidget(selectedWidget.id, (w) => ({ ...w, config: { ...w.config, defaultCompany: e.target.value } }))}
                            placeholder="如：阳光电源"
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">分析框架</label>
                          <div className="flex flex-wrap gap-1.5">
                            {ANALYSIS_METHODS.map((m) => (
                              <button key={m}
                                onClick={() => toggleMethod(selectedWidget.id, m)}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${(selectedWidget.config.analysisMethods || []).includes(m) ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'bg-background border-border text-muted-foreground hover:border-indigo-300'}`}>{m}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">搜索平台</label>
                          <select value={selectedWidget.config.searchPlatform || ''}
                            onChange={(e) => updateWidget(selectedWidget.id, (w) => ({ ...w, config: { ...w.config, searchPlatform: e.target.value } }))}
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all">
                            {SEARCH_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">系统提示词</label>
                          <textarea value={selectedWidget.config.sysPrompt || ''}
                            onChange={(e) => updateWidget(selectedWidget.id, (w) => ({ ...w, config: { ...w.config, sysPrompt: e.target.value } }))}
                            rows={3} placeholder="AI 系统指令…"
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                        </div>
                      </>
                    )}

                    {/* Intel Monitor Config */}
                    {selectedWidget.type === 'intel-monitor' && (
                      <div className="space-y-4">
                        {(selectedWidget.config.sources || []).map((s) => (
                          <div key={s.id} className="rounded-xl border border-border p-3 space-y-3 bg-background/50">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-muted-foreground">{s.name}</span>
                              <button onClick={() => deleteMonitorSource(selectedWidget.id, s.id)}
                                className="text-[10px] text-red-500 hover:text-red-600">删除</button>
                            </div>
                            <input type="text" value={s.name}
                              onChange={(e) => updateSourceField(selectedWidget.id, s.id, 'name', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-[11px] outline-none focus:border-violet-400 transition-all" />
                            <div className="grid grid-cols-2 gap-2">
                              <select value={s.aiProvider}
                                onChange={(e) => updateSourceField(selectedWidget.id, s.id, 'aiProvider', e.target.value)}
                                className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-[11px] outline-none focus:border-violet-400 transition-all">
                                {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                              </select>
                              <input type="text" value={s.aiModel}
                                onChange={(e) => updateSourceField(selectedWidget.id, s.id, 'aiModel', e.target.value)}
                                placeholder="模型"
                                className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-[11px] outline-none focus:border-violet-400 transition-all" />
                            </div>
                            <KeywordInput
                              keywords={s.keywords} sourceId={s.id} widgetId={selectedWidget.id}
                              onAdd={addKeyword} onRemove={removeKeyword} />
                            <select value={s.updateFrequency}
                              onChange={(e) => updateSourceField(selectedWidget.id, s.id, 'updateFrequency', e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-[11px] outline-none focus:border-violet-400 transition-all">
                              <option value="hourly">每小时</option>
                              <option value="daily">每天</option>
                              <option value="weekly">每周</option>
                              <option value="monthly">每月</option>
                            </select>
                          </div>
                        ))}
                        <button onClick={() => addMonitorSource(selectedWidget.id)}
                          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-xl text-[11px] text-muted-foreground hover:border-violet-400 hover:text-violet-600 transition-all">
                          <Plus size={12} /> 添加监控源
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          </aside>
        </div>

        {/* ========== Add Widget Modal ========== */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowAddModal(false); setAddModalType(null) }}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative bg-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto w-full mx-4"
              style={{ maxWidth: addModalType === 'intel-monitor' ? 560 : 520 }}
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/95 backdrop-blur-sm rounded-t-2xl">
                <div className="flex items-center gap-2.5">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${addModalType === 'report-generator' ? 'bg-indigo-100 dark:bg-indigo-900/20' : 'bg-amber-100 dark:bg-amber-900/20'}`}>
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
                <button onClick={() => { setShowAddModal(false); setAddModalType(null) }} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X size={18} />
                </button>
              </div>
              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                {addModalType === 'report-generator' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">报告标题</label>
                      <input type="text" value={addReportForm.title}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="行业分析报告"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">默认分析标的 (可选)</label>
                      <input type="text" value={addReportForm.defaultCompany}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, defaultCompany: e.target.value }))}
                        placeholder="如：阳光电源、宁德时代"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">分析框架</label>
                      <div className="flex flex-wrap gap-1.5">
                        {ANALYSIS_METHODS.map((m) => (
                          <button key={m} onClick={() => setAddReportForm((f) => {
                            const methods = f.analysisMethods.includes(m) ? f.analysisMethods.filter((x) => x !== m) : [...f.analysisMethods, m]
                            return { ...f, analysisMethods: methods }
                          })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${addReportForm.analysisMethods.includes(m) ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'bg-background border-border text-muted-foreground hover:border-indigo-300'}`}>{m}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">搜索平台</label>
                      <select value={addReportForm.searchPlatform}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, searchPlatform: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        {SEARCH_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">API Key (可选)</label>
                      <input type="text" value={addReportForm.searchApiKey}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, searchApiKey: e.target.value }))}
                        placeholder="输入自定义 API Key…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">系统提示词</label>
                      <textarea value={addReportForm.sysPrompt}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, sysPrompt: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">用户提示词</label>
                      <textarea value={addReportForm.userPrompt}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, userPrompt: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                  </>
                )}
                {addModalType === 'intel-monitor' && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">监控源标题</label>
                      <input type="text" value={addMonitorForm.title}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="情报监控源"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">监控源名称</label>
                      <input type="text" value={addMonitorForm.sources[0]?.name || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], name: e.target.value }] }))}
                        placeholder="如：光伏产业监控"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">AI 提供商</label>
                        <select value={addMonitorForm.sources[0]?.aiProvider || 'deepseek'}
                          onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], aiProvider: e.target.value }] }))}
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                          {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">AI 模型</label>
                        <input type="text" value={addMonitorForm.sources[0]?.aiModel || ''}
                          onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], aiModel: e.target.value }] }))}
                          placeholder="如：deepseek-v3.1"
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">API Key (可选)</label>
                      <input type="text" value={addMonitorForm.sources[0]?.apiKey || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], apiKey: e.target.value }] }))}
                        placeholder="输入自定义 API Key…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
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
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">更新频率</label>
                      <select value={addMonitorForm.sources[0]?.updateFrequency || 'daily'}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], updateFrequency: e.target.value }] }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        <option value="hourly">每小时</option>
                        <option value="daily">每天</option>
                        <option value="weekly">每周</option>
                        <option value="monthly">每月</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">自定义提示词</label>
                      <textarea value={addMonitorForm.sources[0]?.customPrompt || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], customPrompt: e.target.value }] }))}
                        rows={3} placeholder="描述情报监控的具体要求…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                  </>
                )}
              </div>
              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border bg-card/95 backdrop-blur-sm rounded-b-2xl">
                <button onClick={() => { setShowAddModal(false); setAddModalType(null) }}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                  取消
                </button>
                <button onClick={confirmAddWidget}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm">
                  确认添加
                </button>
              </div>
            </div>
          </div>
        )}
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
              <Globe size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-green-600 dark:text-green-400">门户部署成功!</h2>
              <p className="text-xs text-muted-foreground">{result.title}</p>
            </div>
          </div>
          <div className="bg-muted rounded-lg p-4 mb-4">
            <p className="text-xs text-muted-foreground mb-2">访问链接</p>
            <div className="flex items-center gap-2">
              <a href={result.url} target="_blank" rel="noopener noreferrer"
                className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary hover:bg-primary/5 hover:border-primary/40 transition-all flex items-center gap-1.5">
                <ExternalLink size={13} className="flex-shrink-0" />
                <span className="truncate">{window.location.origin}{result.url}</span>
              </a>
              <button onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity">
                {copied ? '已复制' : <Copy size={14} />}
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <a href={result.url} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
              <ExternalLink size={16} /> 查看门户
            </a>
            <button onClick={() => { setResult(null); setSiteName(''); setSiteDesc(''); setCopied(false) }}
              className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
              再部署一个
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
