import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import Payments from './pages/Payments'
import Portals from './pages/Portals'
import Videos from './pages/Videos'
import Settings from './pages/Settings'
import { setToken } from './lib/api'

function LoginScreen() {
  const [username, setUser] = useState('')
  const [password, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const login = async () => {
    setErr(''); setLoading(true)
    try {
      const r = await fetch('https://yooclaw.yookeer.com/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error?.message || 'Login failed')
      localStorage.setItem('admin_token', data.data.token)
      localStorage.setItem('admin_user', data.data.username)
      setToken(data.data.token)
      location.reload()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 360, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 16 }}>YooClaw Admin</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>请输入管理员账号登录</p>
        <input type="text" value={username} onChange={e => setUser(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="用户名" autoFocus
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 10 }}
        />
        <input type="password" value={password} onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="密码"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 12 }}
        />
        <button onClick={login} disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? '登录中...' : '登录'}
        </button>
        {err && <p style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>{err}</p>}
      </div>
    </div>
  )
}

export default function App() {
  const saved = localStorage.getItem('admin_token')
  if (saved) setToken(saved)
  const [authed] = useState(!!saved)

  // Restore theme on load
  useEffect(() => {
    const t = localStorage.getItem('admin_theme')
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  }, [])

  if (!authed) return <LoginScreen />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<Users />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/portals" element={<Portals />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
