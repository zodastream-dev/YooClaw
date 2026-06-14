import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, CreditCard, Globe, Video, Settings, LogOut } from 'lucide-react'

export default function Layout() {
  const nav = useNavigate()
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
      <aside style={{ width: 220, background: 'var(--card)', borderRight: '1px solid var(--border)', padding: '16px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 16px 20px', fontWeight: 600, fontSize: 16 }}>YooClaw Admin</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', fontSize: 13, color: isActive ? 'var(--primary)' : 'var(--text)', background: isActive ? '#eef2ff' : 'transparent', fontWeight: isActive ? 500 : 400, textDecoration: 'none', borderRadius: 0 })}
            >
              <item.icon size={16} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}>
          <button onClick={() => { localStorage.removeItem('admin_token'); nav('/login') }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--red)', borderRadius: 6, background: 'transparent', color: 'var(--red)', fontSize: 13 }}>
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
