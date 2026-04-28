import { useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { login as apiLogin, register as apiRegister } from '@/lib/api'
import { Sparkles, Eye, EyeOff, Loader2, UserPlus, LogIn } from 'lucide-react'
import { useThemeStore } from '@/lib/store'
import { Sun, Moon } from 'lucide-react'

type AuthMode = 'login' | 'register'

export function HomePage() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const { setToken, isAuthenticated } = useAuthStore()
  const { resolvedTheme, setTheme } = useThemeStore()

  if (isAuthenticated) return null

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (mode === 'register') {
      if (!username.trim() || !password.trim()) {
        setError('请填写所有字段')
        return
      }
      if (username.trim().length < 3) {
        setError('用户名至少3个字符')
        return
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
        setError('用户名只能包含字母、数字和下划线')
        return
      }
      if (password.length < 6) {
        setError('密码至少6个字符')
        return
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致')
        return
      }
    }

    if (mode === 'login' && (!username.trim() || !password.trim())) {
      setError('请输入用户名和密码')
      return
    }

    setIsLoading(true)
    try {
      if (mode === 'register') {
        const data = await apiRegister(username.trim(), password)
        setToken(data.token, data.user)
      } else {
        const data = await apiLogin(username.trim(), password)
        setToken(data.token, data.user)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (mode === 'login' ? '登录失败' : '注册失败')
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Theme toggle */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          {resolvedTheme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Logo & Title */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
              <Sparkles size={32} className="text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">AI Website Builder</h1>
            <p className="text-sm text-muted-foreground">用 AI 轻松创建你的网站</p>
          </div>

          {/* Tab Switcher */}
          <div className="flex rounded-xl border border-border p-1">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'login'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LogIn size={14} />
              登录
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === 'register'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <UserPlus size={14} />
              注册
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-foreground">
                用户名
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError('') }}
                placeholder="请输入用户名"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  placeholder={mode === 'register' ? '至少6位密码' : '请输入密码'}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                  确认密码
                </label>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                  placeholder="再次输入密码"
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading || !username.trim() || !password.trim()}
              className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {mode === 'login' ? '登录中...' : '注册中...'}
                </>
              ) : (
                mode === 'login' ? '登录' : '注册'
              )}
            </button>
          </form>

          {/* Switch mode link */}
          <div className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                还没有账户？{' '}
                <button onClick={switchMode} className="text-primary hover:underline">
                  立即注册
                </button>
              </>
            ) : (
              <>
                已有账户？{' '}
                <button onClick={switchMode} className="text-primary hover:underline">
                  去登录
                </button>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground">
            Powered by CodeBuddy
          </div>
        </div>
      </div>
    </div>
  )
}
