import { useState } from 'react'
import { resetPassword } from '@/lib/api'
import { Loader2 } from 'lucide-react'

export function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('两次密码不一致'); return }
    if (password.length < 8) { setError('密码至少需要 8 个字符'); return }
    if (!/[a-zA-Z]/.test(password)) { setError('密码必须包含至少一个字母'); return }
    if (!/[0-9]/.test(password)) { setError('密码必须包含至少一个数字'); return }

    setLoading(true)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (err: any) {
      setError(err.message || '重置失败')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm max-w-sm w-full text-center">
          <h2 className="text-lg font-semibold mb-2">无效链接</h2>
          <p className="text-sm text-muted-foreground">重置链接不完整，请检查邮件中的完整链接。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-center mb-1">重置密码</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">
            {done ? '密码已重置' : '设置您的新密码'}
          </p>
          {!done ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="新密码（8位以上，含字母和数字）" autoFocus
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/20" />
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="确认新密码"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/20" />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {loading ? <><Loader2 size={14} className="animate-spin inline mr-1" />重置中...</> : '重置密码'}
              </button>
            </form>
          ) : (
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">密码重置成功，请使用新密码登录。</p>
              <a href="#/" className="text-primary text-sm hover:underline">返回登录</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
