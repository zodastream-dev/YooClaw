import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { deployPortalWithWidgets, mpSubscribe, mpUnsubscribe, mpGetSubscriptions, mpQrLogin, mpCheckLogin, mpSearchByName, mpSubscribeByName } from '@/lib/api'
import {
  ArrowLeft, Globe, ExternalLink, Copy, Loader2,
  Plus, Trash2, X,
  Settings, GripVertical,
  Rss, BookOpen, AlertCircle, Check,
  QrCode, UserPlus, Search, Zap
} from 'lucide-react'

// ========== Types ==========

interface IntelObject {
  name: string
  keywords?: string[]
}

interface WidgetSource {
  id: string
  name: string
  aiProvider: string
  aiModel: string
  apiKey: string
  keywords: string[]
  objects?: IntelObject[]
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
  [key: string]: unknown
}

interface Widget {
  id: string
  type: 'report-generator' | 'intel-monitor'
  title: string
  expanded: boolean
  config: WidgetConfig
}

interface MpCandidate {
  id: string
  mpName: string
  mpCover: string
  mpIntro: string
  updateTime: number
  wxsLink: string
}

interface DeployResult {
  id: string
  slug: string
  title: string
  url: string
}

// ========== Templates ==========

const TEMPLATES = [
  { id: 'intel-station', name: '科技蓝', desc: '酷炫情报站，三段式布局', primary: '#00d4ff', preview: 'linear-gradient(135deg, #00d4ff, #a855f7)', textColor: '#e2e8f0', bg: '#020617', cardBg: '#0f172a', muted: '#94a3b8', border: 'rgba(255,255,255,0.1)', reportAccent: '#818cf8', monitorAccent: '#fbbf24', navBg: '#020617', heroBg: 'linear-gradient(135deg, #0f172a, #1e293b)' },
  { id: 'intel-station-white-base', name: '白色简约', desc: '酷炫情报站，三段式布局', primary: '#3b82f6', preview: 'linear-gradient(135deg, #f8fafc, #e2e8f0)', textColor: '#1e293b', bg: '#f8fafc', cardBg: '#ffffff', muted: '#64748b', border: 'rgba(0,0,0,0.06)', reportAccent: '#3b82f6', monitorAccent: '#8b5cf6', navBg: '#ffffff', heroBg: 'linear-gradient(135deg, #f1f5f9, #e0e7ff)' },
  { id: 'intel-station-sky-blue', name: '淡蓝科技', desc: '酷炫情报站，三段式布局', primary: '#0284c7', preview: 'linear-gradient(135deg, #f0f9ff, #bae6fd)', textColor: '#0c4a6e', bg: '#f0f9ff', cardBg: '#ffffff', muted: '#0369a1', border: 'rgba(14,165,233,0.15)', reportAccent: '#0284c7', monitorAccent: '#0ea5e9', navBg: '#ffffff', heroBg: 'linear-gradient(135deg, #e0f2fe, #bae6fd)' },
]

const AI_PROVIDERS = [
  { value: 'all', label: '🌐 全渠道 (推荐)' },
  { value: 'metaso', label: '秘塔 (Metaso)' },
  { value: 'tavily', label: 'Tavily Search' },
  { value: 'multi-engine', label: '多引擎搜索' },
  { value: 'wechat', label: '微信公众号' },
  { value: 'weibo', label: '微博' },
  { value: 'zhihu', label: '知乎' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'custom', label: '自定义 API' },
  { value: 'deepseek', label: 'DeepSeek (仅知识库)' },
]

const SEARCH_PLATFORMS = [
  { value: '', label: '默认 (CodeBuddy)' },
  { value: 'metaso', label: '秘塔 (Metaso)' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'deepseek', label: 'DeepSeek' },
]

const ANALYSIS_METHODS = ['SWOT', 'PEST', 'PORTER', '3C', 'STOCK']
const INTEL_CATEGORIES = ['行业信号', '目标客户情报', '竞争对手情报', '自身舆情监控']
const INTEL_PROMPTS: Record<string, string> = {
  '行业信号': '你是行业趋势研究分析师，专注于捕捉行业信号和宏观变化。\n\n重点关注的信号类型：\n- 技术突破：新技术、新标准、研发进展\n- 新品发布：产品迭代、型号更新、功能升级\n- 市场格局：出货量变化、市场份额转移、新进入者\n- 产业链：上下游供需变化、关键零部件动态\n- 政策法规：行业政策调整、监管动态、标准制定\n- 产业趋势：需求转移、商业模式创新、投资动向\n\n你的工作原则：\n- 优先关注「变化」而非「现状」\n- 每条信号需说明：变化是什么 → 影响哪些环节 → 时间窗口\n- 优先提供最近30天内的资讯，标注大致时间\n- 避免泛泛而谈，每条必须具体到可验证的事实或数据',
  '目标客户情报': '你是客户情报分析师，专注于追踪目标客户的动态和需求信号。\n你的工作原则：\n- 关注：采购行为、预算发布、业务扩张、人事变动、招标公告、技术选型\n- 每条情报需标注：客户名称 → 具体行为 → 潜在商机/风险\n- 优先关注可能转化为商业机会的信号\n- 如果信息不足以判断，明确标注"待进一步确认"',
  '竞争对手情报': '你是竞争情报分析师，专注于监控竞争对手的战略动向。\n你的工作原则：\n- 关注：产品发布、定价策略、市场份额、财报业绩、融资/IPO、高管变动、收购并购\n- 每条情报需分析：竞对做了什么 → 意图是什么 → 对我们有何影响\n- 区分「已确认」和「传闻」，标注信息可靠性\n- 优先提供知名来源的信息，避免小道消息',
  '自身舆情监控': '你是舆情监控分析师，专注于追踪品牌声誉和公众舆论。\n你的工作原则：\n- 关注：媒体报道倾向（正面/负面/中性）、社交媒体热议、用户投诉、监管动态\n- 每条舆情需标注：情感倾向（+/−/0）、传播热度、是否需要响应\n- 负面舆情需说明严重程度和建议处置优先级\n- 客观反映舆论全貌，避免报喜不报忧',
}

// ========== Helpers ==========

let idCounter = 10
function genId(prefix = 'w'): string {
  return `${prefix}-${idCounter++}`
}

// ========== Initial State ==========

const initialWidgets: Widget[] = []

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
  const addMultiple = (raw: string) => {
    const trimmed = raw.trim(); if (!trimmed) return
    const parts = trimmed.split(/[,，、\s]+/).filter(Boolean)
    parts.forEach((k) => onAdd(widgetId, sourceId, k))
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addMultiple(input); setInput('') }
  }
  return (
    <div>
      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">监控关键词 <span className="font-normal opacity-60">空格/逗号分隔批量添加</span></label>
      <div className="flex flex-wrap gap-1 mb-2">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-full text-[11px] font-medium">
            {k}<button onClick={() => onRemove(widgetId, sourceId, k)} className="ml-0.5 text-violet-400 hover:text-red-500">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="输入关键词…" className="flex-1 px-3 py-1.5 bg-background border border-dashed border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
        <button onClick={() => { addMultiple(input); setInput('') }}
          className="px-2 py-1.5 border border-violet-300 text-violet-600 rounded-lg text-[11px] font-medium hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all shrink-0">添加</button>
      </div>
    </div>
  )
}

// ========== Main Component ==========

