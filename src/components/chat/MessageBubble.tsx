import type { Message } from '@/lib/types'
import { cn, formatTime } from '@/lib/utils'
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer'
import { Bot, User, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronRight, Gamepad2, ExternalLink, Copy } from 'lucide-react'
import { useState } from 'react'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4 animate-fade-in">
        <div className="flex items-start gap-2 max-w-[80%]">
          <div className="bg-primary text-primary-foreground px-4 py-3 rounded-2xl rounded-br-md shadow-sm">
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
          </div>
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User size={16} className="text-primary" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex mb-4 animate-fade-in">
      <div className="flex items-start gap-2 max-w-[85%]">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-1">
          <Bot size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground mb-1 ml-1">AI 建站助手</div>
          <div className="bg-card border border-border rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
            {message.isStreaming && !message.content ? (
              <div className="flex items-center gap-1 py-2 px-1">
                <span className="w-2 h-2 bg-primary rounded-full typing-dot" />
                <span className="w-2 h-2 bg-primary rounded-full typing-dot" />
                <span className="w-2 h-2 bg-primary rounded-full typing-dot" />
              </div>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}

            {/* Game card */}
            {message.gameUrl && (
              <div className="mt-3 border border-border rounded-xl overflow-hidden bg-gradient-to-br from-pink-50 via-white to-orange-50 dark:from-pink-950/20 dark:via-card dark:to-orange-950/20">
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center">
                      <Gamepad2 size={16} className="text-white" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{message.gameTitle || 'AI 小游戏'}</div>
                      <div className="text-xs text-muted-foreground">已部署上线，点击即可开始游玩</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={message.gameUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-br from-pink-500 to-orange-500 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                      <ExternalLink size={14} />
                      开始游戏
                    </a>
                    <button
                      onClick={() => {
                        const url = window.location.origin + message.gameUrl
                        navigator.clipboard.writeText(url).catch(() => {})
                      }}
                      className="flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="复制链接"
                    >
                      <Copy size={14} />
                      复制链接
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.toolCalls.map((tool) => (
                <div key={tool.id} className="text-xs">
                  <button
                    onClick={() => toggleTool(tool.id)}
                    className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {expandedTools.has(tool.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {tool.status === 'running' && <Loader2 size={12} className="animate-spin text-blue-500" />}
                    {tool.status === 'completed' && <CheckCircle size={12} className="text-green-500" />}
                    {tool.status === 'error' && <AlertCircle size={12} className="text-destructive" />}
                    <span>{tool.name}</span>
                  </button>
                  {expandedTools.has(tool.id) && tool.args && (
                    <pre className="mt-1 p-2 rounded bg-muted text-[11px] overflow-x-auto max-h-24">
                      {tool.args}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {!message.isStreaming && (
            <div className="text-[11px] text-muted-foreground mt-1 ml-1">
              {formatTime(message.timestamp)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
