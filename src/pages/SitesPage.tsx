import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUserReportSites, deleteReportSite } from '@/lib/api'
import { Globe, Plus, Trash2, ExternalLink, Copy, Clock, Eye, LayoutDashboard } from 'lucide-react'
import type { ReportSite } from '@/lib/types'

export function SitesPage() {
  const navigate = useNavigate()
  const [sites, setSites] = useState<ReportSite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    loadSites()
  }, [])

  const loadSites = async () => {
    setIsLoading(true)
    try {
      const res = await getUserReportSites()
      if (res.data) setSites(res.data)
    } catch (e) {
      console.error('Failed to load sites:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (slug: string) => {
    if (!confirm('确定删除这个报告网站？删除后无法恢复。')) return
    try {
      await deleteReportSite(slug)
      setSites(sites.filter(s => s.slug !== slug))
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  const handleCopyUrl = async (url: string, id: string) => {
    try {
      const fullUrl = window.location.origin + url
      await navigator.clipboard.writeText(fullUrl)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // fallback
      const input = document.createElement('input')
      input.value = window.location.origin + url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        {/* Top navigation bar */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-medium">报告网站</h2>
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutDashboard size={14} />
            回到首页
          </button>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Globe size={22} className="text-primary" />
              报告网站
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理你创建的行业分析报告网站，每个网站都是一个独立的公开页面。
            </p>
          </div>
          <button
            onClick={() => navigate('/sites/create')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />
            新建报告
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Globe size={48} className="mb-4 opacity-30" />
            <p className="text-sm mb-2">还没有创建任何报告网站</p>
            <button
              onClick={() => navigate('/sites/create')}
              className="text-sm text-primary hover:underline"
            >
              创建第一个报告
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sites.map((site) => (
              <div
                key={site.id}
                className="border border-border rounded-xl p-4 hover:border-primary/30 transition-colors bg-card"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate">{site.title}</h3>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(site.createdAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye size={12} />
                        {site.viewCount} 次访问
                      </span>
                    </div>
                    {/* URL display + copy */}
                    <div className="mt-2 flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded text-primary truncate max-w-[300px]">
                        {window.location.origin}{site.url}
                      </code>
                      <button
                        onClick={() => handleCopyUrl(site.url, site.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="复制链接"
                      >
                        {copiedId === site.id ? (
                          <span className="text-xs text-green-500">已复制</span>
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="打开报告"
                    >
                      <ExternalLink size={16} />
                    </a>
                    <button
                      onClick={() => handleDelete(site.slug)}
                      className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
