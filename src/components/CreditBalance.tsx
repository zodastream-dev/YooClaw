import { useState, useEffect } from 'react'
import { Zap, Loader2 } from 'lucide-react'
import { getUserCredits, getUserMembership } from '@/lib/api'

interface CreditBalanceProps {
  compact?: boolean
}

export function CreditBalance({ compact = false }: CreditBalanceProps) {
  const [credits, setCredits] = useState<number | null>(null)
  const [tier, setTier] = useState<string>('free')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadInfo()
  }, [])

  const loadInfo = async () => {
    try {
      const [credRes, membRes] = await Promise.all([
        getUserCredits().catch(() => ({ data: { balance: 0 } })),
        getUserMembership().catch(() => ({ data: { tier: 'free', membership: null } })),
      ])
      setCredits(credRes.data?.balance ?? 0)
      setTier(membRes.data?.tier || 'free')
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const tierLabel: Record<string, string> = {
    free: '免费版',
    basic: '基础会员',
    premium: '高级会员',
  }

  const tierColor: Record<string, string> = {
    free: 'text-muted-foreground',
    basic: 'text-blue-600 dark:text-blue-400',
    premium: 'text-amber-600 dark:text-amber-400',
  }

  if (loading) {
    return <div className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /></div>
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className={tierColor[tier] || ''}>{tierLabel[tier]}</span>
        <span className="text-muted-foreground">|</span>
        <span className="text-muted-foreground flex items-center gap-1">
          <Zap size={10} /> {credits ?? 0} 积分
        </span>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">账户信息</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-muted ${tierColor[tier] || ''}`}>
          {tierLabel[tier]}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Zap size={18} className="text-amber-500" />
        <span className="text-2xl font-bold">{credits ?? 0}</span>
        <span className="text-sm text-muted-foreground">积分</span>
      </div>
    </div>
  )
}
