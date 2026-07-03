import React, { useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { getDeviceId } from '../utils/device'

interface Props {
  onBack: () => void
  onRegistered: (pin: string) => void
}

type Phase = 'form' | 'submitting' | 'success' | 'failed'

export default function RegisterDevice({ onBack, onRegistered }: Props) {
  const SECTIONS = ['BSIT 2-A', 'BSIT 2-B']
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [section, setSection] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [message, setMessage] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [cameraActive, setCameraActive] = useState(false)
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null)
  const [faceError, setFaceError] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  function rgbToYCbCr(r: number, g: number, b: number) {
    const y  = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    return { y, cb, cr }
  }

  function isSkinTone(r: number, g: number, b: number) {
    const { y, cb, cr } = rgbToYCbCr(r, g, b)
    if (y < 20 || y > 250) return false
    return cb >= 77 && cb <= 135 && cr >= 133 && cr <= 180
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } })
      streamRef.current = stream
      setCameraActive(true)
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      }, 50)
    } catch {
      setErrorMsg('Camera access denied.')
      setPhase('failed')
    }
  }

  function captureSelfie() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 320
    canvas.height = video.videoHeight || 240
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    const topY = Math.floor(canvas.height * 0.2)
    const botY = Math.floor(canvas.height * 0.8)
    const startX = Math.floor(canvas.width * 0.2)
    const endX = Math.floor(canvas.width * 0.8)
    let skinCount = 0
    let totalCount = 0
    for (let y = topY; y < botY; y++) {
      for (let x = startX; x < endX; x++) {
        totalCount++
        const idx = (y * canvas.width + x) * 4
        if (isSkinTone(data[idx], data[idx + 1], data[idx + 2])) skinCount++
      }
    }
    const ratio = totalCount > 0 ? skinCount / totalCount : 0
    if (ratio < 0.12) {
      setFaceError('No face detected — ensure your face is clearly visible and well-lit')
      return
    }
    setFaceError('')
    setCapturedSelfie(canvas.toDataURL('image/jpeg', 0.7))
    stopCamera()
  }

  function retakeSelfie() {
    setCapturedSelfie(null)
    setFaceError('')
    startCamera()
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }

  async function handleSubmit() {
    if (!name.trim() || pin.length !== 4 || pin !== pinConfirm) return
    if (!section) { setErrorMsg('Please select your section.'); setPhase('failed'); return }
    if (!capturedSelfie) { setErrorMsg('Please take a selfie photo.'); return }
    setPhase('submitting')
    const deviceId = getDeviceId()

    try {
      const { data: teachers } = await supabase()
        .from('teachers')
        .select('auth_user_id')
        .limit(1)
      if (!teachers || teachers.length === 0) {
        setErrorMsg('No teacher configured in the system.')
        setPhase('failed'); return
      }
      const teacherId = teachers[0].auth_user_id

      let facePhotoUrl = ''
      try {
        const b64 = capturedSelfie.split(',')[1]
        const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
        const fileName = `${deviceId}.jpg`
        const { error: upErr } = await supabase()
          .storage
          .from('face-photos')
          .upload(fileName, buf, { contentType: 'image/jpeg', upsert: true })
        if (!upErr) {
          const { data: urlData } = supabase()
            .storage
            .from('face-photos')
            .getPublicUrl(fileName)
          facePhotoUrl = urlData?.publicUrl || ''
        }
      } catch {}

      const { data: existing } = await supabase()
        .from('device_registrations')
        .select('id, status')
        .ilike('student_name', name.trim())
        .limit(1)

      if (existing && existing.length > 0) {
        const row = existing[0]
        if (row.status === 'approved') {
          stopCamera()
          setErrorMsg('This name already has an approved device.')
          setPhase('failed'); return
        }
        if (row.status === 'pending') {
          const { error: upErr } = await supabase()
            .from('device_registrations')
            .update({ device_identifier: deviceId, pin, section, face_photo_url: facePhotoUrl || null })
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
        stopCamera()
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
          face_photo_url: facePhotoUrl || null,
        })
      if (insErr) {
        if (insErr.message?.includes('idx_device_registrations_uniq')) {
          setErrorMsg('You have already used this device to sign in to an account. Please tell an admin to delete your account.')
        } else {
          setErrorMsg('Error: ' + insErr.message)
        }
        setPhase('failed'); return
      }

      stopCamera()
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
        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 14, lineHeight: 1.6 }}>Submit your name, create a 4-digit PIN, and take a selfie. Your teacher will approve your device.</p>
      </div>
      <div className="reg-card">
        {phase === 'form' && (
          <div>
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
                {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Selfie Photo</label>
              {!cameraActive && !capturedSelfie && (
                <button className="btn-ghost" onClick={startCamera} style={{ textAlign: 'center' }}>📸 Take Selfie</button>
              )}
              {cameraActive && (
                <div>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000' }} />
                  <button className="btn-primary" style={{ marginTop: 10 }} onClick={captureSelfie}>📸 Capture</button>
                  {faceError && <div style={{ color: 'var(--red)', fontSize: 13, fontWeight: 600, marginTop: 8, textAlign: 'center' }}>{faceError}</div>}
                </div>
              )}
              {capturedSelfie && (
                <div>
                  <img src={capturedSelfie} alt="Selfie" style={{ width: '100%', borderRadius: 12 }} />
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button className="btn-ghost" onClick={retakeSelfie}>Retake</button>
                    <button className="btn-primary" onClick={() => {}} style={{ opacity: 0.6, cursor: 'default' }}>✓ Photo Set</button>
                  </div>
                </div>
              )}
            </div>
            {pinError() && <div style={{ color: 'var(--red)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{pinError()}</div>}
            <button className="btn-primary" onClick={handleSubmit} disabled={!name.trim() || pin.length !== 4 || pin !== pinConfirm || !section || !capturedSelfie}>
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
            <button className="btn-primary mt24" onClick={() => { setPhase('form'); setErrorMsg(''); setPin(''); setPinConfirm('') }}>Try Again</button>
          </div>
        )}
      </div>
    </>
  )
}
