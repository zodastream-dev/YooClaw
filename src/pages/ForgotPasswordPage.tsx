import { useState } from 'react'
import { forgotPassword } from '@/lib/api'
import { Loader2, ArrowLeft } from 'lucide-react'

export function ForgotPasswordPage() {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim()) { setError('请输入用户名'); return }
    setLoading(true); setError('')
    try {
      await forgotPassword(username.trim())
      setSent(true)
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <a href="#/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={14} /> 返回登录
        </a>
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-center mb-1">找回密码</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            {sent ? '重置邮件已发送，请查收' : '输入您的用户名'}
          </p>
          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text" value={username} onChange={e => { setUsername(e.target.value); setError('') }}
                placeholder="用户名" autoFocus
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {loading ? <><Loader2 size={14} className="animate-spin inline mr-1" />发送中...</> : '发送重置邮件'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              如果该用户名已绑定邮箱，您将收到一封包含重置链接的邮件。请检查收件箱。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
