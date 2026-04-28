import { SUGGESTED_PROMPTS, MODES } from '@/lib/constants'
import { useChatStore } from '@/lib/store'
import { useThemeStore } from '@/lib/store'
import { Sparkles, Zap, ListChecks, MessageCircle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const iconMap = {
  Zap: Zap,
  ListChecks: ListChecks,
  MessageCircle: MessageCircle,
}

export function WelcomeView() {
  const setMode = useChatStore((s) => s.setMode)
  const currentMode = useChatStore((s) => s.currentMode)
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)

  const handlePromptClick = (prompt: string) => {
    useChatStore.getState().sendMessage?.(prompt)
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center space-y-8">
        {/* Logo & Title */}
        <div className="space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <Sparkles size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">你好，我是 AI 建站助手</h1>
          <p className="text-muted-foreground">告诉我你想创建什么样的网站，我来帮你实现</p>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((mode) => {
            const Icon = iconMap[mode.icon as keyof typeof iconMap] || Zap
            return (
              <button
                key={mode.id}
                onClick={() => setMode(mode.id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center',
                  currentMode === mode.id
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-card hover:border-primary/30 hover:bg-card/80'
                )}
              >
                <Icon size={20} className={cn(currentMode === mode.id ? 'text-primary' : 'text-muted-foreground')} />
                <div className="text-xs font-medium">{mode.label}</div>
                <div className="text-[11px] text-muted-foreground">{mode.desc}</div>
              </button>
            )
          })}
        </div>

        {/* Suggested Prompts */}
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">试试这些：</p>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => handlePromptClick(prompt)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-accent hover:border-primary/30 transition-all"
              >
                {prompt}
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
