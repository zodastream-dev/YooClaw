import { useEffect, useRef } from 'react'
import { useChatStore } from '@/lib/store'
import { MessageBubble } from './MessageBubble'
import { WelcomeView } from './WelcomeView'

export function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
