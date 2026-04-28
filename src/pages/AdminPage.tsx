import { useState, useEffect } from 'react'
import { useAuthStore } from '@/lib/store'
import { getAdminUsers, updateAdminUser, deleteAdminUser, getAdminStats } from '@/lib/api'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield, Trash2, UserCheck, UserX, HardDrive, Users, Activity } from 'lucide-react'
import { formatBytes } from '@/lib/constants'
import type { AdminUser, AdminStats } from '@/lib/types'

export function AdminPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/chat')
      return
    }
    loadData()
  }, [user])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [usersRes, statsRes] = await Promise.all([getAdminUsers(), getAdminStats()])
      if (usersRes.data) setUsers(usersRes.data)
      if (statsRes.data) setStats(statsRes.data)
    } catch (e) {
      console.error('Failed to load admin data:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    try {
      await updateAdminUser(userId, { status: newStatus })
      setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus as 'active' | 'disabled' } : u))
    } catch (e) {
      console.error('Failed to update user:', e)
    }
  }

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`确定要删除用户 "${username}" 吗？此操作不可撤销。`)) return
    try {
      await deleteAdminUser(userId)
      setUsers(users.filter(u => u.id !== userId))
    } catch (e) {
      console.error('Failed to delete user:', e)
    }
  }

  if (user?.role !== 'admin') return null

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-yellow-500" />
            <h1 className="text-lg font-bold text-foreground">管理后台</h1>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Users size={14} />
                总用户数
              </div>
              <div className="text-2xl font-bold text-foreground">{stats.totalUsers}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Activity size={14} />
                活跃用户
              </div>
              <div className="text-2xl font-bold text-green-500">{stats.activeUsers}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <HardDrive size={14} />
                总存储使用
              </div>
              <div className="text-2xl font-bold text-foreground">{formatBytes(stats.totalStorage)}</div>
            </div>
          </div>
        )}

        {/* User List */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-medium text-foreground">用户列表</h2>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">加载中...</div>
          ) : (
            <div className="divide-y divide-border">
              {users.map((u) => (
                <div key={u.id} className="px-4 py-3 flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium flex-shrink-0">
                    {u.username[0].toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{u.username}</span>
                      {u.role === 'admin' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                          管理员
                        </span>
                      )}
                      {u.status === 'disabled' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive border border-destructive/20">
                          已禁用
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <HardDrive size={10} />
                        {formatBytes(u.storageUsed)} / {formatBytes(u.storageLimit)}
                      </span>
                      <span>注册于 {new Date(u.createdAt).toLocaleDateString()}</span>
                    </div>
                    {/* Storage bar */}
                    <div className="mt-1.5 w-full max-w-xs h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${u.storageUsed / u.storageLimit > 0.9 ? 'bg-destructive' : 'bg-primary'}`}
                        style={{ width: `${Math.min((u.storageUsed / u.storageLimit) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  {u.role !== 'admin' && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleStatus(u.id, u.status)}
                        className={`p-2 rounded-lg transition-colors ${
                          u.status === 'active'
                            ? 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                            : 'hover:bg-green-500/10 text-muted-foreground hover:text-green-500'
                        }`}
                        title={u.status === 'active' ? '禁用用户' : '启用用户'}
                      >
                        {u.status === 'active' ? <UserX size={16} /> : <UserCheck size={16} />}
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, u.username)}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="删除用户"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {users.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">暂无用户</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
