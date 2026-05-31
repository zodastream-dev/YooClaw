import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Bot, Palette, Music, MessageSquare, Check, Image as ImageIcon, Play, Pause } from 'lucide-react'
import type { SceneTemplate } from '@/data/videoScenes'
import { STYLES, DEFAULT_STYLE_ID, BGM_OPTIONS, DEFAULT_BGM_ID, type VideoStyle, type BgmOption } from '@/data/videoStyles'
import { generateVideoPayload } from '@/data/promptBuilder'

interface PromptEditorModalProps {
  scene: SceneTemplate
  currentStyleId: string
  currentUserInput: string
  imagePreviews: { id: string; url: string }[]
  onSave: (finalPrompt: string) => void
  onClose: () => void
}

// ============================================================
// 试听引擎 — 优先播放真实音频文件，合成音作为兜底
// ============================================================
function playBgmPreview(bgmId: string, audioUrl?: string) {
  ;(window as any).__bgmCtx?.close()

  // If a real audio file is provided, play it
  if (audioUrl) {
    const audio = document.createElement('audio')
    audio.src = audioUrl
    audio.volume = 0.6
    audio.preload = 'auto'
    ;(window as any).__bgmCtx = audio
    audio.onloadeddata = () => { audio.play().catch((e) => console.log('BGM play error:', e)) }
    audio.onerror = () => { console.log('BGM load error:', audio.error) }
    audio.load()
    return
  }
  const ctx = new AudioContext()
  ;(window as any).__bgmCtx = ctx
  ctx.resume()
  const NOW = ctx.currentTime + 0.05

  function note(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(vol, start + 0.02)
    g.gain.linearRampToValueAtTime(vol * 0.7, start + dur * 0.3)
    g.gain.setValueAtTime(vol * 0.7, start + dur * 0.6)
    g.gain.linearRampToValueAtTime(0, start + dur)
    o.connect(g); g.connect(ctx.destination)
    o.start(start); o.stop(start + dur)
  }

  switch (bgmId) {
    case 'interstellar':
      [[130.81,155.56,196.00],[103.83,130.81,155.56],[155.56,196.00,233.08],[116.54,146.83,174.61]]
        .forEach((ch,i) => { const t=NOW+i*1.8; ch.forEach(f=>{note(f,t,1.6,0.12);note(f*2,t,1.6,0.06);note(f*3,t,1.6,0.03)}); note(ch[0]/2,t,1.6,0.18) })
      break
    case 'light_piano':
      [523.25,587.33,659.25,783.99,880.00,783.99,659.25,523.25,440.00,523.25,587.33,659.25]
        .forEach((f,i)=>note(f,NOW+i*0.22,0.16,0.2,'triangle'))
      [[261.63,329.63,392.00],[293.66,349.23,440.00]].forEach((ch,i)=>ch.forEach(f=>note(f,NOW+i*3,2.5,0.06,'triangle')))
      break
    case 'electronic_beat':
      for(let i=0;i<16;i++)if([0,3,6,9,12,15].includes(i)){
        const t2=NOW+i*0.25,o=ctx.createOscillator();o.type='sine';o.frequency.setValueAtTime(150,t2);o.frequency.linearRampToValueAtTime(40,t2+0.1)
        const g2=ctx.createGain();g2.gain.setValueAtTime(0.4,t2);g2.gain.exponentialRampToValueAtTime(0.001,t2+0.15)
        o.connect(g2);g2.connect(ctx.destination);o.start(t2);o.stop(t2+0.15)
      }
      [130.81,130.81,164.81,146.83,130.81,110.00,98.00,110.00].forEach((f,i)=>note(f,NOW+i*0.5,0.2,0.12,'sawtooth'))
      break
    case 'string_quartet':
      [[196,246.94,293.66],[164.81,196,246.94],[130.81,164.81,196],[146.83,185,220]]
        .forEach((ch,i)=>ch.forEach((f,j)=>note(f,NOW+i*2+j*0.06,1.6,0.08)))
      break
    case 'ambient_pad':
      [[146.83,174.61,220],[110,130.81,164.81],[130.81,164.81,196],[98,123.47,146.83]]
        .forEach((ch,i)=>ch.forEach(f=>{note(f,NOW+i*2,2,0.04);note(f*2,NOW+i*2,2,0.02)}))
      for(let i=0;i<8;i++)note(880+i*220,NOW+i*0.8,0.5,0.015)
      break
    case 'custom':
    case 'none': break
  }
  setTimeout(()=>ctx.close(),9000)
}

