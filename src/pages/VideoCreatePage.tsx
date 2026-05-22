import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo, videoTaskStatus } from '@/lib/api'
import type { VideoTaskStatus } from '@/lib/api'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, Play, Download, X, Clock, Users, Upload, Image as ImageIcon, Film, Wand2, Grid3X3, Plus, ChevronDown } from 'lucide-react'
import { videoTemplates, templateCategories, getTemplatesByCategory } from '@/data/videoTemplates'
import type { VideoTemplate } from '@/data/videoTemplates'
import { VideoHistory } from '@/components/VideoHistory'

interface GeneratedVideo {
  id: string
  title: string
  url: string
}

const GEN_TYPE_CONFIG = [
  { key: 'text2video', label: '文生视频', icon: Wand2, desc: '文字描述生成', gradient: 'from-orange-500/20 via-red-500/20 to-pink-500/20', border: 'border-orange-400/30', text: 'text-orange-300' },
  { key: 'image2video', label: '图生视频', icon: ImageIcon, desc: '单图 + 描述', gradient: 'from-blue-500/20 via-cyan-500/20 to-teal-500/20', border: 'border-blue-400/30', text: 'text-blue-300' },
  { key: 'multimodal2video', label: '全能参考', icon: Sparkles, desc: '多图/视频/音频', gradient: 'from-purple-500/20 via-fuchsia-500/20 to-pink-500/20', border: 'border-purple-400/30', text: 'text-purple-300' },
  { key: 'multiframe2video', label: '多图故事', icon: Film, desc: '2-20图连贯故事', gradient: 'from-emerald-500/20 via-teal-500/20 to-cyan-500/20', border: 'border-emerald-400/30', text: 'text-emerald-300' },
  { key: 'frames2video', label: '首尾帧', icon: Grid3X3, desc: '首帧+尾帧过渡', gradient: 'from-amber-500/20 via-yellow-500/20 to-orange-500/20', border: 'border-amber-400/30', text: 'text-amber-300' },
  { key: 'image_upscale', label: '图片放大', icon: Upload, desc: '超分 2K/4K/8K', gradient: 'from-sky-500/20 via-indigo-500/20 to-violet-500/20', border: 'border-sky-400/30', text: 'text-sky-300' },
] as const

type GenType = typeof GEN_TYPE_CONFIG[number]['key']

const MODEL_VERSIONS = [
  { value: 'seedance2.0fast', label: 'Fast', desc: '默认·快速' },
  { value: 'seedance2.0', label: '标准', desc: '标准质量' },
  { value: 'seedance2.0_vip', label: 'VIP', desc: '1080p·高质量' },
  { value: 'seedance2.0fast_vip', label: 'Fast VIP', desc: '快速·1080p' },
] as const

