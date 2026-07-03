import React, { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../services/supabase'
import { createSession, endSession, rotateSessionKey, revokeDevice, kickFromSession } from '../services/api'
import MonthlyAttendance from './MonthlyAttendance'

interface Props {
  onLogout: () => void
}

interface PendingRequest {
  id: string
  student_name: string
  device_identifier: string
  created_at: string
  face_photo_url?: string | null
  parent_email?: string
  parent_name?: string
}

interface Attendee {
  id: string
  student_id?: string
  student_name: string
  scanned_at: string
  is_mock_location?: boolean
  section?: string
  face_frame_url?: string | null
}

type Tab = 'session' | 'registrations' | 'attendance' | 'roster'

export default function TeacherSession({ onLogout }: Props) {
  const [teacherId, setTeacherId] = useState('')
  const teacherIdRef = useRef('')
  const [teacherName, setTeacherName] = useState('')
  const [className, setClassName] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [phase, setPhase] = useState<'setup' | 'active' | 'ended'>('setup')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [pendingList, setPendingList] = useState<PendingRequest[]>([])
  const [tab, setTab] = useState<Tab>('session')
  interface PastClass { id: string; class_name: string }
  const [pastClasses, setPastClasses] = useState<PastClass[]>([])
  const [selectedChip, setSelectedChip] = useState('')
  const [qrFullscreen, setQrFullscreen] = useState(false)
  const [sections, setSections] = useState<string[]>([])
  const [selectedSection, setSelectedSection] = useState('')
  const [teacherCode, setTeacherCode] = useState('')
  const [isCodeSaved, setIsCodeSaved] = useState(false)
  const [showCodePopup, setShowCodePopup] = useState(false)
  const rotationTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const channelRef = useRef<any>(null)
  const [livenessSummary, setLivenessSummary] = useState<Record<string, { score: number; isLive: boolean }>>({})
  const [rosterList, setRosterList] = useState<PendingRequest[]>([])
  const [previewImageUrl, setPreviewImageUrl] = useState('')
  const [studentPopup, setStudentPopup] = useState<{ name: string; section: string; time: string; img?: string | null; prompt?: string; detectedDirection?: string } | null>(null)

  useEffect(() => { init(); return () => cleanup() }, [])

  useEffect(() => {
    if (phase !== 'ended' || !sessionId) return
    ;(async () => {
      const { data } = await supabase()
        .from('liveness_logs')
        .select('student_id, liveness_score, is_live')
        .eq('session_id', sessionId)
      if (data) {
        const map: Record<string, { score: number; isLive: boolean }> = {}
        data.forEach(r => { map[r.student_id] = { score: r.liveness_score, isLive: r.is_live } })
        setLivenessSummary(map)
      }
    })()
  }, [phase])

  function cleanup() {
    if (rotationTimer.current) clearInterval(rotationTimer.current)
    if (channelRef.current) channelRef.current.unsubscribe()
  }

  async function init() {
    try {
      const { data: { user } } = await supabase().auth.getUser()
      if (!user) return
      teacherIdRef.current = user.id
      setTeacherId(user.id)
      const name = user.email?.split('@')[0]?.replace(/[.].*/, '') ??
        user.user_metadata?.full_name ?? 'Teacher'
      setTeacherName(name)
      const { data: existing } = await supabase()
        .from('teachers').select('id, teacher_code').eq('auth_user_id', user.id).maybeSingle()
      if (!existing) {
        await supabase().from('teachers').insert({ auth_user_id: user.id, name })
      } else if (existing.teacher_code) {
        setTeacherCode(existing.teacher_code)
        setIsCodeSaved(true)
      }
      supabase().from('sections').select('name').order('name').then(({ data }) => {
        if (data) setSections(data.map(s => s.name))
      })
      fetchPastClasses(user.id)
      fetchPending()
    } catch (e) {
      alert('Failed to initialize: ' + (e instanceof Error ? e.message : e))
    }
  }

  async function fetchPastClasses(uid?: string) {
    if (!uid) {
      const { data: { user } } = await supabase().auth.getUser()
      if (!user) return
      uid = user.id
    }
    const { data } = await supabase()
      .from('attendance_sessions')
      .select('id, class_name')
      .eq('teacher_id', uid)
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) {
      const seen = new Set<string>()
      const deduped = data.filter(s => { if (seen.has(s.class_name)) return false; seen.add(s.class_name); return true })
      setPastClasses(deduped)
    }
  }

  async function fetchPending(section?: string) {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
    let query = supabase()
      .from('device_registrations')
      .select('id, student_name, device_identifier, created_at, face_photo_url')
      .eq('status', 'pending')
      .neq('device_identifier', '')
      .gte('created_at', twoDaysAgo)
    const s = section !== undefined ? section : selectedSection
    if (s) query = query.eq('section', s)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) console.error('fetchPending error:', error.message)
    if (data) setPendingList(data as PendingRequest[])
  }

  async function fetchRoster(section?: string) {
    let query = supabase()
      .from('device_registrations')
      .select('id, student_name, device_identifier, created_at, parent_email, parent_name')
      .eq('status', 'approved')
      .neq('device_identifier', '')
    const s = section !== undefined ? section : selectedSection
    if (s) query = query.eq('section', s)
    const { data } = await query.order('student_name', { ascending: true })
    if (data) setRosterList(data as PendingRequest[])
  }

  const [codeError, setCodeError] = useState('')
  const [editRosterId, setEditRosterId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPName, setEditPName] = useState('')

  async function saveParentInfo() {
    if (!editRosterId) return
    await supabase()
      .from('device_registrations')
      .update({ parent_email: editEmail, parent_name: editPName })
      .eq('id', editRosterId)
    setEditRosterId(null)
    fetchRoster()
  }

  async function handleRevoke(requestId: string) {
    const ok = await revokeDevice(requestId)
    if (ok) fetchRoster()
  }

  async function handleApprove(requestId: string) {
    const { error } = await supabase()
      .from('device_registrations')
      .update({ status: 'approved' })
      .eq('id', requestId)
    if (!error) fetchPending()
  }

  async function handleReject(requestId: string) {
    const ok = await revokeDevice(requestId)
    if (ok) fetchPending()
  }

  async function saveTeacherCode() {
    const code = teacherCode.trim().toUpperCase()
    if (code.length < 4) { setCodeError('Code must be at least 4 characters'); return }
    setCodeError('')
    const { error } = await supabase()
      .from('teachers').update({ teacher_code: code })
      .eq('auth_user_id', teacherIdRef.current || teacherId)
    if (!error) { setTeacherCode(code); setIsCodeSaved(true) }
  }

  async function handleKick(attendanceRecordId: string) {
    const ok = await kickFromSession(attendanceRecordId)
    if (ok) setAttendees(prev => prev.filter(a => a.id !== attendanceRecordId))
  }

  function selectChip(name: string) {
    setSelectedChip(name)
    setClassName(name)
  }

  async function deleteSession(sessionId: string) {
    const { error: err1 } = await supabase().from('attendance_records').delete().eq('session_id', sessionId)
    if (err1) console.error('Delete records error:', err1.message)
    const { error: err2 } = await supabase().from('attendance_sessions').delete().eq('id', sessionId)
    if (err2) console.error('Delete session error:', err2.message)
    if (!err2) fetchPastClasses()
  }

  async function startSession() {
    if (!className.trim()) return
    let uid = teacherIdRef.current || teacherId
    if (!uid) {
      const { data: { user } } = await supabase().auth.getUser()
      if (!user) { alert('Not authenticated. Please log out and log back in.'); return }
      uid = user.id
      teacherIdRef.current = uid
      setTeacherId(uid)
    }
    let id, rotation_key
    try {
      const result = await createSession(className.trim(), uid)
      id = result.id
      rotation_key = result.rotation_key
    } catch (e: any) {
      alert('Failed to start session: ' + (e.message || e))
      return
    }
    sessionIdRef.current = id
    setSessionId(id)
    setPhase('active')
    renderQr(JSON.stringify({ session_id: id, rotation_key }))

    const channel = supabase().channel(`attendance_records:${id}`)
    channel.on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'attendance_records',
      filter: `session_id=eq.${id}`,
    }, (payload: any) => {
      const r = payload.new
      setAttendees(prev => [...prev, {
        id: r.id,
        student_id: r.student_id ?? '',
        student_name: r.student_name ?? 'Unknown',
        scanned_at: r.scanned_at,
        is_mock_location: r.is_mock_location ?? false,
        section: r.section || '',
        face_frame_url: r.face_frame_url || null
      }])
    })
    channel.on('postgres_changes', {
      event: 'DELETE', schema: 'public', table: 'attendance_records',
      filter: `session_id=eq.${id}`,
    }, (payload: any) => {
      const deletedId = payload.old.id
      setAttendees(prev => prev.filter(a => a.id !== deletedId))
    })
    channel.subscribe()
    channelRef.current = channel
    rotationTimer.current = setInterval(rotateKey, 1000)
  }

  const rotateKey = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return
    const result = await rotateSessionKey(sid)
    if ('ended' in result && result.ended) {
      if (rotationTimer.current) clearInterval(rotationTimer.current)
      rotationTimer.current = null
      setPhase('ended')
      return
    }
    if ('rotation_key' in result) {
      renderQr(JSON.stringify({ session_id: sid, rotation_key: result.rotation_key }))
    }
  }, [])

  function renderQr(text: string) {
    QRCode.toDataURL(text, { width: 260, margin: 1 }, (err, url) => {
      if (!err) setQrDataUrl(url)
    })
  }

  async function handleEndSession() {
    const sid = sessionIdRef.current
    if (!sid) return
    if (rotationTimer.current) { clearInterval(rotationTimer.current); rotationTimer.current = null }
    if (channelRef.current) { channelRef.current.unsubscribe(); channelRef.current = null }
    setQrDataUrl('')
    try { await fetch('/api/cleanupSessionPhotos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) }) } catch {}
    await endSession(sid)
    sessionIdRef.current = null
    setPhase('ended')
    fetchPastClasses()
  }

  async function handleNewSession() {
    const sid = sessionIdRef.current
    if (rotationTimer.current) { clearInterval(rotationTimer.current); rotationTimer.current = null }
    if (channelRef.current) { channelRef.current.unsubscribe(); channelRef.current = null }
    if (sid) { try { await fetch('/api/cleanupSessionPhotos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid }) }) } catch {} }
    sessionIdRef.current = null
    setSessionId(null)
    setQrDataUrl('')
    setAttendees([])
    setSelectedChip('')
    setClassName('')
    setPhase('setup')
  }

  function handleLogout() {
    cleanup()
    onLogout()
  }

  const displayed = selectedSection ? attendees.filter(a => a.section === selectedSection) : attendees

  async function showStudentPopup(name: string, section: string, time: string, img: string | null | undefined, studentId: string) {
    let prompt = ''
    let detectedDirection = ''
    if (sessionId) {
      const { data } = await supabase()
        .from('liveness_logs')
        .select('prompt, detected_direction')
        .eq('session_id', sessionId)
        .eq('student_id', studentId)
        .maybeSingle()
      if (data) {
        prompt = data.prompt || ''
        detectedDirection = data.detected_direction || ''
      }
    }
    setStudentPopup({ name, section, time, img, prompt, detectedDirection })
  }

  return (
    <>
      <div className="teacher-topbar">
        <div className="teacher-topbar-row">
          <div className="tb-logo">
            <div className="tb-logo-img"><img src="/photo_2.webp" alt="ACLC Ormoc" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
            <div className="tb-brand">ACLC Ormoc <span>Teacher Panel</span></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isCodeSaved ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => setShowCodePopup(true)} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--green-lt)', color: '#fff', border: 'none', fontFamily: 'Inter,sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Saved</button>
                <button onClick={() => { setIsCodeSaved(false); setCodeError('') }} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--gold-lt)', color: '#fff', border: 'none', fontFamily: 'Inter,sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Change</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="text" placeholder="Code" value={teacherCode} onChange={e => { setTeacherCode(e.target.value.toUpperCase()); if (codeError) setCodeError('') }} style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'Inter,sans-serif' }} />
                  <button onClick={saveTeacherCode} disabled={teacherCode.trim().length < 4} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--green2)', color: '#fff', border: 'none', fontFamily: 'Inter,sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: teacherCode.trim().length < 4 ? 0.5 : 1 }}>Save</button>
                </div>
                {codeError && <div style={{ color: 'var(--red)', fontSize: 11, fontWeight: 600 }}>{codeError}</div>}
              </div>
            )}
            <button onClick={handleLogout} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #f5c0c0', fontFamily: 'Inter,sans-serif', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Logout</button>
          </div>
        </div>
        <div className="teacher-tabs">
          <button className={`tab-btn ${tab === 'session' ? 'active' : ''}`} onClick={() => setTab('session')}>Session</button>
          <button className={`tab-btn ${tab === 'registrations' ? 'active' : ''}`} onClick={() => { setTab('registrations'); fetchPending() }}>Registrations</button>
          <button className={`tab-btn ${tab === 'roster' ? 'active' : ''}`} onClick={() => { setTab('roster'); fetchRoster() }}>Roster</button>
          <button className={`tab-btn ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>Attendance</button>
        </div>
        <div className="section-row">
          <span className="section-label">Section:</span>
          <select className="section-select" value={selectedSection}
            onChange={e => { const s = e.target.value; setSelectedSection(s); fetchPending(s); fetchRoster(s) }}>
            <option value="">All Sections</option>
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 40 }}>

        {/* ── SESSION TAB ── */}
        <div className={`tab-panel ${tab === 'session' ? 'active' : ''}`} id="tab-session">

          {/* SETUP */}
          <div className={`session-phase ${phase !== 'setup' ? 'hidden' : ''}`} id="phase-setup">
            <div className="greet-card">
              <div className="greet-bg" />
              <div className="greet-content">
                <div className="gc-sub">Welcome back,</div>
                <div className="gc-name">{teacherName}</div>
                <div className="gc-meta" id="teacher-geo-meta">📍 ACLC Ormoc Campus</div>
              </div>
            </div>
            {pastClasses.length > 0 && <div className="chips-label">Recent Classes</div>}
            {pastClasses.length > 0 && (
              <div className="class-chips">
                {pastClasses.map(s => (
                  <div key={s.id} className={`chip ${selectedChip === s.class_name ? 'selected' : ''}`}>
                    <span className="chip-text" onClick={() => selectChip(s.class_name)}>{s.class_name}</span>
                    <span className="chip-x" onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}>×</span>
                  </div>
                ))}
              </div>
            )}
            <div className="field"><label>Class Name</label><input type="text" placeholder="e.g. Data Structures — Block A" value={className} onChange={e => { setClassName(e.target.value); setSelectedChip('') }} /></div>
            <button className="btn-primary" onClick={startSession} disabled={!className.trim()}>▶ Start Session</button>
          </div>

          {/* ACTIVE */}
          <div className={`session-phase ${phase !== 'active' ? 'hidden' : ''}`} id="phase-active">
            <div className="greet-card" style={{ marginBottom: 18 }}>
              <div className="greet-bg" />
              <div className="greet-content">
                <div className="gc-sub">Currently Running</div>
                <div className="gc-name">{className}</div>
                <div className="gc-meta">📍 ACLC Ormoc</div>
              </div>
              <div className="live-badge"><div className="live-dot" />LIVE</div>
            </div>

            <div className="qr-display-card">
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Show this QR to students</div>
              <div className="qr-content">
                {qrDataUrl ? <img src={qrDataUrl} alt="QR" onClick={() => setQrFullscreen(true)} style={{ cursor: 'pointer' }} /> : <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>Loading…</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="qr-hint">Refreshes every 1s</div>
              </div>
            </div>

            {qrFullscreen && (
              <div className="qr-fullscreen-overlay" onClick={() => setQrFullscreen(false)}>
                <img src={qrDataUrl} alt="QR" className="qr-fullscreen-img" />
                <span className="qr-fullscreen-close">✕</span>
              </div>
            )}

            <div className="att-table-card">
              <div className="att-table-head">
                <h3>Checked In</h3>
                <span className="count-badge">{displayed.length}</span>
              </div>
              {displayed.length === 0 ? (
                <div className="att-empty">Waiting for students to scan…</div>
              ) : (
                displayed.slice(-20).map((a, i) => (
                  <div key={a.id} className="att-row">
                    {a.face_frame_url ? (
                      <div className="face-thumb-sm" style={{ cursor: 'pointer' }} onClick={() => setPreviewImageUrl(a.face_frame_url || '')}><img src={a.face_frame_url} alt="" /></div>
                    ) : (
                      <div className="att-dot" />
                    )}
                    <div className="att-num">{i + 1}</div>
                    <div className="att-name" style={{ cursor: 'pointer' }} onClick={() => showStudentPopup(a.student_name, a.section || '', new Date(a.scanned_at).toLocaleTimeString(), a.face_frame_url, a.student_id)}>
                      {a.student_name}
                      {a.section && <span className="section-badge">{a.section}</span>}
                    </div>
                    {a.is_mock_location && <span className="att-mock-icon" title="Fake GPS detected">⚠️</span>}
                    <div className="att-time">{new Date(a.scanned_at).toLocaleTimeString()}</div>
                    <button className="kick-btn" onClick={() => handleKick(a.id)}>Kick</button>
                  </div>
                ))
              )}
            </div>
            <button className="btn-danger" onClick={handleEndSession}>■ End Session</button>
          </div>

          {/* ENDED */}
          <div className={`session-phase ${phase !== 'ended' ? 'hidden' : ''}`} id="phase-ended">
            <div className="summary-hero">
              <div className="summary-icon">📊</div>
              <div className="summary-title">Session Ended</div>
              <div className="summary-class-name">{className}</div>
            </div>

            <div className="summary-stats">
              <div className="summary-stat">
                <div className="stat-value">{displayed.length}</div>
                <div className="stat-label">Checked In</div>
              </div>
              <div className="summary-stat">
                <div className="stat-value">{Object.values(livenessSummary).filter(s => s.isLive).length}</div>
                <div className="stat-label">Liveness Pass</div>
              </div>
              <div className="summary-stat">
                <div className="stat-value">{displayed.length - Object.values(livenessSummary).filter(s => s.isLive).length}</div>
                <div className="stat-label">No Liveness</div>
              </div>
            </div>

            {displayed.length > 0 && (
              <div className="att-table-card" style={{ marginBottom: 16 }}>
                <div className="att-table-head"><h3>Attendance Record</h3><span className="count-badge">{displayed.length}</span></div>
                {displayed.map((a, i) => {
                  const l = livenessSummary[a.student_id || '']
                  return (
                    <div key={a.id} className="att-row">
                      {a.face_frame_url ? (
                        <div className="face-thumb-sm" style={{ cursor: 'pointer' }} onClick={() => setPreviewImageUrl(a.face_frame_url || '')}><img src={a.face_frame_url} alt="" /></div>
                      ) : null}
                      <div className="att-num">{i + 1}</div>
                      <div className="att-name" style={{ cursor: 'pointer' }} onClick={() => showStudentPopup(a.student_name, a.section || '', new Date(a.scanned_at).toLocaleTimeString(), a.face_frame_url, a.student_id)}>
                        {a.student_name}
                        {a.section && <span className="section-badge">{a.section}</span>}
                      </div>
                      {l ? (
                        <span className={`liveness-pill ${l.isLive ? 'lp-pass' : 'lp-fail'}`}>
                          {l.score}{l.isLive ? '✅' : '⚠️'}
                        </span>
                      ) : (
                        <span className="liveness-pill lp-none">—</span>
                      )}
                      <div className="att-time">{new Date(a.scanned_at).toLocaleTimeString()}</div>
                    </div>
                  )
                })}
              </div>
            )}
            <button className="btn-primary" onClick={handleNewSession}>+ New Session</button>
          </div>
        </div>

        {/* ── REGISTRATIONS TAB ── */}
        <div className={`tab-panel ${tab === 'registrations' ? 'active' : ''}`} id="tab-registrations">
          <div style={{ padding: '20px 16px 40px' }}>
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Pending Registrations</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Approve or reject student device requests.</div>
            {pendingList.length === 0 ? (
              <div className="att-empty">No pending requests.</div>
            ) : (
              <div className="reg-list-card">
                {pendingList.map(r => (
                  <div key={r.id} className="reg-row">
                    {r.face_photo_url ? <div className="reg-face-thumb"><img src={r.face_photo_url} alt="" /></div> : null}
                    <div style={{ flex: 1 }}>
                      <div className="reg-student-name">{r.student_name}</div>
                      <div className="reg-device-id">Device: {r.device_identifier.slice(0, 12)}…</div>
                    </div>
                    <div className="reg-actions">
                      <button className="approve-btn" onClick={() => handleApprove(r.id)}>✓ Approve</button>
                      <button className="reject-btn" onClick={() => handleReject(r.id)}>✖ Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── ROSTER TAB ── */}
        <div className={`tab-panel ${tab === 'roster' ? 'active' : ''}`} id="tab-roster">
          <div style={{ padding: '20px 16px 40px' }}>
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>Student Roster</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Approved registered students.</div>
            {rosterList.length === 0 ? (
              <div className="att-empty">No approved students yet.</div>
            ) : (
              <div className="reg-list-card">
                {rosterList.map(r => (
                  <div key={r.id} className="reg-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div className="reg-student-name">{r.student_name}</div>
                      <div className="reg-device-id">Device: {r.device_identifier.slice(0, 12)}…</div>
                      <div style={{ fontSize: 11, color: r.parent_email ? 'var(--green2)' : 'var(--muted)', marginTop: 2 }}>
                        {r.parent_email ? `📧 ${r.parent_email}${r.parent_name ? ' (' + r.parent_name + ')' : ''}` : 'No parent email'}
                      </div>
                    </div>
                    <button onClick={() => { setEditRosterId(r.id); setEditEmail(r.parent_email || ''); setEditPName(r.parent_name || '') }} style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--off)', color: 'var(--text)', border: '1px solid var(--border)', fontFamily: 'Inter,sans-serif', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => handleRevoke(r.id)} style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--red-lt)', color: 'var(--red)', border: '1px solid #f5c0c0', fontFamily: 'Inter,sans-serif', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── ATTENDANCE TAB ── */}
        <div className={`tab-panel ${tab === 'attendance' ? 'active' : ''}`} id="tab-attendance">
          <MonthlyAttendance selectedSection={selectedSection} />
        </div>
      </div>

      {/* ── TEACHER CODE POPUP ── */}
      {showCodePopup && (
        <div className="img-preview-overlay" onClick={() => setShowCodePopup(false)}>
          <div style={{ textAlign: 'center', padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 14, color: 'rgba(255,255,255,.5)', marginBottom: 12 }}>Share this code with your students:</div>
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 64, fontWeight: 900, color: '#fff', letterSpacing: 8, marginBottom: 8 }}>{teacherCode}</div>
            <span className="img-preview-close" onClick={() => setShowCodePopup(false)} style={{ position: 'static', display: 'inline-block', marginTop: 24, fontSize: 16, opacity: 0.5 }}>Tap to close</span>
          </div>
        </div>
      )}

      {/* ── STUDENT POPUP OVERLAY ── */}
      {studentPopup && (
        <div className="img-preview-overlay" onClick={() => setStudentPopup(null)}>
          <div style={{ textAlign: 'center', padding: 20 }} onClick={e => e.stopPropagation()}>
            {studentPopup.img && <img src={studentPopup.img} alt="" style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--green2)', marginBottom: 16 }} />}
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{studentPopup.name}</div>
            {studentPopup.section && <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--green-lt)', marginBottom: 6 }}>{studentPopup.section}</div>}
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,.6)', marginBottom: 12 }}>{studentPopup.time}</div>
            {studentPopup.prompt && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, fontSize: 15, fontWeight: 600 }}>
                <span style={{ color: 'rgba(255,255,255,.5)' }}>Asked: {studentPopup.prompt === 'left' ? 'Turn LEFT' : studentPopup.prompt === 'right' ? 'Turn RIGHT' : 'Nod'}</span>
                <span style={{ color: 'rgba(255,255,255,.3)' }}>→</span>
                <span style={{ color: studentPopup.detectedDirection && studentPopup.detectedDirection !== 'none' ? 'var(--green2)' : 'var(--red)' }}>
                  {studentPopup.detectedDirection && studentPopup.detectedDirection !== 'none'
                    ? `Did: Turn ${studentPopup.detectedDirection.toUpperCase()} ✅`
                    : 'Did: Nothing ❌'}
                </span>
              </div>
            )}
            <span className="img-preview-close" onClick={() => setStudentPopup(null)} style={{ position: 'static', display: 'inline-block', marginTop: 24, fontSize: 16, opacity: 0.5 }}>Tap to close</span>
          </div>
        </div>
      )}

      {/* ── EDIT PARENT INFO POPUP ── */}
      {editRosterId && (
        <div className="img-preview-overlay" onClick={() => setEditRosterId(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 16, padding: 24, maxWidth: 360, width: '90%', margin: '0 auto', position: 'relative', top: '20%' }}>
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 16 }}>Edit Parent Contact</div>
            <div className="field">
              <label>Parent Email</label>
              <input type="email" placeholder="parent@example.com" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>Parent Name</label>
              <input type="text" placeholder="e.g. Maria Dela Cruz" value={editPName} onChange={e => setEditPName(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-primary" onClick={saveParentInfo} style={{ flex: 1 }}>Save</button>
              <button className="btn-primary" onClick={() => setEditRosterId(null)} style={{ flex: 1, background: 'var(--off)', color: 'var(--text)', border: '1px solid var(--border)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── IMAGE PREVIEW OVERLAY ── */}
      {previewImageUrl && (
        <div className="img-preview-overlay" onClick={() => setPreviewImageUrl('')}>
          <img src={previewImageUrl} alt="Preview" className="img-preview-full" />
          <span className="img-preview-close">✕</span>
        </div>
      )}
    </>
  )
}
