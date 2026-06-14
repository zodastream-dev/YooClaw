import { useState, useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, CreditCard, Globe, Video, Settings, LogOut, Moon, Sun } from 'lucide-react'

export default function Layout() {
  const [dark, setDark] = useState(() => localStorage.getItem('admin_theme') === 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : '')
    localStorage.setItem('admin_theme', dark ? 'dark' : 'light')
  }, [dark])

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: '仪表盘' },
    { to: '/users', icon: Users, label: '用户管理' },
    { to: '/payments', icon: CreditCard, label: '支付订单' },
    { to: '/portals', icon: Globe, label: '门户管理' },
    { to: '/videos', icon: Video, label: '视频管理' },
    { to: '/settings', icon: Settings, label: '系统设置' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 220, background: 'var(--card)', borderRight: '1px solid var(--border)', padding: '16px 0', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0 16px 20px', fontWeight: 600, fontSize: 16 }}>YooClaw Admin</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', fontSize: 13, color: isActive ? 'var(--primary)' : 'var(--text)', background: isActive ? 'var(--bg)' : 'transparent', fontWeight: isActive ? 500 : 400, textDecoration: 'none' })}
            >
              <item.icon size={16} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => setDark(!dark)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text)', fontSize: 13 }}>
            {dark ? <Sun size={14} /> : <Moon size={14} />} {dark ? '日间' : '夜间'}
          </button>
          <button onClick={() => { localStorage.removeItem('admin_token'); location.reload() }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--red)', borderRadius: 6, background: 'transparent', color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>
            <LogOut size={14} /> 退出
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
