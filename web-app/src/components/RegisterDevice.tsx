import React, { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { getDeviceId } from '../utils/device'

interface Props {
  onBack: () => void
  onRegistered: (pin: string) => void
}

type Phase = 'form' | 'submitting' | 'success' | 'failed'

export default function RegisterDevice({ onBack, onRegistered }: Props) {
  const [teacherCode, setTeacherCode] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [section, setSection] = useState('')
  const [sections, setSections] = useState<string[]>([])
  const [parentEmail, setParentEmail] = useState('')
  const [parentName, setParentName] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [message, setMessage] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    supabase().from('sections').select('name').order('name').then(({ data }) => {
      if (data) setSections(data.map(s => s.name))
    })
  }, [])

  async function handleSubmit() {
    if (!name.trim() || pin.length !== 4 || pin !== pinConfirm) return
    if (!teacherCode.trim()) { setErrorMsg('Please enter your teacher\'s code.'); setPhase('failed'); return }
    if (!section) { setErrorMsg('Please select your section.'); setPhase('failed'); return }
    if (parentEmail && !parentEmail.includes('@')) { setErrorMsg('Please enter a valid parent email.'); setPhase('failed'); return }
    setPhase('submitting')
    const deviceId = getDeviceId()

    try {
      const { data: teacher } = await supabase()
        .from('teachers')
        .select('auth_user_id')
        .eq('teacher_code', teacherCode.trim().toUpperCase())
        .maybeSingle()
      if (!teacher) {
        setErrorMsg('Teacher not found. Check the code with your teacher.')
        setPhase('failed'); return
      }
      const teacherId = teacher.auth_user_id

      const { data: existing } = await supabase()
        .from('device_registrations')
        .select('id, status')
        .ilike('student_name', name.trim())
        .limit(1)

      if (existing && existing.length > 0) {
        const row = existing[0]
        if (row.status === 'approved') {
          setErrorMsg('This name already has an approved device.')
          setPhase('failed'); return
        }
        if (row.status === 'pending') {
            const { error: upErr } = await supabase()
              .from('device_registrations')
              .update({ device_identifier: deviceId, pin, section, parent_email: parentEmail, parent_name: parentName })
              .eq('id', row.id)
          if (upErr) {
            if (upErr.message?.includes('idx_device_registrations_uniq')) {
              setErrorMsg('You have already used this device to sign in to an account. Please tell an admin to delete your account.')
            } else {
              setErrorMsg('Error updating: ' + upErr.message)
            }
            setPhase('failed'); return
          }
          setMessage('Device registered! You can now scan attendance.')
          setPhase('success'); onRegistered(pin); return
        }
        setErrorMsg('This registration was revoked. Ask your teacher to add you again.')
        setPhase('failed'); return
      }

      const { error: insErr } = await supabase()
        .from('device_registrations')
        .insert({
          student_name: name.trim(),
          device_identifier: deviceId,
          pin,
          section,
          teacher_id: teacherId,
          status: 'pending',
          parent_email: parentEmail,
          parent_name: parentName,
        })
      if (insErr) {
        if (insErr.message?.includes('idx_device_registrations_uniq')) {
          setErrorMsg('You have already used this device to sign in to an account. Please tell an admin to delete your account.')
        } else {
          setErrorMsg('Error: ' + insErr.message)
        }
        setPhase('failed'); return
      }

      setMessage('Device registered! You can now scan attendance.')
      setPhase('success')
      onRegistered(pin)
    } catch (err: any) {
      setErrorMsg('Error: ' + (err?.message || 'Unknown error'))
      setPhase('failed')
    }
  }

  function pinError() {
    if (pinConfirm.length === 0) return ''
    if (pin.length !== pinConfirm.length) return ''
    if (pin !== pinConfirm) return 'PINs do not match'
    return ''
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
        <h2 style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', marginBottom: 6 }}>Register Your Device</h2>
        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 14, lineHeight: 1.6 }}>Submit your name and create a 4-digit PIN to get approved by your teacher.</p>
      </div>
      <div className="reg-card">
        {phase === 'form' && (
          <div>
            <div className="field">
              <label>Teacher Code</label>
              <input type="text" placeholder="e.g. SMITH" value={teacherCode} onChange={e => setTeacherCode(e.target.value.toUpperCase())} />
            </div>
            <div className="field"><label>Full Name</label><input type="text" placeholder="e.g. Juan Dela Cruz" value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="field">
              <label>Create a 4-digit PIN</label>
              <input type="password" placeholder="Enter PIN" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </div>
            <div className="field">
              <label>Confirm PIN</label>
              <input type="password" placeholder="Re-enter PIN" maxLength={4} value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            </div>
            <div className="field">
              <label>Section</label>
              <select value={section} onChange={e => setSection(e.target.value)}>
                <option value="">Select your section</option>
                {sections.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Parent Email (optional)</label>
              <input type="email" placeholder="parent@example.com" value={parentEmail} onChange={e => setParentEmail(e.target.value)} />
            </div>
            <div className="field">
              <label>Parent Name (optional)</label>
              <input type="text" placeholder="e.g. Maria Dela Cruz" value={parentName} onChange={e => setParentName(e.target.value)} />
            </div>
            {pinError() && <div style={{ color: 'var(--red)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{pinError()}</div>}
            <button className="btn-primary" onClick={handleSubmit} disabled={!name.trim() || pin.length !== 4 || pin !== pinConfirm || !section}>
              Submit Registration
            </button>
          </div>
        )}
        {phase === 'submitting' && (
          <div className="reg-result" style={{ padding: 40 }}>
            <img src="/emu-300.gif" style={{ width: 80, height: 80 }} />
            <h3>Submitting…</h3>
          </div>
        )}
        {phase === 'success' && (
          <div className="reg-result">
            <div className="reg-icon">⏳</div>
            <h3>Registered!</h3>
            <p>{message}</p>
            <p style={{ marginTop: 8, color: 'var(--gold)', fontWeight: 600, fontSize: 14 }}>Waiting for teacher approval. Use your PIN to scan once approved.</p>
            <button className="btn-primary mt24" onClick={onBack}>Back to Home</button>
          </div>
        )}
        {phase === 'failed' && (
          <div className="reg-result">
            <div className="reg-icon">❌</div>
            <h3>Something went wrong</h3>
            <p>{errorMsg}</p>
            <button className="btn-primary mt24" onClick={() => { setPhase('form'); setErrorMsg(''); setTeacherCode(''); setPin(''); setPinConfirm('') }}>Try Again</button>
          </div>
        )}
      </div>
    </>
  )
}
