import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo, videoTaskStatus, cancelVideoTask } from '@/lib/api'
import type { VideoTaskStatus } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, Play, Download, X, Clock, Users, Upload, Image as ImageIcon, Film, Wand2, Grid3X3, Plus, ChevronDown, Send, Box, Diamond, Check } from 'lucide-react'
import { videoTemplates, templateCategories, getTemplatesByCategory } from '@/data/videoTemplates'
import type { VideoTemplate } from '@/data/videoTemplates'
import { VideoHistory } from '@/components/VideoHistory'

interface GeneratedVideo {
  id: string
  title: string
  url: string
}

const GEN_TYPE_CONFIG = [
  { key: 'text2video', label: '文生视频', icon: Wand2, short: '文生' },
  { key: 'image2video', label: '图生视频', icon: ImageIcon, short: '图生' },
  { key: 'multimodal2video', label: '全能参考', icon: Sparkles, short: '参考' },
  { key: 'multiframe2video', label: '多图故事', icon: Film, short: '故事' },
  { key: 'frames2video', label: '首尾帧', icon: Grid3X3, short: '帧' },
  { key: 'image_upscale', label: '图片放大', icon: Upload, short: '放大' },
] as const

type GenType = typeof GEN_TYPE_CONFIG[number]['key']

const MODEL_VERSIONS = [
  { value: 'seedance2.0fast', label: 'Fast', desc: '快速' },
  { value: 'seedance2.0', label: '标准', desc: '标准质量' },
  { value: 'seedance2.0_vip', label: 'VIP', desc: '1080p' },
  { value: 'seedance2.0fast_vip', label: 'Fast VIP', desc: '快速·1080p' },
] as const

