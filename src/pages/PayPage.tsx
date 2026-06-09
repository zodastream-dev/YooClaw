import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, CheckCircle, XCircle, Loader2, QrCode, Smartphone } from 'lucide-react'
import { getPayOrder, initiatePayment } from '@/lib/api'
import type { Order } from '@/lib/types'

export function PayPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Order | null>(null)
  const [paymentUrl, setPaymentUrl] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [method, setMethod] = useState<'wechat' | 'alipay'>('wechat')
  const [status, setStatus] = useState<'loading' | 'choosing' | 'paying' | 'paid' | 'expired' | 'error'>('loading')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (id) loadOrder()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id])

  const loadOrder = async () => {
    try {
      const res = await getPayOrder(id!)
      const o = res.data?.order
      if (!o) { setError('订单不存在'); setStatus('error'); return }

      setOrder(o)

      if (o.status === 'paid') {
        setStatus('paid')
        return
      }
      if (o.status === 'expired') {
        setStatus('expired')
        return
      }

      // If we're coming from the checkout with state
      const state = (window as any).history?.state?.usr
      if (state?.needPay === false) {
        setStatus('paid')
        return
      }

      setStatus('choosing')
    } catch (err: any) {
      setError(err.message || '加载订单失败')
      setStatus('error')
    }
  }

  const handlePay = async (selectedMethod: 'wechat' | 'alipay') => {
    setMethod(selectedMethod)
    setStatus('paying')

    try {
      const res = await initiatePayment(id!, selectedMethod)
      const data = res.data
      if (!data) throw new Error('支付初始化失败')

      setPaymentUrl(data.paymentUrl)
      if (data.qrCode) setQrCode(data.qrCode)

      if (selectedMethod === 'alipay') {
        // Redirect to Alipay
        window.location.href = data.paymentUrl
        return
      }

      // For WeChat QR code: start polling
      startPolling()
    } catch (err: any) {
      setError(err.message || '支付初始化失败')
      setStatus('error')
    }
  }

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await getPayOrder(id!)
        const o = res.data?.order
        if (o?.status === 'paid') {
          setOrder(o)
          setStatus('paid')
          clearInterval(pollRef.current)
        }
      } catch {
        // keep polling
      }
    }, 3000)
  }

  const copyToClipboard = () => {
    if (paymentUrl) {
      navigator.clipboard.writeText(paymentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const renderQRCode = () => {
    if (!qrCode) return null
    // Use a QR code image API
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`
    return (
      <div className="bg-white p-4 rounded-xl inline-block">
        <img src={qrUrl} alt="支付二维码" className="w-48 h-48" />
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <XCircle size={48} className="text-red-500 mx-auto mb-4" />
          <p className="text-lg font-medium mb-2">加载失败</p>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <button onClick={() => navigate('/pricing')} className="text-primary text-sm hover:underline">
            返回定价页
          </button>
        </div>
      </div>
    )
  }

  if (status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <XCircle size={48} className="text-yellow-500 mx-auto mb-4" />
          <p className="text-lg font-medium mb-2">订单已过期</p>
          <p className="text-muted-foreground text-sm mb-4">订单有效期为 15 分钟，请重新下单</p>
          <button onClick={() => navigate('/pricing')} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">
            重新选择
          </button>
        </div>
      </div>
    )
  }

  if (status === 'paid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={36} className="text-green-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">支付成功</h2>
          <p className="text-muted-foreground text-sm mb-2">
            {order?.order_type === 'membership' ? '会员已开通，立即享受全部权益' : '积分已到账，可以使用了'}
          </p>
          {order && (
            <p className="text-xs text-muted-foreground mb-6">
              {(order.product_name || order.productName)} - ¥{order.amount_yuan || order.amountYuan}
            </p>
          )}
          <button
            onClick={() => navigate('/profile')}
            className="bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            查看我的账户
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Back */}
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={16} /> 返回
        </button>

        {/* Order info */}
        {order && (
          <div className="bg-card border border-border rounded-xl p-5 mb-6">
            <h2 className="font-semibold mb-3">{order.product_name || order.productName}</h2>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>订单号</span>
              <span className="font-mono text-xs">{order.id}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground mt-1">
              <span>金额</span>
              <span className="text-foreground font-semibold">¥{order.amount_yuan || order.amountYuan}</span>
            </div>
          </div>
        )}

        {status === 'choosing' && (
          <div>
            {order && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6 text-center">
                <p className="text-sm text-muted-foreground mb-1">支付金额</p>
                <p className="text-3xl font-bold text-primary">¥{order.amount_yuan || order.amountYuan}</p>
                <p className="text-xs text-muted-foreground mt-1">{order.product_name || order.productName}</p>
              </div>
            )}
            <h3 className="text-lg font-semibold mb-4">选择支付方式</h3>
            <div className="space-y-3">
              <button
                onClick={() => handlePay('wechat')}
                className="w-full flex items-center gap-4 p-4 border-2 border-border rounded-xl hover:border-green-500 transition-colors bg-card"
              >
                <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                  <QrCode size={20} className="text-green-600" />
                </div>
                <div className="text-left">
                  <div className="font-medium">微信支付</div>
                  <div className="text-xs text-muted-foreground">扫码支付，安全快捷</div>
                </div>
              </button>
              <button
                onClick={() => handlePay('alipay')}
                className="w-full flex items-center gap-4 p-4 border-2 border-border rounded-xl hover:border-blue-500 transition-colors bg-card"
              >
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                  <Smartphone size={20} className="text-blue-600" />
                </div>
                <div className="text-left">
                  <div className="font-medium">支付宝</div>
                  <div className="text-xs text-muted-foreground">网页跳转支付</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {status === 'paying' && method === 'wechat' && (
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">微信扫码支付</h3>
            <p className="text-sm text-muted-foreground mb-6">请使用微信扫描下方二维码完成支付</p>

            <div className="mb-4">
              {renderQRCode()}
            </div>

            {paymentUrl && (
              <button
                onClick={copyToClipboard}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
              >
                {copied ? <CheckCircle size={16} className="text-green-500" /> : <Copy size={16} />}
                {copied ? '已复制' : '复制支付链接'}
              </button>
            )}

            <p className="text-xs text-muted-foreground mt-4">
              <Loader2 size={12} className="inline animate-spin mr-1" />
              等待支付完成...
            </p>
          </div>
        )}

        {status === 'paying' && method === 'alipay' && (
          <div className="text-center">
            <Loader2 size={32} className="animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">正在跳转到支付宝...</p>
          </div>
        )}
      </div>
    </div>
  )
}
