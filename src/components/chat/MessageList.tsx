import { useEffect, useRef } from 'react'
import { useChatStore } from '@/lib/store'
import { MessageBubble } from './MessageBubble'
import { WelcomeView } from './WelcomeView'
import { Loader2 } from 'lucide-react'

export function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const isLoadingHistory = useChatStore((s) => s.isLoadingHistory)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (isLoadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 size={28} className="animate-spin" />
          <span className="text-sm">加载历史消息...</span>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return <WelcomeView />
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
      <div className="max-w-3xl mx-auto">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
