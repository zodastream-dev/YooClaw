import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/store'
import { changePassword } from '@/lib/api'
import { LayoutDashboard, User, HardDrive, Shield, KeyRound, Loader2, Check, X, LogOut } from 'lucide-react'
import { formatBytes } from '@/lib/constants'

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, storageInfo, clearToken, clearMessages, fetchStorage } = useAuthStore()

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleChangePassword = async () => {
    setPwMessage(null)

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwMessage({ type: 'error', text: '请填写所有字段' })
      return
    }
    if (newPassword.length < 6) {
      setPwMessage({ type: 'error', text: '新密码至少需要 6 个字符' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({ type: 'error', text: '两次输入的新密码不一致' })
      return
    }

    setIsChanging(true)
    try {
      await changePassword(oldPassword, newPassword)
      setPwMessage({ type: 'success', text: '密码修改成功！' })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      setPwMessage({ type: 'error', text: e.message || '密码修改失败' })
    } finally {
      setIsChanging(false)
    }
  }

  const handleLogout = () => {
    clearToken()
    clearMessages()
    navigate('/')
  }

  const storagePercentage = storageInfo?.percentage ?? 0
  const storageColor = storagePercentage > 90 ? 'bg-red-500' : storagePercentage > 70 ? 'bg-yellow-500' : 'bg-primary'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6">
        {/* Top navigation */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-medium">个人中心</h2>
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutDashboard size={14} />
            回到首页
          </button>
        </div>

        {/* User info card */}
        <div className="border border-border rounded-xl p-5 bg-card mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-lg font-semibold">
              {user?.username?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1">
              <h1 className="text-base font-semibold flex items-center gap-2">
                {user?.username}
                {user?.role === 'admin' && (
                  <Shield size={14} className="text-yellow-500" />
                )}
              </h1>
              <p className="text-xs text-muted-foreground">
                {user?.role === 'admin' ? '管理员' : '普通用户'}
                {user?.status === 'disabled' && ' · 已禁用'}
              </p>
            </div>
          </div>
        </div>

        {/* Storage card */}
        {storageInfo && (
          <div className="border border-border rounded-xl p-5 bg-card mb-4">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <HardDrive size={16} className="text-muted-foreground" />
              存储空间
            </h2>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>已用 {formatBytes(storageInfo.used)}</span>
              <span>共 {formatBytes(storageInfo.limit)}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${storageColor}`}
                style={{ width: `${Math.min(storagePercentage, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {storagePercentage >= 90
                ? '⚠️ 存储空间即将用满，请删除旧对话释放空间'
                : `已使用 ${storagePercentage}%`}
            </p>
          </div>
        )}

        {/* Change password card */}
        <div className="border border-border rounded-xl p-5 bg-card mb-4">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
            <KeyRound size={16} className="text-muted-foreground" />
            修改密码
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">当前密码</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="输入当前密码"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">新密码</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 个字符"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>

            {pwMessage && (
              <div className={`flex items-center gap-2 text-xs p-3 rounded-lg ${
                pwMessage.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              }`}>
                {pwMessage.type === 'success' ? <Check size={14} /> : <X size={14} />}
                {pwMessage.text}
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={isChanging}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChanging ? (
                <><Loader2 size={14} className="animate-spin" /> 修改中...</>
              ) : (
                '修改密码'
              )}
            </button>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-destructive/30 text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10 transition-colors"
        >
          <LogOut size={16} />
          退出登录
        </button>
      </div>
    </div>
  )
}
