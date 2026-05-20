import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateVideo, videoTaskStatus } from '@/lib/api'
import type { VideoTaskStatus } from '@/lib/api'
import { ArrowLeft, Clapperboard, Sparkles, ExternalLink, Copy, Loader2, LayoutDashboard, Play, Download, X, Clock, Users } from 'lucide-react'
import { videoTemplates, templateCategories, getTemplatesByCategory } from '@/data/videoTemplates'
import type { VideoTemplate } from '@/data/videoTemplates'

interface GeneratedVideo {
  id: string
  title: string
  url: string
}

export function VideoCreatePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')

  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedTemplate, setSelectedTemplate] = useState<VideoTemplate | null>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitId, setSubmitId] = useState<string | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [pollCount, setPollCount] = useState(0)
  const [queueMessage, setQueueMessage] = useState('')
  const [elapsedMinutes, setElapsedMinutes] = useState(0)
  const [estimatedMaxMinutes, setEstimatedMaxMinutes] = useState(0)
  const [result, setResult] = useState<GeneratedVideo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const startTimeRef = useRef<number>(0)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

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
          if (res.data.status === 'completed') {
            setIsPolling(false)
            setResult({ id: res.data.id, title: prompt.slice(0, 30) + ' 视频', url: res.data.result?.videoUrl || '' })
          } else if (res.data.status === 'failed') {
            setIsPolling(false)
            setError('视频生成失败，请稍后重试')
          }
        }
      } catch (e: any) { console.warn('Poll error:', e.message) }
    }
    poll()
    pollingRef.current = setInterval(poll, 30000)
    return () => {
      polling = false
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    }
  }, [isPolling, submitId, prompt])

  const handleSubmit = async () => {
    const p = prompt.trim()
    if (!p) return
    setIsSubmitting(true); setError(null); setResult(null)
    setQueueMessage(''); setPollCount(0); setElapsedMinutes(0)
    try {
      const res = await generateVideo({ prompt: p, duration, resolution, ratio })
      if (res.data?.id) {
        setSubmitId(res.data.id)
        startTimeRef.current = Date.now()
        setIsPolling(true)
      } else { setError(res.error?.message || '视频生成提交失败') }
    } catch (e: any) { setError(e.message || '提交失败，请稍后重试') }
    finally { setIsSubmitting(false) }
  }

  const handleCopy = async () => {
    if (!result?.url) return
    try { await navigator.clipboard.writeText(result.url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  const filteredTemplates = getTemplatesByCategory(activeCategory)

  const handleSelectTemplate = (template: VideoTemplate) => {
    setSelectedTemplate(template); setPrompt(template.prompt); setDuration(template.duration); setRatio(template.ratio)
    document.getElementById('video-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleClearTemplate = () => { setSelectedTemplate(null); setPrompt('') }

  const handleReset = () => {
    setResult(null); setSubmitId(null); setIsPolling(false); setQueueMessage('')
    setPollCount(0); setElapsedMinutes(0); setError(null); setCopied(false)
    setPrompt(''); setSelectedTemplate(null)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={16} />返回首页
          </button>
          <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <LayoutDashboard size={14} />回到对话
          </button>
        </div>
        <div className="mb-8">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Clapperboard size={22} className="text-primary" />AI 视频创作
          </h1>
          <p className="text-sm text-muted-foreground mt-1">使用即梦 Seedance 2.0 模型，文字描述直接生成精美视频</p>
        </div>
        {!result && !isPolling ? (
          <div className="space-y-5">
            <div className="border border-border rounded-xl p-5 bg-card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2"><Sparkles size={15} className="text-primary" />视频模板库</h3>
                {selectedTemplate && (<button onClick={handleClearTemplate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"><X size={13} />清空模板</button>)}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {templateCategories.map(cat => (<button key={cat.key} onClick={() => setActiveCategory(cat.key)} className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs transition-all flex-shrink-0 ${activeCategory === cat.key ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>{cat.icon} {cat.label}</button>))}
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-0.5 scrollbar-thin">
                {filteredTemplates.map(tpl => (<button key={tpl.id} onClick={() => handleSelectTemplate(tpl)} className={`text-left p-3 rounded-lg border transition-all ${selectedTemplate?.id === tpl.id ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50'}`}><div className="flex items-start gap-2"><span className="text-lg flex-shrink-0">{tpl.icon}</span><div className="min-w-0"><div className="text-xs font-medium truncate">{tpl.name}</div><div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.description}</div><div className="flex items-center gap-1.5 mt-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tpl.duration}s</span><span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tpl.ratio}</span></div></div></div></button>))}
              </div>
            </div>
            <div id="video-form" className="border border-border rounded-xl p-6 bg-card space-y-4">
              <div><label className="block text-sm font-medium mb-1.5">视频描述 <span className="text-destructive">*</span></label>
              <textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); if (selectedTemplate && e.target.value !== selectedTemplate.prompt) setSelectedTemplate(null) }} placeholder="描述你想要生成的视频内容" className="w-full min-h-[100px] px-4 py-3 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-vertical" /></div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="block text-sm font-medium mb-1.5">时长</label><select value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm outline-none"><option value="4">4 秒</option><option value="5">5 秒</option><option value="8">8 秒</option><option value="10">10 秒</option><option value="15">15 秒</option></select></div>
                <div><label className="block text-sm font-medium mb-1.5">分辨率</label><select value={resolution} onChange={(e) => setResolution(e.target.value)} className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm outline-none"><option value="720p">720p</option><option value="1080p">1080p</option></select></div>
                <div><label className="block text-sm font-medium mb-1.5">比例</label><select value={ratio} onChange={(e) => setRatio(e.target.value)} className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm outline-none"><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option></select></div>
              </div>
              <button onClick={handleSubmit} disabled={isSubmitting || !prompt.trim()} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                {isSubmitting ? <><Loader2 size={16} className="animate-spin" />正在提交...</> : <><Sparkles size={16} />开始生成</>}
              </button>
            </div>
            {error && <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">{error}</div>}
          </div>
        ) : isPolling ? (
          <div className="border border-border rounded-xl p-6 bg-card space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center"><Loader2 size={20} className="text-yellow-600 animate-spin" /></div>
              <div><h2 className="text-sm font-medium text-yellow-600">视频生成中...</h2><p className="text-xs text-muted-foreground">{prompt.slice(0, 40)}{prompt.length > 40 ? '...' : ''}</p></div>
            </div>
            <div className="bg-muted/60 rounded-lg p-4 space-y-3">
              {queueMessage && (<div className="flex items-center gap-2 text-sm"><Users size={16} className="text-orange-500" /><span className="text-foreground font-medium">{queueMessage}</span></div>)}
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock size={16} /><span>已等待 <strong className="text-foreground">{elapsedMinutes}</strong> 分钟</span>{estimatedMaxMinutes > 0 && (<span className="text-xs">（最长约 {estimatedMaxMinutes} 分钟）</span>)}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>轮询次数：{pollCount} / 60</span></div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-orange-400 via-red-400 to-pink-400 rounded-full transition-all duration-1000 animate-pulse" style={{ width: estimatedMaxMinutes > 0 ? `${Math.min((elapsedMinutes / estimatedMaxMinutes) * 100, 95)}%` : '10%' }} />
              </div>
              <p className="text-xs text-muted-foreground">视频生成可能需要较长时间（最长 5 小时），你可以关闭页面稍后回来查看。任务 ID：<code className="text-[10px] bg-muted px-1 py-0.5 rounded">{submitId?.slice(0, 12)}...</code></p>
            </div>
            <button onClick={handleReset} className="w-full px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">取消等待，返回创作</button>
          </div>
        ) : result ? (
          <div className="border border-border rounded-xl p-6 bg-card">
            <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"><Play size={20} className="text-green-600" /></div><div><h2 className="text-sm font-medium text-green-600">视频生成成功!</h2><p className="text-xs text-muted-foreground">{result.title}</p></div></div>
            {result.url ? <><div className="bg-muted rounded-lg p-4 mb-4"><video src={result.url} controls className="w-full rounded-lg" style={{ maxHeight: '360px' }}>您的浏览器不支持视频播放</video></div><div className="bg-muted rounded-lg p-4 mb-4"><div className="flex items-center gap-2"><a href={result.url} target="_blank" rel="noopener" className="flex-1 text-sm bg-background px-3 py-2 rounded border border-border truncate text-primary flex items-center gap-1.5"><ExternalLink size={13} />{result.url}</a><button onClick={handleCopy} className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium">{copied ? '已复制' : <Copy size={14} />}</button></div></div><div className="flex gap-3"><a href={result.url} target="_blank" rel="noopener" download className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium"><Download size={16} />下载视频</a><button onClick={handleReset} className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-medium">再生成一个</button></div></> : (<div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4"><p className="text-sm text-yellow-700 dark:text-yellow-300">视频生成完成，但未获取到视频地址，请稍后重试</p></div>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
