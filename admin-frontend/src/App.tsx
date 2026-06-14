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
  const [token, setTokenInput] = useState('')
  const [err, setErr] = useState('')

  const login = async () => {
    setErr('')
    try {
      const r = await fetch('https://yooclaw.yookeer.com/api/v1/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!r.ok) throw new Error('Invalid token')
      localStorage.setItem('admin_token', token)
      setToken(token)
      location.reload()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="card" style={{ width: 360, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 16 }}>YooClaw Admin</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>请输入管理员 Token 登录</p>
        <input
          type="password" value={token} onChange={e => setTokenInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && login()}
          placeholder="Bearer token" autoFocus
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 12 }}
        />
        <button onClick={login} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>登录</button>
        {err && <p style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>{err}</p>}
      </div>
    </div>
  )
}

export default function App() {
  // Check token on mount
  const saved = localStorage.getItem('admin_token')
  if (saved) setToken(saved)
  const [authed] = useState(!!saved)

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
