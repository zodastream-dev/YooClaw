import { useState, useEffect, useRef } from 'react'
import { X, Bot, Palette, Music, MessageSquare, Check, Image as ImageIcon, AtSign } from 'lucide-react'
import type { SceneTemplate } from '@/data/videoScenes'
import { STYLES, DEFAULT_STYLE_ID, BGM_OPTIONS, DEFAULT_BGM_ID, type VideoStyle, type BgmOption } from '@/data/videoStyles'
import { generateVideoPayload } from '@/data/promptBuilder'

interface PromptEditorModalProps {
  scene: SceneTemplate
  currentStyleId: string
  currentUserInput: string
  imagePreviews: { id: string; url: string }[]  // already uploaded images for @ reference
  onSave: (finalPrompt: string) => void
  onClose: () => void
}

export function PromptEditorModal({
  scene, currentStyleId, currentUserInput, imagePreviews, onSave, onClose,
}: PromptEditorModalProps) {
  // Generate initial base prompt using the prompt builder
  const initialPayload = generateVideoPayload(scene.id, currentStyleId, currentUserInput)
  
  const [basePrompt, setBasePrompt] = useState(initialPayload.prompt)
  const [styleId, setStyleId] = useState(currentStyleId || DEFAULT_STYLE_ID)
  const [styleText, setStyleText] = useState('')
  const [showDialogue, setShowDialogue] = useState(false)
  const [dialogueText, setDialogueText] = useState('')
  const [bgmId, setBgmId] = useState(DEFAULT_BGM_ID)
  const [showImages, setShowImages] = useState(false)
  const [showAtMention, setShowAtMention] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [atIdx, setAtIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Update style text when styleId changes
  useEffect(() => {
    const style = STYLES[styleId]
    if (style) {
      setStyleText(`视频风格：${style.lighting}，${style.atmosphere}，${style.render}，${style.colorGrade}调色`)
    }
  }, [styleId])

  // Handle @ mention in base prompt textarea
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

  // Build final prompt
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-card border border-border/30 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 sticky top-0 bg-card/95 backdrop-blur-sm z-10">
          <div>
            <h3 className="text-base font-bold">{scene.label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">编辑提示词 · {scene.duration}s</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-5">
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
                rows={4}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border/30 rounded-xl outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 resize-none placeholder:text-muted-foreground/40 transition-all"
                placeholder="输入或编辑提示词，输入 @ 引用已上传的图片..."
              />
              {imagePreviews.length > 0 && (
                <button onClick={() => setShowImages(!showImages)}
                  className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  title="引用图片">
                  <ImageIcon size={14} />
                </button>
              )}
            </div>
            {/* @ mention dropdown */}
            {showAtMention && imagePreviews.length > 0 && (
              <div className="mt-1 border border-border/30 rounded-lg bg-card shadow-lg max-h-32 overflow-y-auto">
                {imagePreviews.filter(img => !atFilter || img.id.includes(atFilter)).map(img => (
                  <button key={img.id} onClick={() => handleInsertImage(img)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors text-left">
                    <ImageIcon size={12} className="text-muted-foreground" />
                    <span className="truncate">@{img.id}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Image gallery for quick reference */}
            {showImages && imagePreviews.length > 0 && (
              <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                {imagePreviews.map(img => (
                  <button key={img.id} onClick={() => {
                    setBasePrompt(prev => prev + ` @img:${img.id}`)
                    setShowImages(false)
                  }}
                    className="flex-shrink-0 w-14 h-14 rounded-lg border border-border/30 overflow-hidden hover:border-primary/40 transition-colors">
                    <img src={img.url} alt={img.id} className="w-full h-full object-cover" />
                  </button>
                ))}
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
              {Object.values(STYLES).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {styleText && (
              <textarea value={styleText} onChange={e => setStyleText(e.target.value)}
                rows={3}
                className="w-full mt-2 px-3 py-2 text-xs bg-background border border-border/20 rounded-lg outline-none focus:border-primary/30 resize-none text-muted-foreground transition-all" />
            )}
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
            <select value={bgmId} onChange={e => setBgmId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-background border border-border/30 rounded-xl outline-none focus:border-primary/40 cursor-pointer transition-all appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}>
              {BGM_OPTIONS.map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border/30 bg-muted/10 sticky bottom-0">
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
