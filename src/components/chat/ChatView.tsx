import { useEffect, useCallback, useRef } from 'react'
import { MessageList } from './MessageList'
import { InputBox } from './InputBox'
import { useChatStore, useAuthStore } from '@/lib/store'
import { submitRun, streamRun, cancelRun } from '@/lib/api'
import { generateId } from '@/lib/utils'
import type { Message } from '@/lib/types'

// Track active stream abort controller
let globalAbortController: AbortController | null = null

export function ChatView() {
  const { addMessage, updateMessage, appendToMessage, setStreaming, setRunId, isStreaming, currentRunId, currentSessionId } =
    useChatStore()
  const user = useAuthStore((s) => s.user)
  const streamingMsgIdRef = useRef<string | null>(null)

  const sendMessage = useCallback(
    async (text: string) => {
      // Add user message
      const userMsg: Message = {
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      }
      addMessage(userMsg)

      // Add empty assistant message
      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        toolCalls: [],
      }
      addMessage(assistantMsg)
      streamingMsgIdRef.current = assistantMsg.id

      // Real API mode
      try {
        setStreaming(true)
        const senderInfo = user ? { id: user.id, name: user.username } : undefined
        const res = await submitRun(text, currentSessionId || undefined, senderInfo)
        const runId = res.data?.runId
        const sessionId = res.data?.sessionId
        if (!runId) throw new Error('No runId returned')
        setRunId(runId)
        if (sessionId && !currentSessionId) {
          useChatStore.getState().setCurrentSessionId(sessionId)
        }

        // Start SSE stream using async generator (fetch-based)
        const abortController = new AbortController()
        globalAbortController = abortController

        try {
          for await (const data of streamRun(runId, sessionId || currentSessionId || undefined)) {
            // Check if aborted
            if (abortController.signal.aborted) break

            if (data.type === 'agent_message_chunk') {
              const textContent = data.content?.text || data.text || ''
              if (textContent) {
                appendToMessage(assistantMsg.id, textContent)
              }
              if (data.toolCalls) {
                updateMessage(assistantMsg.id, { toolCalls: data.toolCalls })
              }
            } else if (data.type === 'game_deployed') {
              // Game generated and deployed — update the assistant message
              updateMessage(assistantMsg.id, {
                isStreaming: false,
                gameUrl: data.url || '',
                gameTitle: data.title || '小游戏',
              })
            } else if (data.type === 'run_status') {
              if (data.status === 'completed' || data.status === 'failed') {
                updateMessage(assistantMsg.id, { isStreaming: false })
                setStreaming(false)
                setRunId(null)
                // Refresh storage info
                useAuthStore.getState().fetchStorage()
                break
              }
            }
          }
        } catch (streamErr: any) {
          // Stream ended or was aborted - that's fine
          if (!abortController.signal.aborted) {
            console.error('Stream error:', streamErr.message)
          }
        }

        globalAbortController = null
        // Ensure streaming state is reset
        const currentMsg = useChatStore.getState().messages.find(m => m.id === assistantMsg.id)
        if (currentMsg?.isStreaming) {
          updateMessage(assistantMsg.id, { isStreaming: false })
          setStreaming(false)
          setRunId(null)
        }
      } catch (err: any) {
        console.error('Send message error:', err)
        const errMsg = err?.message || 'Unknown error'
        updateMessage(assistantMsg.id, {
          content: `抱歉，发送失败。\n\n**错误信息**: ${errMsg}\n\n请确认后端服务已启动，然后刷新页面重试。`,
          isStreaming: false,
        })
        setStreaming(false)
        setRunId(null)
      }
    },
    [addMessage, updateMessage, appendToMessage, setStreaming, setRunId, currentSessionId, user]
  )

  const stopGeneration = useCallback(() => {
    if (globalAbortController) {
      globalAbortController.abort()
      globalAbortController = null
    }
    if (currentRunId) {
      cancelRun(currentRunId).catch(() => {})
    }
    setStreaming(false)
    setRunId(null)
    const msgs = useChatStore.getState().messages
    const streaming = msgs.find((m) => m.isStreaming)
    if (streaming) {
      updateMessage(streaming.id, { isStreaming: false })
    }
  }, [currentRunId, setStreaming, setRunId, updateMessage])

  // Store sendMessage/stopGeneration in zustand for cross-component access
  useEffect(() => {
    useChatStore.setState({ sendMessage, stopGeneration })
  }, [sendMessage, stopGeneration])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (globalAbortController) {
        globalAbortController.abort()
        globalAbortController = null
      }
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <MessageList />
      <InputBox />
    </div>
  )
}