export function VideoCreatePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [genType, setGenType] = useState<GenType>('text2video')
  const [modelVersion, setModelVersion] = useState('seedance2.0fast')

  const [activeCategory, setActiveCategory] = useState('all')
  const [inputMode, setInputMode] = useState<'all' | 'text' | 'image'>('all')
  const [selectedTemplate, setSelectedTemplate] = useState<VideoTemplate | null>(null)

  // Image upload state — supports multiple images
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Transition prompts for multiframe2video
  const [transitionPrompts, setTransitionPrompts] = useState<string[]>([])
  const [transitionDurations, setTransitionDurations] = useState<string[]>([])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitId, setSubmitId] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [pollCount, setPollCount] = useState(0)
  const [queueMessage, setQueueMessage] = useState('')
  const [elapsedMinutes, setElapsedMinutes] = useState(0)
  const [estimatedMaxMinutes, setEstimatedMaxMinutes] = useState(0)
  const [maxPolls, setMaxPolls] = useState(60)
  const [result, setResult] = useState<GeneratedVideo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  const needsImage = ['image2video', 'multimodal2video', 'multiframe2video', 'frames2video', 'image_upscale'].includes(genType)
  const needsPrompt = ['text2video', 'image2video', 'multimodal2video', 'frames2video'].includes(genType)
  const supportsModel = ['text2video', 'image2video', 'multimodal2video', 'frames2video'].includes(genType)
  const minImages = genType === 'multiframe2video' ? 2 : genType === 'frames2video' ? 2 : 1
  const maxImages = genType === 'multiframe2video' ? 20 : genType === 'multimodal2video' ? 9 : genType === 'frames2video' ? 2 : 1

  // Cleanup on unmount
  useEffect(() => { return () => { if (pollingRef.current) clearInterval(pollingRef.current) } }, [])

  // Sync transition prompts count with images
  useEffect(() => {
    if (genType === 'multiframe2video') {
      const n = Math.max(2, imageFiles.length)
      setTransitionPrompts(prev => {
        const np = [...prev]
        while (np.length < n - 1) np.push('')
        return np.slice(0, n - 1)
      })
      setTransitionDurations(prev => {
        const nd = [...prev]
        while (nd.length < n - 1) nd.push('3')
        return nd.slice(0, n - 1)
      })
    }
  }, [genType, imageFiles.length])

  // Polling effect
  useEffect(() => {
    if (!isPolling || !submitId) return
    let polling = true
    const poll = async () => {
      if (!polling) return
      try {
        const res = await videoTaskStatus(submitId)
        if (!polling) return
        if (res.data) {
          setPollCount(res.data.polls)
          setQueueMessage(res.data.queueMessage || '')
          setElapsedMinutes(res.data.elapsedMinutes)
          setEstimatedMaxMinutes(res.data.estimatedMaxMinutes)
          setMaxPolls(res.data.maxPolls || 60)
          if (res.data.status === 'completed') {
            setIsPolling(false)
            setResult({ id: res.data.id, title: prompt.slice(0, 30) + (genType === 'image_upscale' ? ' 放大' : ' 视频'), url: res.data.result?.videoUrl || '' })
          } else if (res.data.status === 'failed') {
            setIsPolling(false)
            setError('生成失败，请稍后重试')
          }
        }
      } catch (e: any) { console.warn('Poll error:', e.message) }
    }
    poll()
    pollingRef.current = setInterval(poll, 30000)
    return () => { polling = false; if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null } }
  }, [isPolling, submitId, prompt, genType])

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const valid = files.filter(f => {
      if (!f.type.startsWith('image/')) { setError('请选择图片文件'); return false }
      if (f.size > 20 * 1024 * 1024) { setError('图片不能超过 20MB'); return false }
      return true
    })
    if (valid.length === 0) return
    setError(null)
    const newFiles = [...imageFiles, ...valid].slice(0, maxImages)
    setImageFiles(newFiles)
    setImagePreviews(newFiles.map(f => URL.createObjectURL(f)))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleRemoveImage = (index: number) => {
    const nf = imageFiles.filter((_, i) => i !== index)
    const np = imagePreviews.filter((_, i) => i !== index)
    URL.revokeObjectURL(imagePreviews[index])
    setImageFiles(nf)
    setImagePreviews(np)
  }

  const clearAllImages = () => {
    imagePreviews.forEach(url => URL.revokeObjectURL(url))
    setImageFiles([])
    setImagePreviews([])
  }

  const handleSubmit = async () => {
    const p = prompt.trim()
    if (needsPrompt && !p) return
    if (needsImage && imageFiles.length < minImages) { setError(`请上传至少 ${minImages} 张图片`); return }
    setIsSubmitting(true); setError(null); setResult(null)
    setQueueMessage(''); setPollCount(0); setElapsedMinutes(0)
    try {
      const base64Images = await Promise.all(imageFiles.map(f => fileToBase64(f)))
      const params: any = {
        genType, modelVersion, prompt: p, duration, resolution, ratio,
      }
      if (base64Images.length === 1) {
        params.image = base64Images[0]
      } else if (base64Images.length > 1) {
        params.images = base64Images
      }
      if (genType === 'multiframe2video' && transitionPrompts.length > 0) {
        params.transitionPrompts = transitionPrompts.filter(tp => tp.trim())
        params.transitionDurations = transitionDurations
      }
      const res = await generateVideo(params)
      if (res.data?.id) {
        setSubmitId(res.data.id)
        startTimeRef.current = Date.now()
        setIsPolling(true)
      } else { setError(res.error?.message || '提交失败') }
    } catch (e: any) { setError(e.message || '提交失败，请稍后重试') }
    finally { setIsSubmitting(false) }
  }

  const handleCopy = async () => {
    if (!result?.url) return
    try { await navigator.clipboard.writeText(result.url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const handleDownload = async () => {
    if (!result?.url) return
    setDownloading(true); setDownloadProgress(0)
    try {
      const response = await fetch(result.url)
      if (!response.ok) throw new Error('Download failed')
      const contentLength = response.headers.get('content-length')
      const total = contentLength ? parseInt(contentLength) : 0
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value); received += value.length
        if (total > 0) setDownloadProgress(Math.round((received / total) * 100))
      }
      const ext = genType === 'image_upscale' ? 'png' : 'mp4'
      const blob = new Blob(chunks, { type: genType === 'image_upscale' ? 'image/png' : 'video/mp4' })
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl; a.download = `output-${result.id.slice(0, 8)}.${ext}`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e: any) { window.open(result.url, '_blank') }
    finally { setDownloading(false); setDownloadProgress(0) }
  }

  const filteredTemplates = getTemplatesByCategory(activeCategory)
  const displayTemplates = inputMode === 'all' ? filteredTemplates : filteredTemplates.filter(t => t.inputType === inputMode)

  const handleSelectTemplate = (template: VideoTemplate) => {
    setSelectedTemplate(template); setPrompt(template.prompt); setDuration(template.duration); setRatio(template.ratio)
    clearAllImages()
    if (fileInputRef.current) fileInputRef.current.value = ''
    document.getElementById('video-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleClearTemplate = () => { setSelectedTemplate(null); setPrompt(''); clearAllImages() }
  const handleReset = () => {
    setResult(null); setSubmitId(null); setIsPolling(false); setQueueMessage('')
    setPollCount(0); setElapsedMinutes(0); setError(null); setCopied(false)
    setPrompt(''); setSelectedTemplate(null); clearAllImages()
  }

  const modeOptions = [
    { key: 'all', label: '全部模板', desc: '浏览所有风格', icon: Grid3X3, gradient: 'from-violet-500/20 via-purple-500/20 to-fuchsia-500/20', border: 'border-violet-400/30', text: 'text-violet-300', glow: 'shadow-violet-500/10' },
    { key: 'text', label: '文生视频', desc: '用文字描述生成', icon: Wand2, gradient: 'from-orange-500/20 via-red-500/20 to-pink-500/20', border: 'border-orange-400/30', text: 'text-orange-300', glow: 'shadow-orange-500/10' },
    { key: 'image', label: '图生视频', desc: '上传图片 + 描述', icon: ImageIcon, gradient: 'from-blue-500/20 via-cyan-500/20 to-teal-500/20', border: 'border-blue-400/30', text: 'text-blue-300', glow: 'shadow-blue-500/10' },
  ] as const

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-3 sm:px-5 md:px-6 py-4 sm:py-6 md:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />返回首页
          </button>
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
            <LayoutDashboard size={14} />回到对话
          </button>
        </div>

        {/* Hero Title */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-2 sm:gap-3 mb-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Clapperboard size={16} className="sm:size-18 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">AI 视频创作</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
                使用即梦 Seedance 2.0 系列模型，多种生成方式随心所选
              </p>
            </div>
          </div>
        </div>

        {!result && !isPolling ? (
          <div className="space-y-4 sm:space-y-5">
            {/* ===== Generation Type Selector ===== */}
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className="text-muted-foreground" />
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">生成方式</h3>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
                {GEN_TYPE_CONFIG.map(opt => {
                  const isActive = genType === opt.key
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.key}
                      onClick={() => { setGenType(opt.key); clearAllImages(); setPrompt('') }}
                      className={`relative rounded-lg sm:rounded-xl p-2 sm:p-3 border-2 transition-all duration-300 text-left overflow-hidden
                        ${isActive ? `${opt.border} bg-gradient-to-br ${opt.gradient} scale-[1.03] shadow-md` : 'border-border/40 bg-card/50 hover:border-border hover:bg-card hover:shadow-sm'}`}
                    >
                      <div className="relative z-10 flex flex-col items-center text-center gap-0.5 sm:gap-1">
                        <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all ${isActive ? `bg-gradient-to-br ${opt.gradient} ${opt.text}` : 'bg-muted text-muted-foreground'}`}>
                          <Icon size={14} className="sm:size-16" />
                        </div>
                        <span className={`text-[10px] sm:text-xs font-semibold ${isActive ? 'text-foreground' : 'text-foreground/60'}`}>{opt.label}</span>
                        <span className="text-[9px] text-muted-foreground hidden sm:block">{opt.desc}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ===== Template Library ===== */}
            <div className="rounded-xl sm:rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 sm:p-5 md:p-6 space-y-3 sm:space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2"><Sparkles size={16} className="text-primary" />视频模板库</h3>
                {selectedTemplate && (<button onClick={handleClearTemplate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"><X size={13} />清空模板</button>)}
              </div>
              <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
                {templateCategories.map(cat => (
                  <button key={cat.key} onClick={() => setActiveCategory(cat.key)} className={`whitespace-nowrap px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 flex-shrink-0 ${activeCategory === cat.key ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                    <span className="mr-1">{cat.icon}</span>{cat.label}
                  </button>
                ))}
              </div>
              {displayTemplates.length === 0 ? (
                <div className="py-12 text-center">
                  <Grid3X3 size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">该模式下没有匹配的模板</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 max-h-[360px] sm:max-h-[400px] overflow-y-auto pr-0.5 scrollbar-thin">
                  {displayTemplates.map(tpl => {
                    const isSelected = selectedTemplate?.id === tpl.id
                    return (
                      <button key={tpl.id} onClick={() => handleSelectTemplate(tpl)} className={`text-left p-2.5 sm:p-3 rounded-lg sm:rounded-xl border-2 transition-all duration-200 group ${isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md shadow-primary/10 scale-[1.02]' : 'border-border/40 bg-background/50 hover:border-primary/30 hover:bg-muted/30 hover:shadow-sm'}`}>
                        <div className="flex items-start gap-1.5 sm:gap-2">
                          <span className="text-base sm:text-lg flex-shrink-0">{tpl.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] sm:text-xs font-semibold truncate">{tpl.name}</div>
                            <div className="flex items-center gap-1 sm:gap-1.5 mt-1 sm:mt-1.5 flex-wrap">
                              <span className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded-md bg-muted/60 text-muted-foreground font-medium">{tpl.duration}s</span>
                              <span className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded-md bg-muted/60 text-muted-foreground font-medium">{tpl.ratio}</span>
                              {tpl.inputType === 'image' && (<span className="text-[9px] sm:text-[10px] px-1 py-0.5 rounded-md bg-blue-500/10 text-blue-400 font-medium">📸</span>)}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ===== Create Form ===== */}
            <div id="video-form" className="rounded-xl sm:rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 sm:p-5 md:p-6 space-y-4 sm:space-y-5 shadow-sm">
              <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2"><Wand2 size={16} className="text-primary" />创作配置</h3>

              {/* Image upload area */}
              {needsImage && (
                <div className={`p-3 sm:p-4 rounded-lg sm:rounded-xl border ${genType === 'image_upscale' ? 'bg-gradient-to-r from-sky-500/5 to-indigo-500/5 border-sky-500/10' : 'bg-gradient-to-r from-blue-500/5 via-cyan-500/5 to-teal-500/5 border-blue-500/10'}`}>
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <label className="text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                      <ImageIcon size={14} className={genType === 'image_upscale' ? 'text-sky-400' : 'text-blue-400'} />
                      {genType === 'frames2video' ? '首帧 + 尾帧' : genType === 'multiframe2video' ? `图片 (${imageFiles.length}/${maxImages})` : '上传图片'}
                      <span className="text-destructive">*</span>
                    </label>
                    {imageFiles.length < maxImages && (
                      <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-[10px] sm:text-xs text-primary hover:underline">
                        <Plus size={14} />添加图片
                      </button>
                    )}
                  </div>

                  {imageFiles.length > 0 ? (
                    <div className={`grid gap-2 sm:gap-3 ${imageFiles.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
                      {imagePreviews.map((preview, idx) => (
                        <div key={idx} className="relative rounded-lg overflow-hidden border-2 border-border/60 bg-muted/30 group">
                          <img src={preview} alt={`Image ${idx + 1}`} className="w-full aspect-square object-cover" />
                          {genType === 'frames2video' && (
                            <div className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${idx === 0 ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                              {idx === 0 ? '首帧' : '尾帧'}
                            </div>
                          )}
                          <button onClick={() => handleRemoveImage(idx)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-background/90 border border-border shadow-sm flex items-center justify-center hover:bg-destructive hover:text-white transition-all opacity-0 group-hover:opacity-100">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-blue-300/30 rounded-lg sm:rounded-xl p-6 sm:p-8 text-center cursor-pointer hover:border-blue-400/50 hover:bg-blue-500/5 transition-all duration-300 group">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-2 rounded-full bg-blue-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Upload size={20} className="text-blue-400" />
                      </div>
                      <p className="text-sm text-muted-foreground font-medium">点击上传{minImages > 1 ? ` ${minImages}-${maxImages} 张` : ''}图片</p>
                      <p className="text-xs text-muted-foreground mt-1">支持 JPG/PNG/WebP，最大 20MB</p>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
                </div>
              )}

              {/* Transition prompts (multiframe2video only) */}
              {genType === 'multiframe2video' && imageFiles.length >= 2 && (
                <div className="space-y-2 sm:space-y-3 p-3 sm:p-4 rounded-lg bg-muted/30 border border-border/30">
                  <label className="text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                    <Film size={14} className="text-emerald-400" />过渡描述
                  </label>
                  {transitionPrompts.map((tp, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-12 text-[10px] text-muted-foreground mt-2.5">
                        图{idx + 1}→{idx + 2}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <input
                          value={tp}
                          onChange={e => setTransitionPrompts(prev => { const n = [...prev]; n[idx] = e.target.value; return n })}
                          placeholder={`描述从图${idx + 1}到图${idx + 2}的变化...`}
                          className="w-full px-3 py-2 bg-background border border-border/60 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">时长:</span>
                          <input
                            type="number"
                            min="0.5" max="8" step="0.5"
                            value={transitionDurations[idx]}
                            onChange={e => setTransitionDurations(prev => { const n = [...prev]; n[idx] = e.target.value; return n })}
                            className="w-16 px-2 py-1 bg-background border border-border/60 rounded text-xs text-center outline-none focus:ring-1 focus:ring-primary/30"
                          />
                          <span className="text-[10px] text-muted-foreground">秒</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Prompt */}
              {needsPrompt && (
                <div>
                  <label className="block text-xs sm:text-sm font-semibold mb-2">
                    {genType === 'image2video' || genType === 'multimodal2video' ? '🎬 视频描述' : '✨ 生成描述'} <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => { setPrompt(e.target.value); if (selectedTemplate && e.target.value !== selectedTemplate.prompt) setSelectedTemplate(null) }}
                    placeholder={genType === 'multimodal2video' ? '描述你想要的视频效果，如「镜头缓缓推进，人物转身微笑...」' : '描述你想要生成的视频内容...'}
                    className="w-full min-h-[90px] sm:min-h-[110px] px-3 sm:px-4 py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all duration-200 resize-vertical placeholder:text-muted-foreground/50"
                  />
                </div>
              )}

              {/* Model Version + Controls */}
              <div className={`grid gap-3 sm:gap-4 ${supportsModel ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'}`}>
                {supportsModel && (
                  <div>
                    <label className="block text-xs sm:text-sm font-medium mb-1.5">🧠 模型版本</label>
                    <select value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} className="w-full px-2 sm:px-3 py-2.5 sm:py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer">
                      {MODEL_VERSIONS.map(m => (
                        <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
                      ))}
                    </select>
                  </div>
                )}
                {genType !== 'image_upscale' && (
                  <div>
                    <label className="block text-xs sm:text-sm font-medium mb-1.5">⏱ 时长</label>
                    <select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full px-2 sm:px-3 py-2.5 sm:py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer">
                      {genType === 'multiframe2video' ? (
                        <option value="5">由过渡决定</option>
                      ) : (
                        <>
                          <option value="4">4 秒</option>
                          <option value="5">5 秒</option>
                          <option value="8">8 秒</option>
                          <option value="10">10 秒</option>
                          <option value="15">15 秒</option>
                        </>
                      )}
                    </select>
                  </div>
                )}
                {genType === 'text2video' && (
                  <>
                    <div>
                      <label className="block text-xs sm:text-sm font-medium mb-1.5">📐 分辨率</label>
                      <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full px-2 sm:px-3 py-2.5 sm:py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer">
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-medium mb-1.5">📏 比例</label>
                      <select value={ratio} onChange={(e) => setRatio(e.target.value)} className="w-full px-2 sm:px-3 py-2.5 sm:py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer">
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                      </select>
                    </div>
                  </>
                )}
                {['image2video', 'multimodal2video', 'frames2video'].includes(genType) && (
                  <div>
                    <label className="block text-xs sm:text-sm font-medium mb-1.5">📐 分辨率</label>
                    <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full px-2 sm:px-3 py-2.5 sm:py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer">
                      <option value="720p">720p</option>
                      {modelVersion.includes('vip') && <option value="1080p">1080p</option>}
                    </select>
                  </div>
                )}
                {genType === 'image_upscale' && (
                  <div>
                    <label className="block text-xs sm:text-sm font-medium mb-1.5">📐 分辨率</label>
                    <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full px-2 sm:px-3 py-2.5 sm:py-3 bg-background border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer">
                      <option value="2k">2K</option>
                      <option value="4k">4K (VIP)</option>
                      <option value="8k">8K (VIP)</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || (needsPrompt && !prompt.trim()) || (needsImage && imageFiles.length < minImages)}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 sm:py-3.5 rounded-lg sm:rounded-xl text-sm sm:text-base font-semibold transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg hover:shadow-xl active:scale-[0.98]
                  ${genType === 'image_upscale' ? 'bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-500 hover:from-sky-600 hover:via-indigo-600 hover:to-violet-600 shadow-sky-500/25'
                    : genType === 'multimodal2video' ? 'bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 hover:from-purple-600 hover:via-fuchsia-600 hover:to-pink-600 shadow-purple-500/25'
                    : genType === 'multiframe2video' ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-600 hover:via-teal-600 hover:to-cyan-600 shadow-emerald-500/25'
                    : genType === 'frames2video' ? 'bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 hover:from-amber-600 hover:via-yellow-600 hover:to-orange-600 shadow-amber-500/25'
                    : 'bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 hover:from-orange-600 hover:via-red-600 hover:to-pink-600 shadow-orange-500/25'
                  }`}
              >
                {isSubmitting ? <><Loader2 size={18} className="animate-spin" />正在提交...</> : <>{GEN_TYPE_CONFIG.find(g => g.key === genType) ? <GEN_TYPE_CONFIG.find(g => g.key === genType)!.icon size={18} /> : null}{GEN_TYPE_CONFIG.find(g => g.key === genType)?.label || '开始生成'}</>}
              </button>
            </div>

            {error && (
              <div className="p-3 sm:p-4 bg-destructive/10 border border-destructive/20 rounded-xl sm:rounded-2xl text-xs sm:text-sm text-destructive flex items-start gap-2">
                <X size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
          </div>
        ) : isPolling ? (
          /* ===== Polling UI ===== */
          <div className="rounded-xl sm:rounded-2xl border-2 border-yellow-500/20 bg-card/80 backdrop-blur-sm p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 shadow-lg shadow-yellow-500/5">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-yellow-500/10 flex items-center justify-center animate-pulse">
                <Loader2 size={22} className="text-yellow-500 animate-spin sm:size-24" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-yellow-500">
                  {genType === 'image_upscale' ? '图片放大中' : '视频生成中'}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {GEN_TYPE_CONFIG.find(g => g.key === genType)?.label || genType} · {prompt.slice(0, 40)}{prompt.length > 40 ? '...' : ''}
                </p>
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg sm:rounded-xl p-3 sm:p-5 space-y-3 sm:space-y-4">
              {queueMessage && (
                <div className="flex items-center gap-2 sm:gap-3 text-sm sm:text-base">
                  <Users size={18} className="text-orange-400 flex-shrink-0" />
                  <span className="text-foreground font-semibold">{queueMessage}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                <Clock size={16} className="flex-shrink-0" />
                <span>已等待 <strong className="text-foreground">{elapsedMinutes}</strong> 分钟</span>
                {estimatedMaxMinutes > 0 && (<span className="text-xs">（最长约 {estimatedMaxMinutes} 分钟）</span>)}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>轮询次数：{pollCount} / {maxPolls}</span></div>
              <div className="w-full bg-muted rounded-full h-2.5 sm:h-3 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 rounded-full transition-all duration-1000 animate-pulse"
                  style={{ width: estimatedMaxMinutes > 0 ? `${Math.min((elapsedMinutes / estimatedMaxMinutes) * 100, 95)}%` : '10%' }} />
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-relaxed">
                生成可能需要较长时间（最长 5 小时）。
                <br className="hidden sm:block" />
                任务 ID：<code className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{submitId?.slice(0, 12)}...</code>
              </p>
            </div>
            <button onClick={handleReset} className="w-full px-4 py-2.5 sm:py-3 border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200">
              取消等待，返回创作
            </button>
          </div>
        ) : result ? (
          /* ===== Result UI ===== */
          <div className="rounded-xl sm:rounded-2xl border-2 border-green-500/20 bg-card/80 backdrop-blur-sm p-4 sm:p-6 md:p-8 space-y-5 sm:space-y-6 shadow-lg shadow-green-500/5">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <Play size={22} className="text-green-400 sm:size-24" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-green-400">生成成功!</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{result.title}</p>
              </div>
            </div>
            {result.url ? (
              <div className="space-y-4 sm:space-y-5">
                <div className="relative rounded-lg sm:rounded-xl overflow-hidden border-2 border-border/40 bg-black shadow-xl">
                  {genType === 'image_upscale' ? (
                    <img src={result.url} alt="Upscaled" className="w-full object-contain" />
                  ) : (
                    <>
                      <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-gradient-to-b from-black/0 via-black/0 to-black/60 pointer-events-none z-10" />
                      <video src={result.url} controls playsInline className="w-full aspect-video object-contain">
                        您的浏览器不支持视频播放
                      </video>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-muted/40 rounded-lg sm:rounded-xl p-2.5 sm:p-3">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <ExternalLink size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="text-[10px] sm:text-xs text-muted-foreground truncate select-all">{result.url}</span>
                  </div>
                  <button onClick={handleCopy} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-primary text-primary-foreground rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm">
                    {copied ? '✓ 已复制' : <><Copy size={12} /> 复制</>}
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <button onClick={handleDownload} disabled={downloading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold hover:from-emerald-600 hover:to-teal-600 transition-all duration-200 disabled:opacity-60 disabled:cursor-wait shadow-lg shadow-emerald-500/20">
                    {downloading ? <><Loader2 size={16} className="animate-spin" />下载中 {downloadProgress > 0 ? `${downloadProgress}%` : ''}</> : <><Download size={16} />下载</>}
                  </button>
                  <button onClick={() => window.open(result.url, '_blank')} className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium hover:bg-muted/50 transition-all">
                    <ExternalLink size={14} />新窗口
                  </button>
                  <button onClick={handleReset} className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 border border-border/60 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium hover:bg-muted/50 transition-all">
                    <Sparkles size={14} />重新生成
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg sm:rounded-xl p-4">
                <p className="text-xs sm:text-sm text-yellow-400">生成完成，但未获取到结果地址，请稍后重试</p>
              </div>
            )}
          </div>
        ) : null}

        {/* ===== My Videos ===== */}
        {!isPolling && (
          <div className="mt-6 sm:mt-8 rounded-xl sm:rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 sm:p-5 md:p-6 shadow-sm">
            <h3 className="text-sm sm:text-base font-semibold flex items-center gap-2 mb-4">
              <Play size={16} className="text-primary" />我的视频
            </h3>
            <VideoHistory />
          </div>
        )}
      </div>
    </div>
  )
}