export function VideoCreatePage() {
  const navigate = useNavigate()
  const { user, fetchUserInfo } = useAuthStore()
  const userId = user?.id || ''
  const TASK_KEY = userId ? `yooclaw_active_video_task_${userId}` : ''
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [genType, setGenType] = useState<GenType>('multimodal2video')
  const [modelVersion, setModelVersion] = useState('seedance2.0fast')

  const [activeCategory, setActiveCategory] = useState('all')
  const [inputMode, setInputMode] = useState<'all' | 'text' | 'image'>('image')
  const [selectedTemplate, setSelectedTemplate] = useState<VideoTemplate | null>(null)

  // Image upload state — supports multiple images
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // @-mention state
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionAnchorIdx, setMentionAnchorIdx] = useState(-1) // position of "@" in prompt
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0)

  // Transition prompts for multiframe2video
  const [transitionPrompts, setTransitionPrompts] = useState<string[]>([])
  const [transitionDurations, setTransitionDurations] = useState<string[]>([])

  // Dropdown popover refs
  const [openGenType, setOpenGenType] = useState(false)
  const [openModel, setOpenModel] = useState(false)
  const [openRatio, setOpenRatio] = useState(false)
  const [openDuration, setOpenDuration] = useState(false)

  const genTypeRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const ratioRef = useRef<HTMLDivElement>(null)
  const durationRef = useRef<HTMLDivElement>(null)

  // Restore active task from localStorage (per-user key)
  const readSavedTask = (key: string): { sid: string | null; polling: boolean } => {
    try {
      const saved = localStorage.getItem(key)
      if (!saved) return { sid: null, polling: false }
      const { submitId, startTime } = JSON.parse(saved)
      if (!submitId) return { sid: null, polling: false }
      if (Date.now() - startTime > 5 * 3600 * 1000) {
        localStorage.removeItem(key)
        return { sid: null, polling: false }
      }
      return { sid: submitId, polling: true }
    } catch { return { sid: null, polling: false } }
  }
  const initialTask = TASK_KEY ? readSavedTask(TASK_KEY) : { sid: null, polling: false }
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitId, setSubmitId] = useState<string | null>(initialTask.sid)
  const [isPolling, setIsPolling] = useState(initialTask.polling)
  const [pollCount, setPollCount] = useState(0)
  const [queueMessage, setQueueMessage] = useState('')
  const [elapsedMinutes, setElapsedMinutes] = useState(0)
  const [estimatedMaxMinutes, setEstimatedMaxMinutes] = useState(0)
  const [maxPolls, setMaxPolls] = useState(120)
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

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (genTypeRef.current && !genTypeRef.current.contains(t)) setOpenGenType(false)
      if (modelRef.current && !modelRef.current.contains(t)) setOpenModel(false)
      if (ratioRef.current && !ratioRef.current.contains(t)) setOpenRatio(false)
      if (durationRef.current && !durationRef.current.contains(t)) setOpenDuration(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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

  // Fetch user info on mount; re-init task state when user is known
  useEffect(() => {
    fetchUserInfo().then(() => {
      const uid = useAuthStore.getState().user?.id
      if (uid) {
        const key = `yooclaw_active_video_task_${uid}`
        const saved = localStorage.getItem(key)
        if (saved) {
          try {
            const { submitId: sid, startTime } = JSON.parse(saved)
            if (sid && Date.now() - startTime <= 5 * 3600 * 1000) {
              setSubmitId(sid)
              setIsPolling(true)
              startTimeRef.current = startTime
            } else {
              localStorage.removeItem(key)
            }
          } catch { localStorage.removeItem(key) }
        }
      }
    })
  }, [])

  // Reset polling state when user changes (prevent seeing another user's task)
  useEffect(() => {
    if (!userId) return
    const key = `yooclaw_active_video_task_${userId}`
    const saved = localStorage.getItem(key)
    if (!saved && (submitId || isPolling)) {
      setSubmitId(null)
      setIsPolling(false)
      setQueueMessage('')
      setPollCount(0)
      setElapsedMinutes(0)
      setResult(null)
      setError(null)
    }
  }, [userId])

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
          setMaxPolls(res.data.maxPolls || 120)
          if (res.data.status === 'completed') {
            setIsPolling(false)
            if (TASK_KEY) localStorage.removeItem(TASK_KEY)
            setResult({ id: res.data.id, title: prompt.slice(0, 30) + (genType === 'image_upscale' ? ' 放大' : ' 视频'), url: res.data.result?.videoUrl || '' })
          } else if (res.data.status === 'cancelled') {
            setIsPolling(false)
            if (TASK_KEY) localStorage.removeItem(TASK_KEY)
            setError('视频生成已取消')
          } else if (res.data.status === 'failed') {
            setIsPolling(false)
            if (TASK_KEY) localStorage.removeItem(TASK_KEY)
            setError(res.data.errorMessage || '生成失败，请稍后重试')
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

  // @-mention: detect "@" in prompt
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setPrompt(value)
    if (selectedTemplate && value !== selectedTemplate.prompt) setSelectedTemplate(null)

    // Check for "@" mention trigger
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPos)
    const atIdx = textBeforeCursor.lastIndexOf('@')
    if (atIdx >= 0 && imagePreviews.length > 0) {
      const afterAt = textBeforeCursor.slice(atIdx + 1)
      // Don't show if "@" is followed by space or is part of existing reference
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setShowMentions(true)
        setMentionFilter(afterAt)
        setMentionAnchorIdx(atIdx)
        setSelectedMentionIdx(0)
        return
      }
    }
    setShowMentions(false)
  }

  // Insert @-reference into prompt
  const handleInsertMention = (refLabel: string) => {
    const before = prompt.slice(0, mentionAnchorIdx)
    const after = prompt.slice(textareaRef.current?.selectionStart || mentionAnchorIdx + 1 + mentionFilter.length)
    const newPrompt = before + `@${refLabel} ` + after
    setPrompt(newPrompt)
    setShowMentions(false)
    setSelectedMentionIdx(0)
    // Restore focus
    setTimeout(() => {
      textareaRef.current?.focus()
      const newCursorPos = before.length + refLabel.length + 2
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  // Get filtered mention file list
  const getMentionFiles = () => {
    return imagePreviews
      .map((preview, i) => ({ preview, label: `参考图${i + 1}`, index: i }))
      .filter(f => !mentionFilter || f.label.includes(mentionFilter))
  }

  // Keyboard handler for @-mention navigation
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showMentions) return
    const files = getMentionFiles()
    if (files.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedMentionIdx(prev => (prev + 1) % files.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedMentionIdx(prev => (prev - 1 + files.length) % files.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleInsertMention(files[selectedMentionIdx].label)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setShowMentions(false)
    }
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
        if (TASK_KEY) localStorage.setItem(TASK_KEY, JSON.stringify({ submitId: res.data.id, startTime: Date.now() }))
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

  let filteredTemplates = getTemplatesByCategory(activeCategory)
  if (inputMode !== 'all') {
    filteredTemplates = filteredTemplates.filter(t => t.inputType === inputMode)
  }
  // Sort: image templates first, then text templates
  filteredTemplates = [...filteredTemplates].sort((a, b) => {
    if (a.inputType === 'image' && b.inputType !== 'image') return -1
    if (a.inputType !== 'image' && b.inputType === 'image') return 1
    return 0
  })

  const handleSelectTemplate = (template: VideoTemplate) => {
    setSelectedTemplate(template); setPrompt(template.prompt); setDuration(template.duration); setRatio(template.ratio)
    document.getElementById('video-input-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleClearTemplate = () => { setSelectedTemplate(null); setPrompt(''); clearAllImages() }
  const handleReset = () => {
    setResult(null); setSubmitId(null); setIsPolling(false); setQueueMessage('')
    setPollCount(0); setElapsedMinutes(0); setError(null); setCopied(false)
    setPrompt(''); setSelectedTemplate(null); clearAllImages()
    if (TASK_KEY) localStorage.removeItem(TASK_KEY)
    // Also clear legacy shared key to fix existing cross-user pollution
    localStorage.removeItem('yooclaw_active_video_task')
  }

  const genTypeConfig = GEN_TYPE_CONFIG.find(g => g.key === genType)!
  const GenIcon = genTypeConfig.icon
  const modelLabel = MODEL_VERSIONS.find(m => m.value === modelVersion)?.label || modelVersion

  const anyOpen = openGenType || openModel || openRatio || openDuration
  const closeAll = () => { setOpenGenType(false); setOpenModel(false); setOpenRatio(false); setOpenDuration(false) }

  // Dropdown button component
  const DropdownBtn = ({ label, icon: Icon, onClick, open }: { label: string; icon?: any; onClick: () => void; open: boolean }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border
        ${open ? 'bg-white/10 border-white/20 text-foreground' : 'bg-transparent border-white/10 text-foreground/80 hover:bg-white/5 hover:border-white/20'}`}
    >
      {Icon && <Icon size={15} />}
      <span>{label}</span>
      <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )

  // Dark overlay backdrop
  const DropdownBackdrop = ({ show }: { show: boolean }) => (
    show ? <div className="fixed inset-0 bg-black/40 z-40" onClick={closeAll} /> : null
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-3 sm:px-5 md:px-6 py-3 sm:py-5 md:py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />返回首页
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
              <LayoutDashboard size={14} />回到对话
            </button>
          </div>
        </div>

        {/* ===== Main Input / Status / Result Area ===== */}
        <div className="space-y-4 sm:space-y-5">
            {/* Hero Title */}
            <div className="text-center sm:text-left mb-2">
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent inline-flex items-center gap-2">
                <Clapperboard size={22} className="text-purple-400" />
                AI 视频创作
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                使用即梦 Seedance 系列模型，文字、图片一键生成视频
              </p>
            </div>

            {/* Image previews (above input) */}
            {needsImage && imageFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {imagePreviews.map((preview, idx) => (
                  <div key={idx} className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden border border-border/50 group flex-shrink-0">
                    <img src={preview} alt={`img-${idx}`} className="w-full h-full object-cover" />
                    {genType === 'frames2video' && (
                      <div className={`absolute top-1 left-1 px-1 py-0.5 rounded text-[10px] font-bold ${idx === 0 ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                        {idx === 0 ? '首帧' : '尾帧'}
                      </div>
                    )}
                    <button onClick={() => handleRemoveImage(idx)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}
                {imageFiles.length < maxImages && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg border-2 border-dashed border-border/40 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors flex-shrink-0"
                  >
                    <Plus size={18} />
                    <span className="text-[10px] mt-0.5">添加</span>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
              </div>
            )}

            {/* Upload prompt (no images yet) */}
            {needsImage && imageFiles.length === 0 && (
              <div className="flex gap-3">
                <div className="w-[40%] flex-shrink-0">
                  {genType === 'frames2video' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed border-emerald-500/30 bg-emerald-500/5 cursor-pointer hover:bg-emerald-500/10 hover:border-emerald-500/50 transition-all min-h-[90px]"
                      >
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                          <Upload size={20} className="text-emerald-400" />
                        </div>
                        <div className="text-center">
                          <p className="text-xs font-medium text-emerald-400">首帧</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">起始画面</p>
                        </div>
                      </div>
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed border-amber-500/30 bg-amber-500/5 cursor-pointer hover:bg-amber-500/10 hover:border-amber-500/50 transition-all min-h-[90px]"
                      >
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                          <Upload size={20} className="text-amber-400" />
                        </div>
                        <div className="text-center">
                          <p className="text-xs font-medium text-amber-400">尾帧</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">结束画面</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-border/40 bg-card/40 cursor-pointer hover:bg-card/60 hover:border-primary/30 transition-all h-full"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Upload size={18} className="text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">点击上传图片</p>
                        <p className="text-xs text-muted-foreground">{genType === 'multiframe2video' ? '至少 2 张，最多 20 张' : '支持 JPG/PNG/WebP，最大 20MB'}</p>
                      </div>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageChange} className="hidden" />
                </div>
                {/* Guide next to upload */}
                <div className="flex-1 p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-muted-foreground leading-relaxed">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <GenIcon size={13} className="text-primary" />
                    <span className="font-medium text-foreground">{genTypeConfig.label}</span>
                  </div>
                  {genType === 'image2video' && '上传 1 张图片，搭配文字描述让图片动起来。'}
                  {genType === 'multimodal2video' && '最多 9 张图/视频/音频参考。在提示词中输入 @ 引用已上传文件。'}
                  {genType === 'multiframe2video' && '2–20 张图片串联故事，可添加过渡描述。'}
                  {genType === 'frames2video' && '上传首尾帧两张图片，AI 自动补间。比例自动匹配。'}
                  {genType === 'image_upscale' && '上传 1 张图片，超分放大至 2K/4K/8K。'}
                </div>
              </div>
            )}

            {/* Mode guide — always visible when mode needs images (shown after upload) */}
            {needsImage && imageFiles.length > 0 && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <GenIcon size={15} className="text-primary" />
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">{genTypeConfig.label}</span>
                  {' — '}
                  {genType === 'image2video' && '上传 1 张图片，搭配文字描述让图片动起来。'}
                  {genType === 'multimodal2video' && '最多 9 张图/视频/音频参考。在提示词中输入 @ 引用已上传文件。'}
                  {genType === 'multiframe2video' && '2–20 张图片串联故事，可添加过渡描述。'}
                  {genType === 'frames2video' && '上传首尾帧两张图片，AI 自动补间。比例自动匹配。'}
                  {genType === 'image_upscale' && '上传 1 张图片，超分放大至 2K/4K/8K。'}
                </div>
              </div>
            )}

            {/* Mode guide for text-only modes */}
            {!needsImage && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <GenIcon size={15} className="text-primary" />
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">{genTypeConfig.label}</span>
                  {' — 输入文字描述，AI 即可生成视频。支持设置画面比例和时长。'}
                </div>
              </div>
            )}

            {/* Transition prompts */}
            {genType === 'multiframe2video' && imageFiles.length >= 2 && (
              <div className="space-y-2 p-3 rounded-xl bg-card/40 border border-border/30">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Film size={13} />过渡描述
                </div>
                {transitionPrompts.map((tp, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 w-10">图{idx + 1}→{idx + 2}</span>
                    <input
                      value={tp}
                      onChange={e => setTransitionPrompts(prev => { const n = [...prev]; n[idx] = e.target.value; return n })}
                      placeholder={`描述变化...`}
                      className="flex-1 min-w-0 px-2.5 py-1.5 bg-background border border-border/40 rounded-lg text-xs outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <input
                      type="number" min="0.5" max="8" step="0.5"
                      value={transitionDurations[idx]}
                      onChange={e => setTransitionDurations(prev => { const n = [...prev]; n[idx] = e.target.value; return n })}
                      className="w-14 px-1.5 py-1.5 bg-background border border-border/40 rounded-lg text-xs text-center outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <span className="text-[10px] text-muted-foreground">秒</span>
                  </div>
                ))}
              </div>
            )}

            {/* ===== Main Input Box (Seedance Style) ===== */}
            <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-sm">
              {/* Textarea */}
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={handlePromptChange}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder={
                    genType === 'multimodal2video' ? '描述你想要的视频效果，输入 @ 引用已上传的参考文件...' :
                    genType === 'frames2video' ? '描述首帧到尾帧的过渡效果...' :
                    genType === 'multiframe2video' ? '描述整体故事风格...' :
                    '描述你想要生成的视频内容...'
                  }
                  className="w-full min-h-[120px] sm:min-h-[140px] px-4 pt-4 pb-2 bg-transparent text-sm sm:text-base outline-none resize-none placeholder:text-muted-foreground/40 leading-relaxed"
                  style={{ maxHeight: '240px' }}
                />
                {/* @-mention dropdown */}
                {showMentions && imagePreviews.length > 0 && (() => {
                  const files = getMentionFiles()
                  if (files.length === 0) return null
                  return (
                  <div className="absolute left-4 right-4 bottom-2 z-50 bg-[#1e1e2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 space-y-1 max-h-[200px] overflow-y-auto">
                    <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
                      <span>引用已上传的参考文件（↑↓选择 Enter确认 Esc关闭）</span>
                    </div>
                    {files.map((f, idx) => (
                        <button
                          key={f.index}
                          onClick={() => handleInsertMention(f.label)}
                          onMouseEnter={() => setSelectedMentionIdx(idx)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left ${idx === selectedMentionIdx ? 'bg-primary/15 ring-1 ring-primary/30' : 'hover:bg-white/5'}`}
                        >
                          <div className="w-10 h-10 rounded-md overflow-hidden border border-white/10 flex-shrink-0 bg-black/20">
                            <img src={f.preview} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <div className="text-xs font-medium text-foreground">@{f.label}</div>
                            <div className="text-[10px] text-muted-foreground">图片参考</div>
                          </div>
                        </button>
                    ))}
                  </div>
                  )
                })()}
              </div>

              {/* Bottom Control Bar */}
              <div className="px-3 pb-3 pt-1 relative">
                <DropdownBackdrop show={anyOpen} />
                <div className="flex flex-wrap items-center gap-2 relative z-50">
                  {/* Generation Type Dropdown */}
                  <div className="relative" ref={genTypeRef}>
                    <DropdownBtn
                      label={genTypeConfig.label}
                      icon={GenIcon}
                      open={openGenType}
                      onClick={() => { const v = !openGenType; closeAll(); setOpenGenType(v) }}
                    />
                    {openGenType && (
                      <div className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-2xl border border-white/10 bg-[#1e1e2e]/95 backdrop-blur-xl shadow-2xl p-2 space-y-1">
                        {GEN_TYPE_CONFIG.map(opt => {
                          const OIcon = opt.icon
                          const active = genType === opt.key
                          return (
                            <button
                              key={opt.key}
                              onClick={() => { setGenType(opt.key); clearAllImages(); setPrompt(''); setOpenGenType(false) }}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}
                            >
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-primary/20 text-primary' : 'bg-white/5 text-foreground/60'}`}>
                                <OIcon size={16} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm font-medium ${active ? 'text-foreground' : 'text-foreground/80'}`}>{opt.label}</div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {opt.key === 'text2video' && '文字描述生成视频'}
                                  {opt.key === 'image2video' && '单张图片 + 描述生成视频'}
                                  {opt.key === 'multimodal2video' && '多图/视频/音频参考生成'}
                                  {opt.key === 'multiframe2video' && '多张图片连贯故事视频'}
                                  {opt.key === 'frames2video' && '首帧到尾帧过渡视频'}
                                  {opt.key === 'image_upscale' && '图片超分放大 2K/4K/8K'}
                                </div>
                              </div>
                              {active && <Check size={16} className="text-primary flex-shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Model Version Dropdown */}
                  {supportsModel && (
                    <div className="relative" ref={modelRef}>
                      <DropdownBtn
                        label={modelLabel}
                        icon={Box}
                        open={openModel}
                        onClick={() => { const v = !openModel; closeAll(); setOpenModel(v) }}
                      />
                      {openModel && (
                        <div className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-2xl border border-white/10 bg-[#1e1e2e]/95 backdrop-blur-xl shadow-2xl p-2 space-y-1">
                          {MODEL_VERSIONS.map(m => {
                            const active = modelVersion === m.value
                            return (
                              <button
                                key={m.value}
                                onClick={() => { setModelVersion(m.value); setOpenModel(false) }}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}
                              >
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-primary/20 text-primary' : 'bg-white/5 text-foreground/60'}`}>
                                  <Diamond size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium ${active ? 'text-foreground' : 'text-foreground/80'}`}>{m.label}</div>
                                  <div className="text-[11px] text-muted-foreground truncate">{m.desc}</div>
                                </div>
                                {active && <Check size={16} className="text-primary flex-shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ratio Dropdown */}
                  {['text2video', 'multimodal2video', 'image2video'].includes(genType) && (
                    <div className="relative" ref={ratioRef}>
                      <DropdownBtn
                        label={ratio}
                        open={openRatio}
                        onClick={() => { const v = !openRatio; closeAll(); setOpenRatio(v) }}
                      />
                      {openRatio && (
                        <div className="absolute bottom-full left-0 mb-2 z-50 w-48 rounded-2xl border border-white/10 bg-[#1e1e2e]/95 backdrop-blur-xl shadow-2xl p-2 space-y-0.5">
                          {[
                            { value: '16:9', label: '16:9', desc: '横屏 · 电影/广告' },
                            { value: '9:16', label: '9:16', desc: '竖屏 · 短视频' },
                            { value: '1:1', label: '1:1', desc: '方形 · 社交媒体' },
                            { value: '4:3', label: '4:3', desc: '标准 · 传统视频' },
                            { value: '3:4', label: '3:4', desc: '竖方 · 图文内容' },
                          ].map(r => {
                            const active = ratio === r.value
                            return (
                              <button key={r.value} onClick={() => { setRatio(r.value); setOpenRatio(false) }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${active ? 'bg-primary/20 text-primary' : 'bg-white/5 text-foreground/60'}`}>
                                  {r.value}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium ${active ? 'text-foreground' : 'text-foreground/80'}`}>{r.label}</div>
                                  <div className="text-[11px] text-muted-foreground">{r.desc}</div>
                                </div>
                                {active && <Check size={16} className="text-primary flex-shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Duration Dropdown */}
                  {genType !== 'image_upscale' && (
                    <div className="relative" ref={durationRef}>
                      <DropdownBtn
                        label={genType === 'multiframe2video' ? '过渡决定' : `${duration}s`}
                        open={openDuration}
                        onClick={() => { const v = !openDuration; closeAll(); setOpenDuration(v) }}
                      />
                      {openDuration && genType !== 'multiframe2video' && (
                        <div className="absolute bottom-full left-0 mb-2 z-50 w-48 rounded-2xl border border-white/10 bg-[#1e1e2e]/95 backdrop-blur-xl shadow-2xl p-2 space-y-0.5">
                          {[
                            { value: '4', label: '4 秒', desc: '快速预览' },
                            { value: '5', label: '5 秒', desc: '短视频' },
                            { value: '8', label: '8 秒', desc: '标准片段' },
                            { value: '10', label: '10 秒', desc: '较长片段' },
                            { value: '15', label: '15 秒', desc: '最长支持' },
                          ].map(d => {
                            const active = duration === d.value
                            return (
                              <button key={d.value} onClick={() => { setDuration(d.value); setOpenDuration(false) }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all ${active ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-primary/20 text-primary' : 'bg-white/5 text-foreground/60'}`}>
                                  <Clock size={14} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium ${active ? 'text-foreground' : 'text-foreground/80'}`}>{d.label}</div>
                                  <div className="text-[11px] text-muted-foreground">{d.desc}</div>
                                </div>
                                {active && <Check size={16} className="text-primary flex-shrink-0" />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Submit Button */}
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || (needsPrompt && !prompt.trim()) || (needsImage && imageFiles.length < minImages)}
                    className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 relative z-50"
                  >
                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  </button>
                </div>
              </div>
            </div>

            {/* ===== Inline Generation Status ===== */}
            {(isSubmitting || isPolling) && (
              <div className="rounded-2xl border border-yellow-500/30 bg-card/60 backdrop-blur-sm p-4 sm:p-5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-yellow-500/10 flex items-center justify-center animate-pulse">
                      <Loader2 size={18} className="text-yellow-500 animate-spin" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-yellow-500">
                        {isSubmitting ? '提交中...' : genType === 'image_upscale' ? '图片放大中' : '视频生成中'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{genTypeConfig.label}</p>
                    </div>
                  </div>
                  {isPolling && (
                  <button
                    onClick={async () => {
                      if (pollingRef.current) clearInterval(pollingRef.current)
                      if (submitId) {
                        try { await cancelVideoTask(submitId) } catch {}
                      }
                      setIsPolling(false)
                      setShowMentions(false)
                    }}
                    className="px-3 py-1.5 text-xs border border-border/50 rounded-lg text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all"
                  >
                    取消生成
                  </button>
                  )}
                </div>
                <div className="bg-muted/30 rounded-xl p-3 space-y-2">
                  {isSubmitting && (
                    <div className="flex items-center gap-2 text-xs sm:text-sm">
                      <Loader2 size={15} className="text-yellow-500 animate-spin flex-shrink-0" />
                      <span className="text-muted-foreground">正在提交视频生成任务...</span>
                    </div>
                  )}
                  {isPolling && queueMessage && (
                    <div className="flex items-center gap-2 text-xs sm:text-sm">
                      <Users size={15} className="text-orange-400 flex-shrink-0" />
                      <span className="text-foreground font-medium">{queueMessage}</span>
                    </div>
                  )}
                  {isPolling && !queueMessage && (
                    <div className="flex items-center gap-2 text-xs sm:text-sm">
                      <Clock size={15} className="text-orange-400 flex-shrink-0" />
                      <span className="text-foreground font-medium">排队中 · 3分钟后显示目前排队进度</span>
                    </div>
                  )}
                  {isPolling && (
                    <>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Clock size={13} className="flex-shrink-0" />
                        <span>已等待 <strong className="text-foreground">{elapsedMinutes}</strong> 分钟</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-yellow-400 via-orange-400 to-red-400 rounded-full transition-all duration-1000 animate-pulse"
                          style={{ width: estimatedMaxMinutes > 0 ? `${Math.min((elapsedMinutes / estimatedMaxMinutes) * 100, 95)}%` : '10%' }} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Template Library */}
            <div className="rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-4 sm:p-5 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Sparkles size={15} className="text-primary" />视频模板库</h3>
                {selectedTemplate && (<button onClick={handleClearTemplate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"><X size={12} />清空</button>)}
              </div>
              {/* Input mode filter */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
                {[
                  { key: 'all' as const, label: '全部' },
                  { key: 'image' as const, label: '图生视频' },
                  { key: 'text' as const, label: '文生视频' },
                ].map(m => (
                  <button key={m.key} onClick={() => setInputMode(m.key)} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-all flex-shrink-0 ${inputMode === m.key ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
                {templateCategories.map(cat => (
                  <button key={cat.key} onClick={() => setActiveCategory(cat.key)} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-all flex-shrink-0 ${activeCategory === cat.key ? 'bg-primary text-primary-foreground shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                    <span className="mr-1">{cat.icon}</span>{cat.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 max-h-[360px] overflow-y-auto pr-0.5 scrollbar-thin">
                {filteredTemplates.map(tpl => {
                  const isSelected = selectedTemplate?.id === tpl.id
                  return (
                    <button key={tpl.id} onClick={() => handleSelectTemplate(tpl)} className={`text-left p-3 rounded-xl border transition-all group ${isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border/30 bg-background/40 hover:border-primary/20 hover:bg-muted/30'}`}>
                      <div className="flex items-start gap-2">
                        <span className="text-lg flex-shrink-0">{tpl.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{tpl.name}</div>
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">{tpl.duration}s</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">{tpl.ratio}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive flex items-start gap-2">
                <X size={14} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}
          </div>

        {/* ===== Result UI (inline) ===== */}
        {result && (
          <div className="rounded-2xl border-2 border-green-500/20 bg-card/80 backdrop-blur-sm p-5 sm:p-6 md:p-8 space-y-5 sm:space-y-6 shadow-lg shadow-green-500/5">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                <Play size={22} className="text-green-400" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-green-400">生成成功!</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{result.title}</p>
              </div>
            </div>
            {result.url ? (
              <div className="space-y-4 sm:space-y-5">
                <div className="relative rounded-xl overflow-hidden border-2 border-border/40 bg-black shadow-xl">
                  {genType === 'image_upscale' ? (
                    <img src={result.url} alt="Upscaled" className="w-full object-contain" />
                  ) : (
                    <>
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-black/0 via-black/0 to-black/60 pointer-events-none z-10" />
                      <video src={result.url} controls playsInline className="w-full aspect-video object-contain">
                        您的浏览器不支持视频播放
                      </video>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 bg-muted/40 rounded-xl p-2.5 sm:p-3">
                  <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 flex items-center gap-2 hover:opacity-80 transition-opacity">
                    <ExternalLink size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="text-[10px] sm:text-xs text-muted-foreground truncate select-all">{result.url}</span>
                  </a>
                  <button onClick={handleCopy} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:py-2 bg-primary text-primary-foreground rounded-lg text-[10px] sm:text-xs font-semibold hover:bg-primary/90 transition-colors shadow-sm">
                    {copied ? '✓ 已复制' : <><Copy size={12} /> 复制</>}
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <button onClick={handleDownload} disabled={downloading} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl text-xs sm:text-sm font-semibold hover:from-emerald-600 hover:to-teal-600 transition-all disabled:opacity-60 disabled:cursor-wait shadow-lg shadow-emerald-500/20">
                    {downloading ? <><Loader2 size={16} className="animate-spin" />下载中 {downloadProgress > 0 ? `${downloadProgress}%` : ''}</> : <><Download size={16} />下载</>}
                  </button>
                  <button onClick={() => window.open(result.url, '_blank')} className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 border border-border/60 rounded-xl text-xs sm:text-sm font-medium hover:bg-muted/50 transition-all">
                    <ExternalLink size={14} />新窗口
                  </button>
                  <button onClick={handleReset} className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 border border-border/60 rounded-xl text-xs sm:text-sm font-medium hover:bg-muted/50 transition-all">
                    <Sparkles size={14} />重新生成
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
                <p className="text-xs sm:text-sm text-yellow-400">生成完成，但未获取到结果地址，请稍后重试</p>
              </div>
            )}
          </div>
        )}

        {/* ===== My Videos ===== */}
        {!isPolling && (
          <div className="mt-6 sm:mt-8 rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-4 sm:p-5 shadow-sm">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Play size={15} className="text-primary" />我的视频
            </h3>
            <VideoHistory />
          </div>
        )}
      </div>
    </div>
  )
}
