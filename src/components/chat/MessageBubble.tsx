import type { Message } from '@/lib/types'
import { cn, formatTime } from '@/lib/utils'
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer'
import { Bot, User, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
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
