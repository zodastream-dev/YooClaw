import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, useChatStore } from '@/lib/store'
import { changePassword, getUserReportSites, deleteReportSite } from '@/lib/api'
import type { ReportSite } from '@/lib/types'
import { LayoutDashboard, User, HardDrive, Shield, KeyRound, Loader2, Check, X, LogOut, Globe, Clock, Trash2, ExternalLink, AlertTriangle, FolderOpen } from 'lucide-react'
import { formatBytes } from '@/lib/constants'

export function ProfilePage() {
  const navigate = useNavigate()
  const { user, storageInfo, clearToken, fetchStorage } = useAuthStore()
  const { clearMessages } = useChatStore()

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 我的资产
  const [portals, setPortals] = useState<ReportSite[]>([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<{ slug: string; title: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadPortals = async () => {
    setAssetsLoading(true)
    try {
      const res = await getUserReportSites('portal')
      if (res.data) setPortals(res.data)
    } catch (e) {
      console.error('Failed to load portals:', e)
    } finally {
      setAssetsLoading(false)
    }
  }

  useEffect(() => { loadPortals() }, [])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteReportSite(deleteTarget.slug)
      setPortals(portals.filter(p => p.slug !== deleteTarget.slug))
      setDeleteTarget(null)
    } catch (e: any) {
      console.error('Delete failed:', e)
    } finally {
      setIsDeleting(false)
    }
  }

  const getPortalFullUrl = (portal: ReportSite) => `https://yooclaw.yookeer.com${portal.url}`

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

        {/* 我的资产卡片 */}
        <div className="border border-border rounded-xl p-5 bg-card mb-4">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
            <FolderOpen size={16} className="text-muted-foreground" />
            我的资产
            {!assetsLoading && (
              <span className="text-xs text-muted-foreground font-normal">({portals.length} 个门户)</span>
            )}
          </h2>

          {assetsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : portals.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              <FolderOpen size={32} className="mx-auto mb-2 opacity-30" />
              <p>还没有生成任何门户</p>
              <button
                onClick={() => navigate('/sites/portal')}
                className="mt-2 inline-flex items-center gap-1 text-primary hover:underline text-xs"
              >
                去创建一个 →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {portals.map(portal => (
                <div
                  key={portal.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-background border border-border hover:border-primary/30 transition-colors group"
                >
                  {/* 状态指示 */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    portal.isPublished ? 'bg-green-500' : 'bg-yellow-500'
                  }`} title={portal.isPublished ? '已发布' : '未发布'} />

                  {/* 标题和 URL */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{portal.title || portal.slug}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                        portal.isPublished
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                      }`}>
                        {portal.isPublished ? '在线' : '草稿'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <a
                        href={getPortalFullUrl(portal)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary truncate flex items-center gap-1"
                      >
                        <Globe size={10} />
                        {getPortalFullUrl(portal)}
                        <ExternalLink size={10} />
                      </a>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                      <Clock size={10} />
                      {new Date(portal.createdAt).toLocaleString('zh-CN', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit'
                      })}
                      {portal.viewCount > 0 && (
                        <span className="ml-2">· {portal.viewCount} 次访问</span>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <button
                    onClick={() => setDeleteTarget({ slug: portal.slug, title: portal.title || portal.slug })}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="删除此门户"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delete confirmation modal */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteTarget(null)}>
            <div
              className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle size={18} className="text-destructive" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">确认删除</h3>
                  <p className="text-xs text-muted-foreground">此操作不可撤销</p>
                </div>
              </div>
              <p className="text-sm mb-4">
                确定要删除 <span className="font-medium text-destructive">"{deleteTarget.title}"</span> 吗？删除后门户网站将无法访问。
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
                >
                  {isDeleting ? <><Loader2 size={14} className="animate-spin" /> 删除中...</> : '确认删除'}
                </button>
              </div>
            </div>
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