export function PortalBuilderPage() {
  const navigate = useNavigate()

  const [siteName, setSiteName] = useState('情报分析站')
  const [siteDesc, setSiteDesc] = useState('专注行业研究的AI驱动情报分析平台')
  const [customDomain, setCustomDomain] = useState('')
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

  // ========== MP Subscription State ==========
  const [mpLink, setMpLink] = useState('')
  const [mpSubscribing, setMpSubscribing] = useState(false)
  const [mpError, setMpError] = useState<string | null>(null)
  const [mpSuccess, setMpSuccess] = useState<string | null>(null)
  const [mpSubscriptions, setMpSubscriptions] = useState<{ mpId: string; mpName: string; mpCover: string }[]>([])
  const [mpLoading, setMpLoading] = useState(true)

  // ========== MP Login State ==========
  const [mpLoggedIn, setMpLoggedIn] = useState(false)
  const [mpLoginStep, setMpLoginStep] = useState<'idle' | 'loading' | 'qr' | 'polling' | 'success' | 'error'>('idle')
  const [mpQrUrl, setMpQrUrl] = useState('')
  const [mpQrUuid, setMpQrUuid] = useState('')
  const [mpLoginError, setMpLoginError] = useState('')
  const [mpLoginUsername, setMpLoginUsername] = useState('')

  // ========== MP Search State ==========
  const [mpSubscribeTab, setMpSubscribeTab] = useState<'link' | 'name'>('link')
  const [mpSearchName, setMpSearchName] = useState('')
  const [mpSearching, setMpSearching] = useState(false)
  const [mpCandidates, setMpCandidates] = useState<MpCandidate[]>([])

  // ========== Edit Modal State ==========
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null)
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const editModalPanelRef = useRef<HTMLDivElement>(null)
  const editModalDragRef = useRef({ active: false, startX: 0, startY: 0, left: 0, top: 0 })
  const [expandedModelConfigs, setExpandedModelConfigs] = useState<Set<string>>(new Set())
  const toggleModelConfig = (id: string) => {
    setExpandedModelConfigs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const resetEditModalPosition = () => {
    if (editModalPanelRef.current) {
      editModalPanelRef.current.style.position = '';
      editModalPanelRef.current.style.left = '';
      editModalPanelRef.current.style.top = '';
      editModalPanelRef.current.style.transform = '';
      editModalPanelRef.current.style.margin = '';
    }
  }

  // ========== Quick Start State ==========
  const [showQuickStartModal, setShowQuickStartModal] = useState(false)

  // ========== Add Widget Modal ==========
  const [addModalObjectInput, setAddModalObjectInput] = useState('')
  const [addModalKeywordInput, setAddModalKeywordInput] = useState('')
  const [editModalObjectInput, setEditModalObjectInput] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalType, setAddModalType] = useState<'report-generator' | 'intel-monitor' | null>(null)
  const [addModalExpandedModel, setAddModalExpandedModel] = useState(false)
  const addModalPanelRef = useRef<HTMLDivElement>(null)
  const addModalDragRef = useRef({ active: false, startX: 0, startY: 0, left: 0, top: 0 })
  const resetAddModalPosition = () => {
    if (addModalPanelRef.current) {
      addModalPanelRef.current.style.position = '';
      addModalPanelRef.current.style.left = '';
      addModalPanelRef.current.style.top = '';
      addModalPanelRef.current.style.transform = '';
      addModalPanelRef.current.style.margin = '';
    }
  }
  const [addReportForm, setAddReportForm] = useState({
    title: '行业分析报告', defaultCompany: '',
    analysisMethods: ['SWOT', 'PEST'] as string[],
    searchPlatform: 'metaso', searchApiKey: '',
    sysPrompt: '你是一个行业研究分析师。', userPrompt: '请用 HTML 格式输出行业研究报告。',
  })
  const [addMonitorForm, setAddMonitorForm] = useState({
    title: '', sources: [{
      id: '', name: '新建监控源', aiProvider: 'all', aiModel: 'deepseek-v3.1',
      apiKey: '', keywords: [] as string[], objects: [] as IntelObject[], updateFrequency: 'daily', customPrompt: '',
    }],
  })

  const openAddModal = useCallback((type: 'report-generator' | 'intel-monitor') => {
    setAddReportForm({ title: '行业分析报告', defaultCompany: '', analysisMethods: ['SWOT', 'PEST'], searchPlatform: 'metaso', searchApiKey: '', sysPrompt: '你是一个行业研究分析师。', userPrompt: '请用 HTML 格式输出行业研究报告。' })
    const existingIntelCount = widgets.filter((w) => w.type === 'intel-monitor').length
    let defaultProvider = 'all', defaultModel = 'deepseek-v3.1', defaultKeywords: string[] = []
    if (existingIntelCount === 0) { defaultKeywords = ['特朗普', 'Trump', '关税', '贸易战', '中美关系'] }
    else if (existingIntelCount === 1) { defaultProvider = 'all'; defaultModel = 'metaso-pro'; defaultKeywords = ['比亚迪', 'BYD', '电动汽车', '新能源车'] }
    setAddMonitorForm({ title: '情报源', sources: [{ id: genId('s'), name: '行业信号', aiProvider: defaultProvider, aiModel: defaultModel, apiKey: '', keywords: defaultKeywords, objects: [], updateFrequency: 'daily', customPrompt: INTEL_PROMPTS['行业信号'] || '' }] })
    setAddModalObjectInput('')
    setAddModalKeywordInput('')
    setAddModalType(type)
    setShowAddModal(true)
  }, [widgets])

  const confirmAddWidget = useCallback(() => {
    if (addModalType === 'report-generator') {
      setWidgets((prev) => [...prev, { id: genId(), type: 'report-generator', title: addReportForm.title || '行业分析报告', expanded: false, config: { defaultCompany: addReportForm.defaultCompany, analysisMethods: addReportForm.analysisMethods, searchPlatform: addReportForm.searchPlatform, searchApiKey: addReportForm.searchApiKey, sysPrompt: addReportForm.sysPrompt, userPrompt: addReportForm.userPrompt } }])
    } else if (addModalType === 'intel-monitor') {
      // Flatten: add sources to first intel widget (auto-create if none)
      setWidgets((prev) => {
        const existing = prev.find((w) => w.type === 'intel-monitor')
        if (existing) {
          return prev.map((w) => w.id === existing.id
            ? { ...w, config: { ...w.config, sources: [...(w.config.sources || []), ...addMonitorForm.sources.map((s) => ({ ...s, id: s.id || genId('s') }))] } }
            : w)
        }
        return [...prev, { id: genId(), type: 'intel-monitor', title: '情报监控', expanded: false, config: { sources: addMonitorForm.sources.map((s) => ({ ...s, id: s.id || genId('s') })) } }]
      })
    }
    setShowAddModal(false)
    setAddModalType(null)
  }, [addModalType, addReportForm, addMonitorForm])

  // ========== Widget Operations ==========
  const deleteWidget = useCallback((id: string) => {
    const w = widgets.find((w) => w.id === id)
    if (!w || !window.confirm(`确定删除「${w.title}」？此操作不可撤销。`)) return
    setWidgets((prev) => prev.filter((w) => w.id !== id))
    if (selectedWidgetId === id) { setSelectedWidgetId(null); setEditingWidgetId(null); setEditingSourceId(null); setShowEditModal(false) }
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
    setEditingWidgetId(id)
    setShowEditModal(true)
  }, [])

  // ========== Source Operations ==========
  const addMonitorSource = useCallback((widgetId: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      const sources = [...(w.config.sources || [])]
      sources.push({ id: genId('s'), name: `监控源 #${sources.length + 1}`, aiProvider: 'all', aiModel: 'deepseek-v4-flash', apiKey: '', keywords: [], updateFrequency: 'daily', customPrompt: '' })
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

  // ===== Object Management =====
  const addObjectToSource = useCallback((widgetId: string, sourceId: string, objectName: string) => {
    const name = objectName.trim(); if (!name) return;
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? { ...s, objects: [...(s.objects || []), { name, keywords: [] }] } : s) } }
    })
  }, [updateWidget])

  const removeObjectFromSource = useCallback((widgetId: string, sourceId: string, objectName: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? { ...s, objects: (s.objects || []).filter((o) => o.name !== objectName) } : s) } }
    })
  }, [updateWidget])

  const addObjectKeyword = useCallback((widgetId: string, sourceId: string, objectName: string, keyword: string) => {
    const kw = keyword.trim(); if (!kw) return;
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? { ...s, objects: (s.objects || []).map((o) => o.name === objectName ? { ...o, keywords: [...(o.keywords || []), kw].filter((k, i, arr) => arr.indexOf(k) === i) } : o) } : s) } }
    })
  }, [updateWidget])

  const removeObjectKeyword = useCallback((widgetId: string, sourceId: string, objectName: string, keyword: string) => {
    updateWidget(widgetId, (w) => {
      if (w.type !== 'intel-monitor') return w
      return { ...w, config: { ...w.config, sources: (w.config.sources || []).map((s) => s.id === sourceId ? { ...s, objects: (s.objects || []).map((o) => o.name === objectName ? { ...o, keywords: (o.keywords || []).filter((k) => k !== keyword) } : o) } : s) } }
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
      const res = await deployPortalWithWidgets(name, siteDesc.trim(), selectedTheme, widgets, deploySuccess?.slug || undefined, customDomain)
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

  // ========== MP Subscription Handlers ==========

  const loadMpSubscriptions = useCallback(async () => {
    try {
      const res = await mpGetSubscriptions()
      if (res.data?.items) {
        setMpSubscriptions(res.data.items)
      }
    } catch { /* silently fail */ }
    finally { setMpLoading(false) }
  }, [])

  useEffect(() => { loadMpSubscriptions() }, [loadMpSubscriptions])

  // Edit modal drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!editModalDragRef.current.active) return;
      const panel = editModalPanelRef.current;
      if (!panel) return;
      const dx = e.clientX - editModalDragRef.current.startX;
      const dy = e.clientY - editModalDragRef.current.startY;
      panel.style.left = (editModalDragRef.current.left + dx) + 'px';
      panel.style.top = (editModalDragRef.current.top + dy) + 'px';
    };
    const onUp = () => { editModalDragRef.current.active = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);
  // Reset modal position when closed
  useEffect(() => {
    if (!showEditModal) resetEditModalPosition();
  }, [showEditModal]);

  // Add modal drag
  useEffect(() => {
    if (!showAddModal) { resetAddModalPosition(); setAddModalExpandedModel(false); return; }
    const onMove = (e: MouseEvent) => {
      if (!addModalDragRef.current.active) return;
      const panel = addModalPanelRef.current;
      if (!panel) return;
      const dx = e.clientX - addModalDragRef.current.startX;
      const dy = e.clientY - addModalDragRef.current.startY;
      panel.style.left = (addModalDragRef.current.left + dx) + 'px';
      panel.style.top = (addModalDragRef.current.top + dy) + 'px';
    };
    const onUp = () => { addModalDragRef.current.active = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [showAddModal]);

  const handleMpSubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    setMpError(null)
    setMpSuccess(null)
    const link = mpLink.trim()
    if (!link) { setMpError('请输入公众号文章链接'); return }
    if (!link.startsWith('https://mp.weixin.qq.com/s/')) {
      setMpError('请输入有效的公众号文章链接（以 https://mp.weixin.qq.com/s/ 开头）')
      return
    }
    setMpSubscribing(true)
    try {
      const res = await mpSubscribe(link)
      const data = res.data as { mpId: string; mpName: string; mpCover: string }
      setMpSuccess(`已订阅「${data.mpName}」`)
      setMpLink('')
      setMpSubscriptions((prev) => [...prev, data])
    } catch (e: any) {
      setMpError(e.message)
    } finally { setMpSubscribing(false) }
  }

  // ========== MP Login ==========
  const handleMpLogin = async () => {
    setMpLoginStep('loading')
    setMpLoginError('')
    try {
      const data = await mpQrLogin() as { data: { uuid: string; scanUrl: string } }
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.data.scanUrl)}`
      setMpQrUrl(qrUrl)
      setMpQrUuid(data.data.uuid)
      setMpLoginStep('qr')
    } catch (e: any) {
      setMpLoginError(e.message)
      setMpLoginStep('error')
    }
  }

  const handleMpStartPolling = useCallback(() => {
    if (!mpQrUuid) return
    setMpLoginStep('polling')
    const poll = async () => {
      try {
        const res = await mpCheckLogin(mpQrUuid) as { data: { status: string; username?: string; message?: string } }
        if (res.data.status === 'logged_in') {
          setMpLoginUsername(res.data.username || 'WeRead User')
          setMpLoginStep('success')
          setMpLoggedIn(true)
        } else if (res.data.status === 'timeout') {
          setMpLoginError('登录超时，请重新获取二维码')
          setMpLoginStep('error')
        } else {
          setTimeout(poll, 2000)
        }
      } catch (e: any) {
        setMpLoginError(e.message)
        setMpLoginStep('error')
      }
    }
    setTimeout(poll, 1000)
  }, [mpQrUuid])

  // ========== MP Search ==========
  const handleMpSearch = async () => {
    if (!mpSearchName.trim()) return
    setMpSearching(true)
    setMpError(null)
    setMpCandidates([])
    try {
      const res = await mpSearchByName(mpSearchName.trim()) as { data: { candidates: MpCandidate[] } }
      setMpCandidates(res.data.candidates || [])
      if (!res.data.candidates?.length) {
        setMpError('未找到相关公众号，请尝试其他关键词')
      }
    } catch (e: any) {
      setMpError(e.message)
    } finally {
      setMpSearching(false)
    }
  }

  const handleMpSubscribeByName = async (c: MpCandidate) => {
    setMpError(null)
    setMpSuccess(null)
    try {
      const res = await mpSubscribeByName({
        id: c.id, mpName: c.mpName, mpCover: c.mpCover, mpIntro: c.mpIntro, updateTime: c.updateTime,
      }) as { data: { mpId: string; mpName: string } }
      setMpSuccess(`已订阅「${res.data.mpName}」`)
      setMpSubscriptions((prev) => [...prev, { mpId: res.data.mpId, mpName: res.data.mpName, mpCover: c.mpCover }])
      setMpCandidates((prev) => prev.filter((x) => x.id !== c.id))
    } catch (e: any) {
      setMpError(e.message)
    }
  }

  // ========== Quick Start ==========
  const handleQuickStart = useCallback(() => {
    const id = genId()
    const newWidget: Widget = {
      id, type: 'intel-monitor', title: '情报监控', expanded: false,
      config: {
        sources: [
          { id: genId('s'), name: '行业信号', aiProvider: 'all', aiModel: 'deepseek-v4-flash', apiKey: '', keywords: ['技术突破', '新品发布', '出货量', '市场份额', '产业链', '行业报告', '政策法规', '产业趋势'], updateFrequency: 'daily', customPrompt: '你是行业趋势研究分析师，擅长捕捉行业信号和产业变化。' },
          { id: genId('s'), name: '目标客户情报', aiProvider: 'all', aiModel: 'deepseek-v4-flash', apiKey: '', keywords: ['客户需求', '采购意向', '客户动态', '客户预算', '招标公告'], updateFrequency: 'daily', customPrompt: '你是客户情报分析师，擅长追踪目标客户的需求和动态。' },
          { id: genId('s'), name: '竞争对手情报', aiProvider: 'all', aiModel: 'deepseek-v4-flash', apiKey: '', keywords: ['竞争对手', '市场份额', '产品发布', '战略布局', '财报业绩', '融资动态'], updateFrequency: 'daily', customPrompt: '你是竞争情报分析师，擅长监控竞争对手的战略动向。' },
          { id: genId('s'), name: '自身舆情监控', aiProvider: 'all', aiModel: 'deepseek-v4-flash', apiKey: '', keywords: ['舆情监控', '品牌声誉', '媒体报道', '用户评价', '社交媒体', '负面舆情'], updateFrequency: 'daily', customPrompt: '你是舆情监控分析师，擅长追踪品牌声誉和公众舆论。' },
        ],
      },
    }
    setWidgets((prev) => [...prev, newWidget])
    setShowQuickStartModal(false)
    setSelectedWidgetId(id)
    setEditingWidgetId(id)
    setShowEditModal(true)
  }, [])

  // ========== Edit Widget ==========
  const editingWidget = useMemo(() => widgets.find((w) => w.id === editingWidgetId) || null, [widgets, editingWidgetId])
  const editingSource = useMemo(() => {
    if (!editingWidget || !editingSourceId) return null
    return (editingWidget.config?.sources || []).find((s: WidgetSource) => s.id === editingSourceId) || null
  }, [editingWidget, editingSourceId])

  const handleMpUnsubscribe = async (mpId: string) => {
    try {
      await mpUnsubscribe(mpId)
      setMpSubscriptions((prev) => prev.filter((s) => s.mpId !== mpId))
    } catch (e: any) {
      setMpError(e.message)
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
              <span data-v="0527-0123" className="text-[10px] text-muted-foreground/40 font-mono select-none">v0527-0145</span>
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
                  className="relative aspect-square flex flex-col items-end justify-end p-3 rounded-2xl border-2 border-border hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all text-center group">
                  <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-indigo-500 text-white flex items-center justify-center text-2xl font-bold shadow-md group-hover:scale-110 transition-transform z-10">+</div>
                  <div className="w-full">
                    <div className="text-[11px] font-semibold text-foreground group-hover:text-indigo-700 dark:group-hover:text-indigo-300">报告生成器</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">AI 自动生成分析报告</div>
                  </div>
                </button>
                <button onClick={() => openAddModal('intel-monitor')}
                  className="relative aspect-square flex flex-col items-end justify-end p-3 rounded-2xl border-2 border-border hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-all text-center group">
                  <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center text-2xl font-bold shadow-md group-hover:scale-110 transition-transform z-10">+</div>
                  <div className="w-full">
                    <div className="text-[11px] font-semibold text-foreground group-hover:text-amber-700 dark:group-hover:text-amber-300">情报源</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight">持续监控关键词情报</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Intelligence Sources (flat, no widget container) */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">情报源</p>
                <button onClick={() => setShowQuickStartModal(true)}
                  className="text-[10px] font-medium text-violet-500 hover:text-violet-600 transition-colors flex items-center gap-1">
                  🚀 快速开始
                </button>
              </div>
              {/* Intel source cards — flat list, no widget container */}
              {(() => {
                const intelWidget = widgets.find((w) => w.type === 'intel-monitor')
                const sources = intelWidget ? (intelWidget.config.sources || []) : []
                if (sources.length === 0) {
                  return (
                    <div className="text-center py-6 text-muted-foreground">
                      <div className="text-2xl mb-2 opacity-30">📡</div>
                      <p className="text-[11px] mb-4">尚未添加情报源</p>
                      <button onClick={() => setShowQuickStartModal(true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white rounded-lg text-xs font-semibold transition-all shadow-md hover:shadow-lg">
                        🚀 快速开始
                      </button>
                    </div>
                  )
                }
                return (
                  <div className="space-y-2">
                    {sources.map((s) => (
                      <div key={s.id}
                        className={`rounded-xl border p-2.5 cursor-pointer transition-all ${
                          selectedWidgetId === intelWidget?.id ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/20' : 'border-border hover:border-violet-300 bg-background'
                        }`}
                        onClick={() => { setEditingWidgetId(intelWidget!.id); setEditingSourceId(s.id); setShowEditModal(true) }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${INTEL_CATEGORIES.includes(s.name) ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
                              {INTEL_CATEGORIES.includes(s.name) ? '🛰️' : '📌'}
                            </span>
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold truncate">{s.name || '未命名'}</div>
                              <div className="flex gap-2 text-[9px] text-muted-foreground mt-0.5">
                                <span>{s.aiProvider || 'deepseek'}</span>
                                <span>{(s.keywords || []).length} 关键词</span>
                                {(s.objects || []).length > 0 && <span className="text-purple-600 font-medium">{(s.objects || []).length} 对象</span>}
                              </div>
                            </div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); deleteMonitorSource(intelWidget!.id, s.id) }}
                            className="p-1 rounded text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash2 size={11} />
                          </button>
                        </div>
                        {(s.objects || []).length > 0 && (
                          <div className="flex gap-1 mt-1.5 flex-wrap">
                            {(s.objects || []).slice(0, 4).map((o) => (
                              <span key={o.name} className="px-1.5 py-0.5 rounded text-[9px] bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-medium">{o.name}</span>
                            ))}
                            {(s.objects || []).length > 4 && <span className="text-[9px] text-muted-foreground">+{(s.objects || []).length - 4}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}
              {/* Report generator cards — keep original */}
              {widgets.filter((w) => w.type === 'report-generator').length > 0 && (
                <>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 mt-4 text-center">报告组件</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {widgets.filter((w) => w.type === 'report-generator').map((w, i) => {
                      const realIdx = widgets.indexOf(w)
                      return (
                        <div key={w.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, realIdx)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, realIdx)}
                          className={`group rounded-2xl border-2 transition-all cursor-pointer aspect-square flex flex-col items-center justify-center gap-1.5 p-2.5 relative ${
                            selectedWidgetId === w.id ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20 shadow-md' : 'border-border hover:border-muted-foreground/40 bg-background hover:bg-muted/40'
                          }`}
                          onClick={() => handleWidgetClick(w.id)}
                        >
                          <div className="absolute top-1.5 right-1.5 text-muted-foreground/25 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity">
                            <GripVertical size={12} />
                          </div>
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600">📊</div>
                          <div className="text-[11px] font-semibold text-center leading-tight line-clamp-2 px-1">{w.title}</div>
                          <div className="text-[9px] text-muted-foreground text-center">{(w.config.analysisMethods || []).slice(0, 2).join(' · ')}</div>
                          <button onClick={(e) => { e.stopPropagation(); deleteWidget(w.id) }}
                            className="absolute bottom-1.5 right-1.5 p-1 rounded-lg text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {widgets.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <div className="text-2xl mb-2 opacity-30">🧩</div>
                  <p className="text-[11px]">从上方添加组件或情报源</p>
                </div>
              )}
            </div>

            {/* MP Subscription Section */}
            <div className="flex-shrink-0 border-t border-border p-4 overflow-y-auto">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">📡 公众号源</p>

              {/* Login Section */}
              {!mpLoggedIn && mpLoginStep !== 'success' && (
                <div className="border border-border rounded-xl p-3 bg-background/50 mb-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <UserPlus size={14} className="text-violet-500" />
                    <span className="text-[11px] font-semibold">绑定微信读书</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground mb-3 leading-relaxed">绑定后可使用链接或搜索两种方式订阅公众号</p>

                  {mpLoginStep === 'loading' ? (
                    <div className="flex items-center justify-center gap-1.5 py-4 text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" /> <span className="text-[10px]">生成二维码...</span>
                    </div>
                  ) : (mpLoginStep === 'qr' || mpLoginStep === 'polling') ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative">
                        <img src={mpQrUrl} alt="QR" className="w-[120px] h-[120px] rounded-lg border border-border bg-white" />
                        {mpLoginStep === 'polling' && (
                          <div className="absolute inset-0 bg-background/80 rounded-lg flex items-center justify-center">
                            <div className="flex flex-col items-center gap-1">
                              <Loader2 size={16} className="animate-spin text-violet-500" />
                              <span className="text-[9px] text-muted-foreground">等待扫码...</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground text-center">请用微信读书 APP 扫码</p>
                      <div className="flex gap-1.5">
                        <button onClick={handleMpStartPolling} disabled={mpLoginStep === 'polling'}
                          className="px-3 py-1.5 text-[10px] rounded-lg bg-violet-600 text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                          {mpLoginStep === 'polling' ? '等待中...' : '已扫码，检测'}
                        </button>
                        <button onClick={() => { setMpLoginStep('idle'); setMpQrUrl(''); setMpQrUuid('') }}
                          className="px-3 py-1.5 text-[10px] rounded-lg border border-border hover:bg-muted transition-colors">
                          重新获取
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={handleMpLogin}
                      className="w-full py-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 text-white text-[11px] font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5">
                      <QrCode size={12} /> 获取二维码登录
                    </button>
                  )}

                  {mpLoginError && (
                    <div className="flex items-center gap-1 mt-2 p-1.5 rounded bg-red-50 dark:bg-red-950/20 text-red-600 text-[9px]">
                      <AlertCircle size={10} className="flex-shrink-0" /> {mpLoginError}
                    </div>
                  )}
                </div>
              )}

              {/* Logged In: Tab + Subscribe */}
              {(mpLoggedIn || mpLoginStep === 'success') && (
                <>
                  {/* Tab Switch */}
                  <div className="flex rounded-lg border border-border bg-muted/50 p-0.5 mb-3">
                    <button onClick={() => { setMpSubscribeTab('link'); setMpError(null); setMpSuccess(null) }}
                      className={`flex-1 py-1.5 text-[10px] font-medium rounded-md transition-all ${mpSubscribeTab === 'link' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>
                      📎 链接
                    </button>
                    <button onClick={() => { setMpSubscribeTab('name'); setMpError(null); setMpCandidates([]) }}
                      className={`flex-1 py-1.5 text-[10px] font-medium rounded-md transition-all ${mpSubscribeTab === 'name' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>
                      🔍 名称
                    </button>
                  </div>

                  {/* Link Subscribe */}
                  {mpSubscribeTab === 'link' && (
                    <form onSubmit={handleMpSubscribe} className="flex gap-1.5 mb-3">
                      <input type="url" value={mpLink} onChange={(e) => setMpLink(e.target.value)}
                        placeholder="粘贴文章链接…"
                        className="flex-1 px-2.5 py-1.5 bg-background border border-dashed border-border rounded-lg text-[11px] outline-none focus:border-violet-400 transition-all"
                        disabled={mpSubscribing} />
                      <button type="submit" disabled={mpSubscribing || !mpLink.trim()}
                        className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1">
                        {mpSubscribing ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                        订阅
                      </button>
                    </form>
                  )}

                  {/* Name Search */}
                  {mpSubscribeTab === 'name' && (
                    <div className="mb-3">
                      <div className="flex gap-1.5 mb-2">
                        <input type="text" value={mpSearchName} onChange={(e) => setMpSearchName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMpSearch() }}
                          placeholder="输入公众号名称..."
                          className="flex-1 px-2.5 py-1.5 bg-background border border-dashed border-border rounded-lg text-[11px] outline-none focus:border-violet-400 transition-all"
                          disabled={mpSearching} />
                        <button onClick={handleMpSearch} disabled={mpSearching || !mpSearchName.trim()}
                          className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1">
                          {mpSearching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                          搜索
                        </button>
                      </div>
                      {/* Search Results */}
                      {mpCandidates.length > 0 && (
                        <div className="space-y-1 max-h-[150px] overflow-y-auto mb-2">
                          {mpCandidates.map((c) => (
                            <div key={c.id} className="flex items-center gap-2 p-1.5 rounded-lg border border-border bg-background/50">
                              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-violet-400/20 to-violet-600/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {c.mpCover ? <img src={c.mpCover} alt={c.mpName} className="w-full h-full object-cover" />
                                : <BookOpen size={11} className="text-violet-500" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-medium truncate">{c.mpName}</div>
                                <div className="text-[8px] text-muted-foreground truncate">{c.mpIntro}</div>
                              </div>
                              <button onClick={() => handleMpSubscribeByName(c)}
                                className="px-2 py-1 text-[9px] rounded bg-violet-100 dark:bg-violet-900/20 text-violet-600 hover:bg-violet-200 transition-colors flex-shrink-0">
                                订阅
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status Messages */}
                  {mpError && (
                    <div className="flex items-center gap-1.5 mb-2 p-1.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/20 text-red-600 dark:text-red-400 text-[9px]">
                      <AlertCircle size={10} className="flex-shrink-0" /> {mpError}
                    </div>
                  )}
                  {mpSuccess && (
                    <div className="flex items-center gap-1.5 mb-2 p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/20 text-emerald-600 dark:text-emerald-400 text-[9px]">
                      <Check size={10} className="flex-shrink-0" /> {mpSuccess}
                    </div>
                  )}
                </>
              )}

              {/* Subscription List */}
              {mpLoading ? (
                <div className="flex items-center justify-center gap-1.5 py-3 text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-[10px]">加载订阅…</span>
                </div>
              ) : mpSubscriptions.length === 0 ? (
                <div className="text-center py-2">
                  <Rss size={16} className="mx-auto text-muted-foreground/30 mb-1" />
                  <p className="text-[9px] text-muted-foreground">暂无公众号订阅</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[150px] overflow-y-auto">
                  {mpSubscriptions.map((sub) => (
                    <div key={sub.mpId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors group">
                      <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-400/20 to-violet-600/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {sub.mpCover ? <img src={sub.mpCover} alt={sub.mpName} className="w-full h-full object-cover" />
                        : <BookOpen size={11} className="text-violet-500" />}
                      </div>
                      <span className="flex-1 text-[10px] font-medium truncate">{sub.mpName}</span>
                      <button onClick={() => handleMpUnsubscribe(sub.mpId)}
                        className="p-0.5 rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all"
                        title="取消订阅">
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
                    {selectedTheme.startsWith('intel-station') ? (
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

            {/* Header */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border">
              <Settings size={13} className="text-violet-500" />
              <span className="text-xs font-semibold">站点配置</span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
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
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">自定义域名 <span className="text-[9px] text-muted-foreground font-normal">(选填)</span></label>
                  <input type="text" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)}
                    placeholder="如：portal.example.com"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
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
            </div>
          </aside>
        </div>

        {/* ========== Quick Start Confirm Modal ========== */}
        <AnimatePresence>
          {showQuickStartModal && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowQuickStartModal(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
              <motion.div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
              <div className="px-7 py-6">
                <div className="flex items-center gap-3 mb-5">
                  <span className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-2xl shadow-lg shadow-violet-500/20">🚀</span>
                  <div>
                    <h3 className="text-lg font-bold">快速开始</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">一键创建情报监控组件，包含 4 个预配置情报源</p>
                  </div>
                </div>

                <div className="bg-muted/40 rounded-xl p-5 mb-4">
                  <p className="text-sm font-semibold text-muted-foreground mb-3.5">📡 预配置情报源：</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { icon: '📊', name: '行业信号', desc: '追踪行业趋势、政策法规、技术突破等' },
                      { icon: '🎯', name: '目标客户情报', desc: '监控客户需求、采购意向、招标公告等' },
                      { icon: '⚔️', name: '竞争对手情报', desc: '跟踪市场份额、产品发布、财报等' },
                      { icon: '🛡️', name: '自身舆情监控', desc: '监控品牌声誉、媒体报道、负面舆情等' },
                    ].map((s) => (
                      <div key={s.name} className="flex items-start gap-2.5 bg-background/60 rounded-lg px-3.5 py-3">
                        <span className="text-base flex-shrink-0 mt-0.5">{s.icon}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{s.name}</div>
                          <div className="text-xs text-muted-foreground leading-relaxed mt-1">{s.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-violet-500/5 to-purple-500/5 border border-violet-500/20 rounded-xl p-5 mb-5">
                  <p className="text-sm font-semibold mb-3.5 text-violet-600 dark:text-violet-400">💡 点击「一键创建」后将：</p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/15 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 text-violet-600 dark:text-violet-400">1</span>
                      <div>
                        <p className="text-sm font-medium">自动创建情报监控组件</p>
                        <p className="text-xs text-muted-foreground mt-0.5">包含上述 4 个情报源，已预填关键词和 AI 提示词</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/15 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 text-violet-600 dark:text-violet-400">2</span>
                      <div>
                        <p className="text-sm font-medium">自动打开编辑面板</p>
                        <p className="text-xs text-muted-foreground mt-0.5">你可以按需修改关键词、调整提示词、增删情报源</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-violet-500/15 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 text-violet-600 dark:text-violet-400">3</span>
                      <div>
                        <p className="text-sm font-medium">配置完成后发布门户</p>
                        <p className="text-xs text-muted-foreground mt-0.5">保存设置后点击「生成门户」即可部署上线</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2.5">
                  <button onClick={() => setShowQuickStartModal(false)}
                    className="px-5 py-2.5 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                    取消
                  </button>
                  <button onClick={handleQuickStart}
                    className="px-6 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white rounded-lg text-sm font-bold transition-all shadow-md hover:shadow-lg">
                    🚀 一键创建
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>

        {/* ========== Edit Widget Modal ========== */}
        <AnimatePresence>
          {showEditModal && editingWidget && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowEditModal(false); setEditingWidgetId(null); setEditingSourceId(null) }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            <motion.div className="relative bg-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto w-full mx-4 max-w-2xl"
              ref={editModalPanelRef}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/95 backdrop-blur-sm rounded-t-2xl cursor-move select-none"
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  const panel = editModalPanelRef.current;
                  if (!panel) return;
                  const rect = panel.getBoundingClientRect();
                  editModalDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
                  panel.style.position = 'absolute';
                  panel.style.left = rect.left + 'px';
                  panel.style.top = rect.top + 'px';
                  panel.style.transform = 'none';
                  panel.style.margin = '0';
                  panel.style.transition = 'none';
                  e.preventDefault();
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm bg-amber-100 dark:bg-amber-900/20">
                    {editingSource ? '🛰️' : (editingWidget.type === 'report-generator' ? '📊' : '🛰️')}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">
                      {editingSource ? `编辑情报源「${editingSource.name || '未命名'}」` : `编辑「${editingWidget.title}」`}
                    </h3>
                    <p className="text-[11px] text-muted-foreground">{editingSource ? '情报监控源' : (editingWidget.type === 'report-generator' ? '报告生成器' : '情报监控源')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {editingSource && (
                    <button onClick={() => { if (confirm(`确认删除情报源「${editingSource.name}」？此操作不可撤销。`)) { deleteMonitorSource(editingWidget.id, editingSource.id); setShowEditModal(false); setEditingWidgetId(null); setEditingSourceId(null) } }}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" title="删除此情报源">
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button onClick={() => { setShowEditModal(false); setEditingWidgetId(null); setEditingSourceId(null) }}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                {editingSource ? (
                  <div className="space-y-4">
                    {/* Source Name */}
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">情报属性</label>
                      <select value={INTEL_CATEGORIES.includes(editingSource.name) ? editingSource.name : '__custom__'}
                        onChange={(e) => {
                          const val = e.target.value === '__custom__' ? '' : e.target.value;
                          updateSourceField(editingWidget.id, editingSource.id, 'name', val);
                          if (val && INTEL_PROMPTS[val]) {
                            updateSourceField(editingWidget.id, editingSource.id, 'customPrompt', INTEL_PROMPTS[val]);
                          }
                        }}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        <option value="">-- 选择情报属性 --</option>
                        {INTEL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="__custom__">自定义…</option>
                      </select>
                      {!INTEL_CATEGORIES.includes(editingSource.name) && (
                        <input type="text" value={editingSource.name}
                          onChange={(e) => updateSourceField(editingWidget.id, editingSource.id, 'name', e.target.value)}
                          placeholder="输入自定义属性名称" className="w-full mt-2 px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                      )}
                    </div>

                    {/* Objects */}
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">📌 监控对象</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(editingSource.objects || []).filter(o => o.name).map((obj: any) => (
                          <span key={obj.name} className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-purple-100 dark:bg-purple-900/20 text-xs text-purple-700 dark:text-purple-300 font-medium">
                            {obj.name}
                            <button onClick={() => removeObjectFromSource(editingWidget.id, editingSource.id, obj.name)} className="hover:text-red-500 ml-0.5">&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input value={editModalObjectInput}
                          onChange={(e) => setEditModalObjectInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const names = editModalObjectInput.split(/[,，、/\s]+/).filter(Boolean); if (names.length > 0) { names.forEach(n => addObjectToSource(editingWidget.id, editingSource.id, n)); setEditModalObjectInput(''); } } }}
                          placeholder="输入对象名称（空格/,/逗号分隔可批量添加）" className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg outline-none focus:border-purple-400 transition-all bg-transparent" />
                        <button onClick={() => { const names = editModalObjectInput.split(/[,，、/\s]+/).filter(Boolean); if (names.length > 0) { names.forEach(n => addObjectToSource(editingWidget.id, editingSource.id, n)); setEditModalObjectInput(''); } }}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-purple-300 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors shrink-0">添加</button>
                      </div>
                    </div>

                    {/* Keywords */}
                    <KeywordInput
                      keywords={editingSource.keywords} sourceId={editingSource.id} widgetId={editingWidget.id}
                      onAdd={addKeyword} onRemove={removeKeyword} />

                    {/* Update Frequency */}
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">更新频率</label>
                      <select value={editingSource.updateFrequency}
                        onChange={(e) => updateSourceField(editingWidget.id, editingSource.id, 'updateFrequency', e.target.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        <option value="hourly">每小时</option>
                        <option value="daily">每天</option>
                        <option value="weekly">每周</option>
                        <option value="monthly">每月</option>
                      </select>
                    </div>

                    {/* Custom Prompt */}
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">自定义提示词</label>
                      <textarea value={editingSource.customPrompt}
                        onChange={(e) => updateSourceField(editingWidget.id, editingSource.id, 'customPrompt', e.target.value)}
                        rows={6} placeholder="自定义提示词…" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>

                    {/* Model Config (collapsed by default) */}
                    <div className="border-t border-border pt-3">
                      <button type="button" onClick={() => toggleModelConfig(editingSource.id)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1">
                        <span>{expandedModelConfigs.has(editingSource.id) ? '▼' : '▶'}</span> ⚙ 模型配置（高级）
                      </button>
                      {expandedModelConfigs.has(editingSource.id) && (
                        <div className="mt-2 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-semibold text-muted-foreground mb-1.5">AI 引擎</label>
                              <select value={editingSource.aiProvider}
                                onChange={(e) => updateSourceField(editingWidget.id, editingSource.id, 'aiProvider', e.target.value)}
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                                {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-muted-foreground mb-1.5">AI 模型</label>
                              <input type="text" value={editingSource.aiModel}
                                onChange={(e) => updateSourceField(editingWidget.id, editingSource.id, 'aiModel', e.target.value)}
                                placeholder="deepseek-v4-flash" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-muted-foreground mb-1.5">API Key（可选）</label>
                            <input type="text" value={editingSource.apiKey || ''}
                              onChange={(e) => updateSourceField(editingWidget.id, editingSource.id, 'apiKey', e.target.value)}
                              placeholder="留空使用默认密钥" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                <>
                {/* Widget Title */}
                <div>
                  <label className="block text-sm font-semibold text-muted-foreground mb-1.5">组件标题</label>
                  <input type="text" value={editingWidget.title}
                    onChange={(e) => updateWidget(editingWidget.id, (w) => ({ ...w, title: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                </div>

                {/* Report Generator Config */}
                {editingWidget.type === 'report-generator' && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">默认分析标的</label>
                      <input type="text" value={editingWidget.config.defaultCompany || ''}
                        onChange={(e) => updateWidget(editingWidget.id, (w) => ({ ...w, config: { ...w.config, defaultCompany: e.target.value } }))}
                        placeholder="如：阳光电源"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">分析框架</label>
                      <div className="flex flex-wrap gap-1.5">
                        {ANALYSIS_METHODS.map((m) => (
                          <button key={m}
                            onClick={() => toggleMethod(editingWidget.id, m)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${(editingWidget.config.analysisMethods || []).includes(m) ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'bg-background border-border text-muted-foreground hover:border-indigo-300'}`}>{m}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">搜索平台</label>
                      <select value={editingWidget.config.searchPlatform || ''}
                        onChange={(e) => updateWidget(editingWidget.id, (w) => ({ ...w, config: { ...w.config, searchPlatform: e.target.value } }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        {SEARCH_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">系统提示词</label>
                      <textarea value={editingWidget.config.sysPrompt || ''}
                        onChange={(e) => updateWidget(editingWidget.id, (w) => ({ ...w, config: { ...w.config, sysPrompt: e.target.value } }))}
                        rows={6} placeholder="AI 系统指令…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">用户提示词</label>
                      <textarea value={editingWidget.config.userPrompt || ''}
                        onChange={(e) => updateWidget(editingWidget.id, (w) => ({ ...w, config: { ...w.config, userPrompt: e.target.value } }))}
                        rows={6} placeholder="用户指令…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                  </>
                )}

                {/* Intel Monitor Config */}
                {editingWidget.type === 'intel-monitor' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {(editingWidget.config.sources || []).map((s) => (
                        <div key={s.id} className="col-span-2 rounded-xl border border-border p-3 space-y-2.5 bg-background/50">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-muted-foreground">{s.name}</span>
                            <button onClick={() => { if (confirm(`确认删除情报源「${s.name}」？此操作不可撤销。`)) deleteMonitorSource(editingWidget.id, s.id) }}
                              className="px-2 py-1 text-[11px] font-medium rounded-md border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">🗑 删除</button>
                          </div>
                          <select value={INTEL_CATEGORIES.includes(s.name) ? s.name : '__custom__'}
                            onChange={(e) => {
                              const val = e.target.value === '__custom__' ? '' : e.target.value;
                              updateSourceField(editingWidget.id, s.id, 'name', val);
                              if (val && INTEL_PROMPTS[val]) {
                                updateSourceField(editingWidget.id, s.id, 'customPrompt', INTEL_PROMPTS[val]);
                              }
                            }}
                            className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all">
                            <option value="">-- 选择情报属性 --</option>
                            {INTEL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            <option value="__custom__">自定义…</option>
                          </select>
                          {!INTEL_CATEGORIES.includes(s.name) && (
                            <input type="text" value={s.name}
                              onChange={(e) => updateSourceField(editingWidget.id, s.id, 'name', e.target.value)}
                              placeholder="输入自定义属性名称"
                              className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
                          )}
                          {/* --- Object Management --- */}
                          <div className="space-y-2">
                            <span className="text-[11px] font-semibold text-muted-foreground">📌 监控对象</span>
                            <div className="flex flex-wrap gap-1.5">
                              {(s.objects || []).filter(o => o.name).map((obj) => (
                                <span key={obj.name} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/20 text-[11px] text-purple-700 dark:text-purple-300 font-medium">
                                  {obj.name}
                                  <button onClick={() => removeObjectFromSource(editingWidget.id, s.id, obj.name)}
                                    className="hover:text-red-500 ml-0.5">&times;</button>
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input value={editModalObjectInput}
                                onChange={(e) => setEditModalObjectInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const names = editModalObjectInput.split(/[,，、/\s]+/).filter(Boolean); if (names.length > 0) { names.forEach(n => addObjectToSource(editingWidget.id, s.id, n)); setEditModalObjectInput(''); } } }}
                                placeholder="输入对象名称（空格/,/逗号分隔可批量添加）" className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg outline-none focus:border-purple-400 transition-all bg-transparent" />
                              <button onClick={() => { const names = editModalObjectInput.split(/[,，、/\s]+/).filter(Boolean); if (names.length > 0) { names.forEach(n => addObjectToSource(editingWidget.id, s.id, n)); setEditModalObjectInput(''); } }}
                                className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-purple-300 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors shrink-0">
                                添加
                              </button>
                            </div>
                          </div>
                          {/* --- Keywords --- */}
                          <KeywordInput
                            keywords={s.keywords} sourceId={s.id} widgetId={editingWidget.id}
                            onAdd={addKeyword} onRemove={removeKeyword} />
                          <select value={s.updateFrequency}
                            onChange={(e) => updateSourceField(editingWidget.id, s.id, 'updateFrequency', e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all">
                            <option value="hourly">每小时</option>
                            <option value="daily">每天</option>
                            <option value="weekly">每周</option>
                            <option value="monthly">每月</option>
                          </select>
                          <textarea value={s.customPrompt}
                            onChange={(e) => updateSourceField(editingWidget.id, s.id, 'customPrompt', e.target.value)}
                            rows={6} placeholder="自定义提示词…"
                            className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                          {/* Model Config (collapsed) */}
                          <div className="border-t border-border pt-2">
                            <button type="button" onClick={() => toggleModelConfig(s.id)}
                              className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors w-full text-left">
                              <span>{expandedModelConfigs.has(s.id) ? '▼' : '▶'}</span> ⚙ 模型配置
                            </button>
                            {expandedModelConfigs.has(s.id) && (
                              <div className="mt-2 space-y-2">
                                <select value={s.aiProvider}
                                  onChange={(e) => updateSourceField(editingWidget.id, s.id, 'aiProvider', e.target.value)}
                                  className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all">
                                  {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                </select>
                                <input type="text" value={s.aiModel}
                                  onChange={(e) => updateSourceField(editingWidget.id, s.id, 'aiModel', e.target.value)}
                                  placeholder="模型" className="w-full px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all" />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </>
                )}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 flex items-center justify-end gap-2.5 px-6 py-4 border-t border-border bg-card/95 backdrop-blur-sm rounded-b-2xl">
                <button onClick={() => { setShowEditModal(false); setEditingWidgetId(null); setEditingSourceId(null) }}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                  取消
                </button>
                <button onClick={() => { setShowEditModal(false); setEditingWidgetId(null); setEditingSourceId(null) }}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm">
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>

        {/* ========== Add Widget Modal ========== */}
        <AnimatePresence>
          {showAddModal && (
            <motion.div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowAddModal(false); setAddModalType(null) }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            <motion.div ref={addModalPanelRef} className="relative bg-card border border-border rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto w-full mx-4"
              style={{ maxWidth: addModalType === 'intel-monitor' ? 560 : 520 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-card/95 backdrop-blur-sm rounded-t-2xl cursor-move"
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).tagName === 'BUTTON') return;
                  const panel = addModalPanelRef.current;
                  if (!panel) return;
                  const rect = panel.getBoundingClientRect();
                  addModalDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
                  panel.style.position = 'absolute';
                  panel.style.left = rect.left + 'px';
                  panel.style.top = rect.top + 'px';
                  panel.style.transform = 'none';
                  panel.style.margin = '0';
                  panel.style.transition = 'none';
                  e.preventDefault();
                }}>
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
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">报告标题</label>
                      <input type="text" value={addReportForm.title}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, title: e.target.value }))}
                        placeholder="行业分析报告"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">默认分析标的 (可选)</label>
                      <input type="text" value={addReportForm.defaultCompany}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, defaultCompany: e.target.value }))}
                        placeholder="如：阳光电源、宁德时代"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">分析框架</label>
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
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">搜索平台</label>
                      <select value={addReportForm.searchPlatform}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, searchPlatform: e.target.value }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        {SEARCH_PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">API Key (可选)</label>
                      <input type="text" value={addReportForm.searchApiKey}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, searchApiKey: e.target.value }))}
                        placeholder="输入自定义 API Key…"
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">系统提示词</label>
                      <textarea value={addReportForm.sysPrompt}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, sysPrompt: e.target.value }))}
                        rows={6}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">用户提示词</label>
                      <textarea value={addReportForm.userPrompt}
                        onChange={(e) => setAddReportForm((f) => ({ ...f, userPrompt: e.target.value }))}
                        rows={6}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                  </>
                )}
                {addModalType === 'intel-monitor' && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">情报属性</label>
                      <select value={INTEL_CATEGORIES.includes(addMonitorForm.sources[0]?.name) ? addMonitorForm.sources[0].name : '__custom__'}
                        onChange={(e) => {
                          const val = e.target.value === '__custom__' ? '' : e.target.value;
                          setAddMonitorForm((f) => ({
                            ...f, sources: [{
                              ...f.sources[0], name: val,
                              customPrompt: val && INTEL_PROMPTS[val] ? INTEL_PROMPTS[val] : f.sources[0].customPrompt,
                            }],
                          }));
                        }}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        <option value="">-- 选择情报属性 --</option>
                        {INTEL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="__custom__">自定义…</option>
                      </select>
                      {!INTEL_CATEGORIES.includes(addMonitorForm.sources[0]?.name) && (
                        <input type="text" value={addMonitorForm.sources[0]?.name || ''}
                          onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], name: e.target.value }] }))}
                          placeholder="输入自定义属性名称" className="w-full px-3 py-2 mt-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">监控对象 (可选，空格/逗号分隔可批量添加)</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(addMonitorForm.sources[0]?.objects || []).filter(o => o.name).map((obj) => (
                          <span key={obj.name} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/20 text-[11px] text-purple-700 dark:text-purple-300 font-medium">
                            {obj.name}
                            <button onClick={() => setAddMonitorForm((f) => ({
                              ...f, sources: [{ ...f.sources[0], objects: (f.sources[0].objects || []).filter((o) => o.name !== obj.name) }],
                            }))} className="hover:text-red-500 ml-0.5">&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input value={addModalObjectInput}
                          onChange={(e) => setAddModalObjectInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const names = addModalObjectInput.split(/[,，、\s]+/).filter(Boolean); if (names.length > 0) { setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], objects: [...(f.sources[0].objects || []), ...names.map(n => ({ name: n, keywords: [] }))] }] })); setAddModalObjectInput(''); } } }}
                          placeholder="输入对象名称（如：星巴克 瑞幸 Manner）"
                          className="flex-1 px-3 py-2 text-sm border border-border rounded-lg outline-none focus:border-purple-400 transition-all bg-transparent" />
                        <button onClick={() => { const names = addModalObjectInput.split(/[,，、/\s]+/).filter(Boolean); if (names.length > 0) { setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], objects: [...(f.sources[0].objects || []), ...names.map(n => ({ name: n, keywords: [] }))] }] })); setAddModalObjectInput(''); } }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-300 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors shrink-0">
                          添加对象
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">监控关键词 <span className="font-normal opacity-60">空格/逗号分隔批量添加</span></label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(addMonitorForm.sources[0]?.keywords || []).map((kw) => (
                          <span key={kw} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-violet-100 dark:bg-violet-900/20 text-[11px] text-violet-700 dark:text-violet-300 font-medium">
                            {kw}
                            <button onClick={() => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], keywords: f.sources[0].keywords.filter((k) => k !== kw) }] }))}
                              className="hover:text-red-500 ml-0.5">&times;</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input value={addModalKeywordInput}
                          onChange={(e) => setAddModalKeywordInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const parts = addModalKeywordInput.split(/[,，、\s]+/).filter(Boolean); if (parts.length > 0) { setAddMonitorForm((f) => { const s = f.sources[0]; const newKws = [...s.keywords]; parts.forEach((k) => { if (!newKws.includes(k)) newKws.push(k) }); return { ...f, sources: [{ ...s, keywords: newKws }] } }); setAddModalKeywordInput(''); } } }}
                          placeholder="输入关键词（如：新品发布 财报 市场份额）"
                          className="flex-1 px-3 py-2 text-sm border border-border rounded-lg outline-none focus:border-violet-400 transition-all bg-transparent" />
                        <button onClick={() => { const parts = addModalKeywordInput.split(/[,，、/\s]+/).filter(Boolean); if (parts.length > 0) { setAddMonitorForm((f) => { const s = f.sources[0]; const newKws = [...s.keywords]; parts.forEach((k) => { if (!newKws.includes(k)) newKws.push(k) }); return { ...f, sources: [{ ...s, keywords: newKws }] } }); setAddModalKeywordInput(''); } }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-violet-300 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors shrink-0">
                          添加关键词
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">更新频率</label>
                      <select value={addMonitorForm.sources[0]?.updateFrequency || 'daily'}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], updateFrequency: e.target.value }] }))}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                        <option value="daily">每天</option>
                        <option value="hourly">每小时</option>
                        <option value="weekly">每周</option>
                        <option value="monthly">每月</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-muted-foreground mb-1.5">自定义提示词</label>
                      <textarea value={addMonitorForm.sources[0]?.customPrompt || ''}
                        onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], customPrompt: e.target.value }] }))}
                        rows={6} placeholder={addMonitorForm.sources[0]?.name && INTEL_PROMPTS[addMonitorForm.sources[0].name] ? INTEL_PROMPTS[addMonitorForm.sources[0].name] : '描述情报监控的具体要求…'}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs outline-none focus:border-violet-400 transition-all resize-none" />
                    </div>
                    {/* Model Config (collapsed by default, at the very bottom) */}
                    <div className="border-t border-border pt-3">
                      <button type="button" onClick={() => setAddModalExpandedModel(!addModalExpandedModel)}
                        className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1">
                        <span>{addModalExpandedModel ? '▼' : '▶'}</span> ⚙ 模型配置（高级）
                      </button>
                      {addModalExpandedModel && (
                        <div className="mt-2 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-semibold text-muted-foreground mb-1.5">AI 引擎</label>
                              <select value={addMonitorForm.sources[0]?.aiProvider || 'all'}
                                onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], aiProvider: e.target.value }] }))}
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all">
                                {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-muted-foreground mb-1.5">AI 模型</label>
                              <input type="text" value={addMonitorForm.sources[0]?.aiModel || 'deepseek-v4-flash'}
                                onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], aiModel: e.target.value }] }))}
                                placeholder="deepseek-v4-flash"
                                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-muted-foreground mb-1.5">API Key（可选）</label>
                            <input type="text" value={addMonitorForm.sources[0]?.apiKey || ''}
                              onChange={(e) => setAddMonitorForm((f) => ({ ...f, sources: [{ ...f.sources[0], apiKey: e.target.value }] }))}
                              placeholder="留空使用默认密钥" className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:border-violet-400 transition-all" />
                          </div>
                        </div>
                      )}
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
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
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
