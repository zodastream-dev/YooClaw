export const API_BASE = import.meta.env.VITE_API_BASE || ''

export const TOKEN_KEY = 'codebuddy_token'
export const THEME_KEY = 'codebuddy_theme'

export const SUGGESTED_PROMPTS = [
  '帮我创建一个个人博客网站',
  '做一个产品展示页面',
  '创建一个在线简历',
  '设计一个公司官网',
  '做一个美食分享网站',
  '创建一个照片画廊页面',
]

export const DEFAULT_SESSION_NAME = '新对话'

export const MODES = [
  {
    id: 'craft' as const,
    label: 'Craft 模式',
    desc: '立即执行',
    icon: 'Zap',
  },
  {
    id: 'plan' as const,
    label: 'Plan 模式',
    desc: '先计划再执行',
    icon: 'ListChecks',
  },
  {
    id: 'ask' as const,
    label: 'Ask 模式',
    desc: '只问答不动手',
    icon: 'MessageCircle',
  },
]

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
