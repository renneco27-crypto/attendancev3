import React, { useState } from 'react'
import { supabase, resetSupabaseClient } from '../services/supabase'

interface Props {
  onLogin: () => void
  onBack: () => void
}

export default function TeacherLogin({ onLogin, onBack }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    resetSupabaseClient()
    setLoading(true)
    setError('')
    try {
      const result: any = await Promise.race([
        supabase().auth.signInWithPassword({ email, password }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after 15s. Check your internet or Supabase URL.')), 15000)),
      ])
      if (result.error) { setError(result.error.message); setLoading(false); return }
      onLogin()
    } catch (e: any) {
      setError(e?.message || 'Connection error. Try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <div className="dark-hero">
        <div className="dark-hero-bg" />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <div className="tb-logo">
            <div className="tb-logo-img"><img src="/photo_2.webp" alt="ACLC Ormoc" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
            <div className="tb-brand" style={{ color: '#fff' }}>ACLC Ormoc <span style={{ color: 'rgba(255,255,255,.5)' }}>Attendance Scanner</span></div>
          </div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>← Back</button>
        </div>
        <h2 style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 6 }}>Teacher Login</h2>
        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 14 }}>Sign in with your institutional account</p>
      </div>
      <div className="tl-card">
        <div className="tl-badge">🔐 Staff Access Only</div>
        <div className="field"><label>Email Address</label><input type="email" placeholder="you@aclc-ormoc.edu.ph" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label>Password</label><input type="password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} /></div>
        {error && <p className="pin-error">{error}</p>}
        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
      </div>
    </>
  )
}
