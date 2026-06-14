import { useState, useEffect } from 'react'
import { getInvoices, getUserPayOrders, applyInvoice } from '@/lib/api'
import type { Invoice, Order } from '@/lib/types'
import { ArrowLeft, FileText, Loader2, CheckCircle, XCircle, ExternalLink, Mail, Building, User as UserIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function FapiaoPage() {
  const navigate = useNavigate()

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 申请表单
  const [showForm, setShowForm] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState('')
  const [buyerTitle, setBuyerTitle] = useState('')
  const [buyerTaxId, setBuyerTaxId] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')
  const [isEnterprise, setIsEnterprise] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [invRes, ordRes] = await Promise.all([
        getInvoices(),
        getUserPayOrders(),
      ])
      setInvoices(invRes.data?.invoices || [])
      setOrders((ordRes.data?.orders || []).filter((o: Order) =>
        o.status === 'paid' &&
        !(invRes.data?.invoices || []).some((inv: Invoice) => inv.orderId === o.id)
      ))
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!selectedOrder || !buyerTitle) return
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const res = await applyInvoice({
        orderId: selectedOrder,
        buyerTitle: isEnterprise ? buyerTitle : buyerTitle || '个人',
        buyerTaxId: isEnterprise ? buyerTaxId : undefined,
        buyerEmail: buyerEmail || undefined,
      })
      const data = res.data
      if (data) {
        setSubmitResult({ ok: true, message: data.message })
        setShowForm(false)
        loadData()
      }
    } catch (err: any) {
      setSubmitResult({ ok: false, message: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'issued': return { text: '已开具', cls: 'text-green-600 bg-green-50 dark:bg-green-900/20' }
      case 'pending': return { text: '处理中', cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' }
      case 'reversed': return { text: '已冲红', cls: 'text-red-600 bg-red-50 dark:bg-red-900/20' }
      case 'failed': return { text: '失败', cls: 'text-red-600 bg-red-50 dark:bg-red-900/20' }
      default: return { text: status, cls: 'text-muted-foreground bg-muted' }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-medium">电子发票</h1>
            <p className="text-xs text-muted-foreground">申请开具电子发票，发送到邮箱或微信卡包</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Apply section */}
        {!showForm && orders.length > 0 && (
          <button
            onClick={() => { setShowForm(true); setSubmitResult(null) }}
            className="w-full mb-6 p-4 border-2 border-dashed border-border rounded-xl hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors text-center"
          >
            <FileText size={20} className="mx-auto mb-1 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">申请开具电子发票</span>
          </button>
        )}

        {/* Invoice form */}
        {showForm && (
          <div className="bg-card border border-border rounded-xl p-5 mb-6">
            <h2 className="font-medium mb-4">申请电子发票</h2>

            <div className="space-y-4">
              {/* Order selection */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">选择已支付订单</label>
                <select
                  value={selectedOrder}
                  onChange={e => setSelectedOrder(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                >
                  <option value="">请选择订单</option>
                  {orders.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.id} - {o.productName || o.product_name} (¥{o.amountYuan || o.amount_yuan})
                    </option>
                  ))}
                </select>
              </div>

              {/* Invoice type toggle */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">发票类型</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEnterprise(false)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm transition-colors ${!isEnterprise ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700' : 'border-border hover:bg-muted'}`}
                  >
                    <UserIcon size={14} /> 个人
                  </button>
                  <button
                    onClick={() => setIsEnterprise(true)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm transition-colors ${isEnterprise ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700' : 'border-border hover:bg-muted'}`}
                  >
                    <Building size={14} /> 企业
                  </button>
                </div>
              </div>

              {/* Buyer title */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {isEnterprise ? '企业名称' : '姓名'} *
                </label>
                <input
                  type="text"
                  value={buyerTitle}
                  onChange={e => setBuyerTitle(e.target.value)}
                  placeholder={isEnterprise ? '公司全称' : '请输入姓名'}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                />
              </div>

              {/* Tax ID (enterprise only) */}
              {isEnterprise && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">统一社会信用代码 *</label>
                  <input
                    type="text"
                    value={buyerTaxId}
                    onChange={e => setBuyerTaxId(e.target.value)}
                    placeholder="例如：91110108MA01XXXXXX"
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                  />
                </div>
              )}

              {/* Email */}
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1">
                  <Mail size={12} /> 电子邮箱
                </label>
                <input
                  type="email"
                  value={buyerEmail}
                  onChange={e => setBuyerEmail(e.target.value)}
                  placeholder="选填，用于接收发票 PDF"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
                />
              </div>

              {/* Submit result */}
              {submitResult && (
                <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${submitResult.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700' : 'bg-red-50 dark:bg-red-900/20 text-red-600'}`}>
                  {submitResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                  {submitResult.message}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowForm(false); setSubmitResult(null) }}
                  className="flex-1 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !selectedOrder || !buyerTitle || (isEnterprise && !buyerTaxId)}
                  className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                  {submitting ? '提交中...' : '提交申请'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Invoice list */}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
        ) : invoices.length === 0 && !showForm ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">暂无发票记录</p>
            <p className="text-xs mt-1">已支付的订单可在此申请电子发票</p>
          </div>
        ) : (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-3">发票记录</h2>
            <div className="space-y-3">
              {invoices.map(inv => {
                const st = getStatusLabel(inv.status)
                return (
                  <div key={inv.id} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + st.cls}>{st.text}</span>
                          {inv.buyerEmail && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Mail size={10} /> {inv.buyerEmail}
                            </span>
                          )}
                        </div>
                        <p className="text-sm truncate">
                          {inv.buyerTaxId ? (
                            <span className="flex items-center gap-1"><Building size={12} className="text-muted-foreground shrink-0" /> {inv.buyerTitle}</span>
                          ) : (
                            <span className="flex items-center gap-1"><UserIcon size={12} className="text-muted-foreground shrink-0" /> {inv.buyerTitle}</span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          订单号：{inv.orderId}
                          {inv.fpqqlsh && ` · 流水号：${inv.fpqqlsh}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-medium">¥{(inv.totalAmount / 100).toFixed(2)}</p>
                        <p className="text-[10px] text-muted-foreground/50">
                          {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('zh-CN') : ''}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
