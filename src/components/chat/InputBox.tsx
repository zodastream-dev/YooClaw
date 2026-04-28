import { useState, useRef, useCallback, KeyboardEvent } from 'react'
import { useChatStore } from '@/lib/store'
import { Send, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

export function InputBox() {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = useChatStore((s) => s.isStreaming)

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
    }
  }, [])

  const handleSend = useCallback(() => {
    if (!text.trim() || isStreaming) return
    useChatStore.getState().sendMessage?.(text.trim())
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, isStreaming])

  const handleStop = useCallback(() => {
    useChatStore.getState().stopGeneration?.()
  }, [])

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-sm px-4 md:px-6 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要创建的网站..."
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed px-2 py-1.5 max-h-[180px] placeholder:text-muted-foreground"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="flex-shrink-0 w-9 h-9 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center justify-center transition-colors"
              title="停止生成"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className={cn(
                'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                text.trim()
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
              title="发送"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <div className="text-center mt-2 text-[11px] text-muted-foreground">
          AI 可能会犯错，请核实重要信息
        </div>
      </div>
    </div>
  )
}