export function PromptEditorModal({
  scene, currentStyleId, currentUserInput, imagePreviews, onSave, onClose,
}: PromptEditorModalProps) {
  const initialPayload = generateVideoPayload(scene.id, currentStyleId, currentUserInput)

  const [basePrompt, setBasePrompt] = useState(initialPayload.prompt)
  const [styleId, setStyleId] = useState(currentStyleId || DEFAULT_STYLE_ID)
  const [styleText, setStyleText] = useState('')
  const [showDialogue, setShowDialogue] = useState(false)
  const [dialogueText, setDialogueText] = useState('')
  const [bgmId, setBgmId] = useState(DEFAULT_BGM_ID)
  const [showAtMention, setShowAtMention] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [atIdx, setAtIdx] = useState(0)
  const [playingBgm, setPlayingBgm] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ===== Draggable =====
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [hasMoved, setHasMoved] = useState(false)
  const dragRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) return
    setDragging(true)
    setHasMoved(false)
    setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y })
  }, [pos])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
      setHasMoved(true)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, dragStart])

  // Reset pos on new scene
  useEffect(() => { setPos({ x: 0, y: 0 }) }, [scene.id])

  // ===== Style text sync =====
  useEffect(() => {
    const style = STYLES[styleId]
    if (style) {
      setStyleText(`视频风格：${style.lighting}，${style.atmosphere}，${style.render}，${style.colorGrade}调色`)
    }
  }, [styleId])

  // ===== Handle @ mention =====
  const handleBasePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setBasePrompt(value)
    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPos)
    const atPos = textBeforeCursor.lastIndexOf('@')
    if (atPos >= 0 && imagePreviews.length > 0) {
      const afterAt = textBeforeCursor.slice(atPos + 1)
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setShowAtMention(true)
        setAtFilter(afterAt)
        setAtIdx(atPos)
        return
      }
    }
    setShowAtMention(false)
  }

  const handleInsertImage = (img: { id: string; url: string }) => {
    if (!atIdx && atIdx !== 0) return
    const before = basePrompt.slice(0, atIdx)
    const after = basePrompt.slice(textareaRef.current?.selectionStart || atIdx)
    const ref = `@img:${img.id}`
    setBasePrompt(`${before}${ref} ${after}`)
    setShowAtMention(false)
  }

  // ===== BGM 试听 =====
  const handleBgmPreview = (id: string) => {
    if (playingBgm === id) {
      setPlayingBgm(null)
      ;(window as any).__bgmCtx?.close?.() || (window as any).__bgmCtx?.pause?.()
      return
    }
    setPlayingBgm(id)
    const bgm = BGM_OPTIONS.find(b => b.id === id)
    playBgmPreview(id, bgm?.audioUrl)
    setTimeout(() => setPlayingBgm(null), 12000)
  }

  // ===== Build final prompt =====
  const handleSave = () => {
    const parts: string[] = [basePrompt.trim()]
    if (styleText.trim()) parts.push(styleText.trim())
    if (showDialogue && dialogueText.trim()) {
      parts.push(`人物对话：${dialogueText.trim()}。人物讲解时要有气口，配合肢体动作，讲解有感染力，专业主播风`)
    }
    const bgm = BGM_OPTIONS.find(b => b.id === bgmId)
    if (bgm && bgm.promptText) parts.push(bgm.promptText)
    onSave(parts.join('\n'))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !hasMoved) onClose() }}>
      <div
        ref={dragRef}
        className="bg-card border border-border/30 rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[92vh] overflow-hidden flex flex-col"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: dragging ? 'grabbing' : 'default' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="flex items-center justify-between px-5 py-3.5 border-b border-border/30 bg-card/95 backdrop-blur-sm flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
        >
          <div>
            <h3 className="text-base font-bold">{scene.label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">编辑提示词 · {scene.duration}s</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"><X size={18} /></button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 1. Base Prompt */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 mb-2">
              <Bot size={14} className="text-primary" />基本提示词
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={basePrompt}
                onChange={handleBasePromptChange}
                rows={6}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border/30 rounded-xl outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-muted-foreground/40 transition-all"
                placeholder="输入或编辑提示词，输入 @ 引用已上传的图片..."
              />
            </div>
            {/* @ mention dropdown — show thumbnails not just text */}
            {showAtMention && imagePreviews.length > 0 && (
              <div className="mt-1 border border-border/30 rounded-lg bg-card shadow-lg p-1.5">
                <div className="flex gap-2 overflow-x-auto">
                  {imagePreviews.filter(img => !atFilter || img.id.includes(atFilter)).map(img => (
                    <button key={img.id} onClick={() => handleInsertImage(img)}
                      className="flex-shrink-0 flex flex-col items-center gap-0.5 hover:opacity-80 transition-opacity">
                      <img src={img.url} alt={img.id} className="w-14 h-14 rounded-lg border border-border/30 object-cover" />
                      <span className="text-[9px] text-muted-foreground">@{img.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Always-visible image thumbnail strip */}
            {imagePreviews.length > 0 && !showAtMention && (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                  <ImageIcon size={11} />已上传图片（点击引用，或输入 @ 搜索）
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {imagePreviews.map(img => (
                    <button key={img.id} onClick={() => setBasePrompt(prev => prev + ` @img:${img.id}`)}
                      className="flex-shrink-0 w-16 h-16 rounded-xl border border-border/30 overflow-hidden hover:border-primary/50 hover:ring-1 hover:ring-primary/20 transition-all group relative">
                      <img src={img.url} alt={img.id} className="w-full h-full object-cover" />
                      <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-all">
                        <span className="text-[8px] text-white opacity-0 group-hover:opacity-100 bg-black/50 px-1.5 py-0.5 rounded">引用</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. Style dropdown */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 mb-2">
              <Palette size={14} className="text-violet-400" />视频风格
            </label>
            <select value={styleId} onChange={e => setStyleId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-background border border-border/30 rounded-xl outline-none focus:border-primary/40 cursor-pointer transition-all appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}>
              <option value="">— 自定义 / 留空 —</option>
              {Object.values(STYLES).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <textarea value={styleText} onChange={e => setStyleText(e.target.value)}
              rows={3}
              className="w-full mt-2 px-3 py-2.5 text-sm bg-background border border-border/20 rounded-lg outline-none focus:border-primary/30 resize-none text-muted-foreground transition-all"
              placeholder="可编辑风格描述..." />
          </div>

          {/* 3. Dialogue toggle + input */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input type="checkbox" checked={showDialogue} onChange={e => setShowDialogue(e.target.checked)}
                className="w-4 h-4 rounded border-border/50 text-primary focus:ring-primary/20 cursor-pointer" />
              <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                <MessageSquare size={14} className="text-amber-400" />人物对话
              </span>
            </label>
            {showDialogue && (
              <textarea value={dialogueText} onChange={e => setDialogueText(e.target.value)}
                rows={2}
                placeholder="输入视频中人物要说的话..."
                className="w-full px-3 py-2.5 text-sm bg-background border border-border/30 rounded-xl outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-muted-foreground/40 transition-all" />
            )}
          </div>

          {/* 4. Background Music */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80 mb-2">
              <Music size={14} className="text-emerald-400" />背景音乐
            </label>
            <div className="flex gap-2">
              <select value={bgmId} onChange={e => setBgmId(e.target.value)}
                className="flex-1 px-3 py-2.5 text-sm bg-background border border-border/30 rounded-xl outline-none focus:border-primary/40 cursor-pointer transition-all appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}>
                {BGM_OPTIONS.map(b => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <button onClick={() => handleBgmPreview(bgmId)}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                  playingBgm === bgmId
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-border/30 bg-background/40 text-muted-foreground hover:border-emerald-400/30 hover:text-emerald-400'
                }`}>
                {playingBgm === bgmId ? <Pause size={14} /> : <Play size={14} />}
                试听
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-border/30 bg-muted/10 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors font-medium">取消</button>
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-semibold shadow-sm hover:shadow-md">
            <Check size={16} />保存并填充
          </button>
        </div>
      </div>
    </div>
  )
}
