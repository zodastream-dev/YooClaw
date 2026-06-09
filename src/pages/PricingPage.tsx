import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crown, Zap, ArrowRight, Check, Sparkles, LayoutDashboard } from 'lucide-react'
import { getMembershipPlans, getCreditPackages, createPayOrder } from '@/lib/api'
import type { MembershipPlan, CreditPackage } from '@/lib/types'

export function PricingPage() {
  const navigate = useNavigate()
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [creditPackages, setCreditPackages] = useState<CreditPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<'membership' | 'credits'>('membership')
  const [buying, setBuying] = useState<number | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [planRes, pkgRes] = await Promise.all([
        getMembershipPlans().catch(() => ({ data: { plans: [] } })),
        getCreditPackages().catch(() => ({ data: { packages: [] } })),
      ])
      setPlans(planRes.data?.plans || [])
      setCreditPackages(pkgRes.data?.packages || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const handleBuy = async (type: 'membership' | 'credit_package', productId: number) => {
    const token = localStorage.getItem('codebuddy_token')
    if (!token) {
      navigate('/')
      return
    }

    setBuying(productId)
    try {
      const res = await createPayOrder(type, productId)
      if (res.data?.order) {
        navigate(`/pay/${res.data.order.id}`, {
          state: { order: res.data.order, needPay: res.data.needPay }
        })
      }
    } catch (err: any) {
      alert(err.message || '创建订单失败')
    } finally {
      setBuying(null)
    }
  }

  const tierStyles: Record<string, { bg: string; badge: string; border: string }> = {
    free: { bg: 'bg-card', badge: 'bg-muted text-muted-foreground', border: 'border-border' },
    basic: { bg: 'bg-card', badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' },
    premium: {
      bg: 'bg-gradient-to-b from-amber-50 to-card dark:from-amber-950/20 dark:to-card',
      badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      border: 'border-amber-300 dark:border-amber-700'
    },
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Back to home */}
        <button
          onClick={() => navigate('/chat')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <LayoutDashboard size={16} /> 回到首页
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-3">选择适合你的方案</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            AI 驱动的网站生成、情报分析、视频创作。选择会员解锁全部功能，积分用于 AI 功能消耗。
          </p>
        </div>

        {/* Tab Switch */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex bg-muted rounded-xl p-1">
            <button
              onClick={() => setSelectedTab('membership')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                selectedTab === 'membership' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Crown size={16} />
              会员套餐
            </button>
            <button
              onClick={() => setSelectedTab('credits')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                selectedTab === 'credits' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap size={16} />
              积分充值
            </button>
          </div>
        </div>

        {/* Membership Plans */}
        {selectedTab === 'membership' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((plan) => {
              const style = tierStyles[plan.tier] || tierStyles.free
              const features: string[] = typeof plan.features === 'string'
                ? (() => { try { return JSON.parse(plan.features) } catch { return [] } })()
                : plan.features || []

              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border ${style.border} ${style.bg} p-6 flex flex-col`}
                >
                  {plan.tier === 'premium' && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      <Sparkles size={10} /> 最受欢迎
                    </div>
                  )}
                  <div className="mb-5">
                    <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${style.badge}`}>
                      {plan.tier === 'free' ? '免费' : plan.tier === 'basic' ? '基础' : '高级'}
                    </span>
                    <h3 className="text-xl font-bold mt-3">{plan.name}</h3>
                    <div className="mt-3">
                      {plan.priceYuan === 0 ? (
                        <span className="text-3xl font-bold">免费</span>
                      ) : (
                        <>
                          <span className="text-3xl font-bold">¥{plan.priceYuan}</span>
                          <span className="text-muted-foreground text-sm ml-1">
                            / {plan.durationDays >= 365 ? '年' : '月'}
                          </span>
                        </>
                      )}
                    </div>
                    {plan.monthlyCredits > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        每月赠送 {plan.monthlyCredits} 积分
                      </p>
                    )}
                  </div>

                  <div className="flex-1 space-y-2.5 mb-6">
                    {features.map((f, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-sm">
                        <Check size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground">{f}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => handleBuy('membership', plan.id)}
                    disabled={buying === plan.id || plan.priceYuan === 0}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      plan.tier === 'premium'
                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                        : plan.tier === 'basic'
                          ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    } disabled:opacity-50`}
                  >
                    {buying === plan.id ? (
                      '处理中...'
                    ) : plan.priceYuan === 0 ? (
                      '当前方案'
                    ) : (
                      <>
                        立即开通 <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Credit Packages */}
        {selectedTab === 'credits' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {creditPackages.map((pkg) => {
              const unitPrice = (pkg.priceYuan / pkg.credits).toFixed(2)
              return (
                <div key={pkg.id} className="border border-border rounded-xl p-5 text-center hover:border-primary/30 transition-colors bg-card">
                  <div className="text-3xl font-bold text-primary mb-1">{pkg.credits}</div>
                  <div className="text-sm text-muted-foreground mb-3">积分</div>
                  <div className="text-2xl font-bold mb-1">¥{pkg.priceYuan}</div>
                  <div className="text-xs text-muted-foreground mb-4">¥{unitPrice}/积分</div>
                  <button
                    onClick={() => handleBuy('credit_package', pkg.id)}
                    disabled={buying === pkg.id}
                    className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {buying === pkg.id ? '处理中...' : '立即充值'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
