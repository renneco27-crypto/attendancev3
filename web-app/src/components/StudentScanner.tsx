import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../services/supabase'
import { getDeviceId } from '../utils/device'
import { checkMockLocation } from '../utils/mockLocation'
import { checkDeveloperOptions } from '../utils/developerOptions'

interface Props {
  onBack: () => void
  pinValue: string
}

type ScanPhase = 'idle' | 'scanning' | 'liveness' | 'success' | 'fail' | 'geo-fail' | 'mock-fail' | 'devopts-fail' | 'liveness-timeout' | 'liveness-fail'

const SCANNER_ID = 'qr-scanner'
const CAPTURE_WINDOW_MS = 10000

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toR = Math.PI / 180
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface QrPayload {
  session_id: string
  rotation_key: string
}

const BACKEND_URL = '' // relative, same origin

export default function StudentScanner({ onBack, pinValue }: Props) {
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [geoText, setGeoText] = useState('Checking location…')
  const [capturedCount, setCapturedCount] = useState(0)
  const [livenessPrompt, setLivenessPrompt] = useState('')
  const [livenessScore, setLivenessScore] = useState(0)
  const [livenessReason, setLivenessReason] = useState('')
  const [livenessProgress, setLivenessProgress] = useState(0)
  const [livenessResult, setLivenessResult] = useState<'scanning' | 'pass' | 'fail'>('scanning')
  const [alreadyCheckedIn, setAlreadyCheckedIn] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const capturedRef = useRef<QrPayload[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishingRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const livenessSessionIdRef = useRef<string>('')
  const noFaceSecondsRef = useRef(0)
  const noFaceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const capturedDataRef = useRef<{ sessionId: string; studentId: string; studentName: string; role: string; section: string; faceFrameUrl?: string } | null>(null)

  useEffect(() => {
    return () => {
      stopScanner()
      stopFrontCamera()
      if (timerRef.current) clearTimeout(timerRef.current)
      if (captureTimerRef.current) clearInterval(captureTimerRef.current)
      if (noFaceTimerRef.current) clearInterval(noFaceTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (scanPhase === 'scanning') startCamera()
  }, [scanPhase])

  useEffect(() => {
    if (scanPhase === 'liveness') startLivenessCapture()
  }, [scanPhase])

  function checkGeo() {
    if (!navigator.geolocation) { setGeoText('⚠️ Could not verify location'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = haversine(pos.coords.latitude, pos.coords.longitude, 11.021893, 124.587584)
        if (dist <= 300) setGeoText(`✅ On campus (${Math.round(dist)}m from gate)`)
        else { setGeoText(`❌ You are ${Math.round(dist)}m off campus`); setTimeout(() => setScanPhase('geo-fail'), 800) }
      },
      () => setGeoText('⚠️ Could not verify location'),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  async function startScan() {
    finishingRef.current = false
    capturedRef.current = []
    setCapturedCount(0)
    const { isDevOptionsOn } = await checkDeveloperOptions()
    if (isDevOptionsOn) { setScanPhase('devopts-fail'); return }
    const { isMocked } = await checkMockLocation()
    if (isMocked) { setScanPhase('mock-fail'); return }
    setScanPhase('scanning')
  }

  async function startCamera() {
    const scanner = new Html5Qrcode(SCANNER_ID)
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 280, height: 280 } },
        onDecoded,
        () => {}
      )
      timerRef.current = setTimeout(finishCapture, CAPTURE_WINDOW_MS)
    } catch {
      setErrorMsg('Camera access denied. Grant camera permission and try again.')
      setScanPhase('fail')
    }
  }

  function onDecoded(text: string) {
    if (finishingRef.current) return
    try {
      const data = JSON.parse(text)
      const sid = data.session_id || data.s
      const rk = data.rotation_key || data.t
      if (!sid || !rk) return
      if (capturedRef.current.some(c => c.rotation_key === rk)) return
      capturedRef.current.push({ session_id: sid, rotation_key: rk })
      setCapturedCount(capturedRef.current.length)
      if (capturedRef.current.length >= 2) {
        if (timerRef.current) clearTimeout(timerRef.current)
        finishCapture()
      }
    } catch {}
  }

  async function finishCapture() {
    if (finishingRef.current) return
    finishingRef.current = true
    await stopScanner()

    const caps = capturedRef.current
    if (caps.length < 2) {
      setErrorMsg(`Only ${caps.length} QR code(s) captured. Need at least 2.`)
      setScanPhase('fail')
      return
    }

    const last = caps[caps.length - 1]
    const prev = caps[caps.length - 2]

    const { data: session, error: sessErr } = await supabase()
      .from('attendance_sessions')
      .select('*')
      .eq('id', last.session_id)
      .single()

    if (sessErr || !session) {
      setErrorMsg('Session not found')
      setScanPhase('fail'); return
    }

    if (!session.is_active) {
      setErrorMsg('Session has ended.')
      setScanPhase('fail'); return
    }

    if (new Date(session.expires_at) < new Date()) {
      setErrorMsg('Session has ended.')
      setScanPhase('fail'); return
    }

    if (last.rotation_key === prev.rotation_key) {
      setErrorMsg('QR code expired. Try again.')
      setScanPhase('fail'); return
    }

    if (session.rotation_key !== last.rotation_key) {
      setErrorMsg('QR code expired. Try again.')
      setScanPhase('fail'); return
    }

    const prevKeys = session.previous_rotation_keys ?? []
    if (!prevKeys.includes(prev.rotation_key)) {
      setErrorMsg('QR code expired. Try again.')
      setScanPhase('fail'); return
    }

    const keyAge = Date.now() - new Date(session.rotation_key_updated_at).getTime()
    if (keyAge > 2000) {
      setErrorMsg('QR code expired. Try again.')
      setScanPhase('fail'); return
    }

    const deviceId = getDeviceId()
    const { data: devReg, error: devErr } = await supabase()
      .from('device_registrations')
      .select('id, student_id, student_name, status, pin, section')
      .eq('device_identifier', deviceId)
      .eq('teacher_id', session.teacher_id)
      .single()

    if (devErr || !devReg) {
      setErrorMsg('Device not registered. Contact your teacher.')
      setScanPhase('fail'); return
    }

    if (devReg.status !== 'approved') {
      setErrorMsg('Your device hasn\'t been approved yet.')
      setScanPhase('fail'); return
    }

    if (!devReg.pin || pinValue !== devReg.pin) {
      setErrorMsg('Incorrect PIN.')
      setScanPhase('fail'); return
    }

    const { data: existing } = await supabase()
      .from('attendance_records')
      .select('id')
      .eq('session_id', last.session_id)
      .eq('student_id', devReg.student_id)
      .maybeSingle()

    if (existing) {
      setAlreadyCheckedIn(true)
      setScanPhase('success')
      return
    }

    capturedDataRef.current = {
      sessionId: last.session_id,
      studentId: devReg.student_id,
      studentName: devReg.student_name,
      role: 'student',
      section: devReg.section || ''
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/startLivenessSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'student',
          studentId: devReg.student_id,
          studentName: devReg.student_name
        })
      })
      const data = await resp.json()
      if (data.sessionId) {
        livenessSessionIdRef.current = data.sessionId
        setLivenessPrompt(data.prompt.instruction)
        setScanPhase('liveness')
      } else {
        setErrorMsg('Liveness check unavailable.')
        setScanPhase('fail')
      }
    } catch {
      setErrorMsg('Liveness check unavailable.')
      setScanPhase('fail')
    }
  }

  async function stopScanner() {
    try { if (scannerRef.current) { await scannerRef.current.stop(); scannerRef.current.clear() } } catch {}
  }

  async function startLivenessCapture() {
    setLivenessResult('scanning')
    setLivenessProgress(0)
    setLivenessScore(0)
    setLivenessReason('')
    noFaceSecondsRef.current = 0
    frameCountRef.current = 0

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch {
      setErrorMsg('Front camera access denied.')
      setScanPhase('fail')
      return
    }

    noFaceTimerRef.current = setInterval(() => {
      noFaceSecondsRef.current++
      if (noFaceSecondsRef.current >= 5) {
        cleanupLiveness()
        setScanPhase('liveness-timeout')
      }
    }, 1000)

    captureTimerRef.current = setInterval(captureLivenessFrame, 800)
  }

  const frameCountRef = useRef(0)

  async function captureLivenessFrame() {
    if (!videoRef.current || livenessResult !== 'scanning') return

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth || 320
    canvas.height = videoRef.current.videoHeight || 240
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(videoRef.current, 0, 0)
    const b64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1]

    frameCountRef.current++
    setLivenessProgress(frameCountRef.current)

    try {
      const resp = await fetch(`${BACKEND_URL}/api/sendFrameForAnalysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: livenessSessionIdRef.current, frameBase64: b64 })
      })
      const data = await resp.json()
      setLivenessScore(data.score)
      setLivenessReason(data.reason)
      if (data.isLive) noFaceSecondsRef.current = 0
    } catch {}

    if (frameCountRef.current >= 6) {
      finishLiveness()
    }
  }

  async function finishLiveness() {
    cleanupLiveness()
    const c = capturedDataRef.current
    if (!c) { setScanPhase('success'); return }

    const passed = livenessScore >= 60
    setLivenessResult(passed ? 'pass' : 'fail')

    if (!passed) {
      setScanPhase('liveness-fail')
      return
    }

    try {
      const resp = await fetch(`${BACKEND_URL}/api/submitAttendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: livenessSessionIdRef.current, qrSessionId: c.sessionId, qrData: c.studentId, role: c.role })
      })
      const data = await resp.json()
      if (data.frameUrl) c.faceFrameUrl = data.frameUrl
    } catch {}

    await supabase()
      .from('attendance_records')
      .insert({
        session_id: c.sessionId,
        student_id: c.studentId,
        student_name: c.studentName,
        section: c.section,
        face_frame_url: c.faceFrameUrl || null,
        is_mock_location: false
      })

    setTimeout(() => setScanPhase('success'), 800)
  }

  function cleanupLiveness() {
    if (captureTimerRef.current) { clearInterval(captureTimerRef.current); captureTimerRef.current = null }
    if (noFaceTimerRef.current) { clearInterval(noFaceTimerRef.current); noFaceTimerRef.current = null }
    stopFrontCamera()
  }

  function stopFrontCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  function resetScanner() {
    finishingRef.current = false
    capturedRef.current = []
    setCapturedCount(0)
    setErrorMsg('')
    setAlreadyCheckedIn(false)
    setLivenessPrompt('')
    setLivenessScore(0)
    setLivenessReason('')
    setLivenessProgress(0)
    setLivenessResult('scanning')
    setScanPhase('idle')
    checkGeo()
  }

  return (
    <>
      <div className="scanner-topbar">
        <div className="tb-logo-img"><img src="/photo_2.webp" alt="ACLC Ormoc" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
        <div className="tb-brand" style={{ fontSize: 15, fontWeight: 800 }}>
           {scanPhase === 'success' ? 'Attendance Recorded!' : scanPhase === 'fail' ? 'Scan Failed' : scanPhase === 'liveness' || scanPhase === 'liveness-timeout' || scanPhase === 'liveness-fail' ? 'Face Check' : 'QR Scanner'}
          <span>ACLC Ormoc · Attendance</span>
        </div>
      </div>

      {scanPhase === 'idle' && (
        <div className="scanner-body">
          <div className="geo-check">📍 <span>{geoText}</span></div>
          <div className="qr-viewport">
            <div className="qr-br" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 52 }}>📷</div>
            </div>
          </div>
          <div className="scan-hint">Point your camera at the QR code on your teacher's screen. Hold steady to capture two consecutive codes.</div>
          <div className="scanner-btns">
            <button className="btn-white" onClick={startScan}>▶ Start Camera</button>
            <button className="btn-white-ghost" onClick={onBack}>Cancel</button>
          </div>
        </div>
      )}

      {scanPhase === 'scanning' && (
        <div className="scanner-body">
          <div className="qr-viewport">
            <div className="qr-br" />
            <div className="scan-line" />
            <div id={SCANNER_ID} style={{ width: '100%', height: '100%' }} />
          </div>
          <div className="scan-hint" style={{ color: 'rgba(255,255,255,.9)' }}>Capturing QR codes… ({capturedCount} captured)</div>
          <div className="scanner-btns">
            <button className="btn-white-ghost" onClick={() => { stopScanner(); resetScanner() }}>Cancel</button>
          </div>
        </div>
      )}

      {(scanPhase === 'liveness' || scanPhase === 'liveness-timeout') && (
        <div className="liveness-body">
          {scanPhase === 'liveness' && (
            <>
              <div className="liveness-prompt">{livenessPrompt}</div>
              <div className="liveness-video-wrap">
                <video ref={videoRef} autoPlay playsInline muted />
              </div>
              <div className="liveness-bar-wrap">
                <div className="liveness-bar">
                  <div className="liveness-bar-fill" style={{ width: `${Math.min(livenessScore, 100)}%` }} />
                </div>
                <div className="liveness-bar-label">{livenessScore}/100 · {livenessReason || 'Analyzing…'}</div>
              </div>
              <div className="liveness-status">Scanning face… ({livenessProgress}/6)</div>
            </>
          )}
          {scanPhase === 'liveness-timeout' && (
            <>
              <div className="result-icon fail">⏰</div>
              <div className="result-title">No Face Detected</div>
              <div className="result-sub">No face was detected in the camera. Please try again.</div>
              <div className="scanner-btns">
                <button className="btn-white" onClick={resetScanner}>Try Again</button>
                <button className="btn-white-ghost" onClick={onBack}>Back</button>
              </div>
            </>
          )}

          {scanPhase === 'liveness-fail' && (
            <>
              <div className="result-icon fail">✖</div>
              <div className="result-title">Liveness Check Failed</div>
              <div className="result-sub">{livenessReason || 'Could not verify liveness. Please try again.'}</div>
              <div className="scanner-btns">
                <button className="btn-white" onClick={resetScanner}>Try Again</button>
                <button className="btn-white-ghost" onClick={onBack}>Back</button>
              </div>
            </>
          )}
        </div>
      )}

      {scanPhase === 'success' && (
        <div className="scanner-body">
          <div className="result-icon success">✅</div>
          <div className="result-title">{alreadyCheckedIn ? 'Already Checked In' : 'Attendance Recorded!'}</div>
          <div className="result-sub">{alreadyCheckedIn ? 'You have already checked in for this session.' : 'Your attendance has been logged.'}</div>
          <div className="scanner-btns">
            <button className="btn-white" onClick={resetScanner}>Done</button>
          </div>
        </div>
      )}

      {scanPhase === 'fail' && (
        <div className="scanner-body">
          <div className="result-icon fail">✖</div>
          <div className="result-title">Scan Failed</div>
          <div className="result-sub">{errorMsg}</div>
          <div className="scanner-btns">
            <button className="btn-white" onClick={resetScanner}>Try Again</button>
            <button className="btn-white-ghost" onClick={onBack}>Back</button>
          </div>
        </div>
      )}

      {scanPhase === 'geo-fail' && (
        <div className="scanner-body">
          <div className="result-icon fail">📍</div>
          <div className="result-title">Outside Campus</div>
          <div className="result-sub">You must be on ACLC Ormoc campus to scan attendance.</div>
          <div className="scanner-btns">
            <button className="btn-white" onClick={resetScanner}>Retry Location</button>
            <button className="btn-white-ghost" onClick={onBack}>Back</button>
          </div>
        </div>
      )}

      {scanPhase === 'mock-fail' && (
        <div className="scanner-body">
          <div className="result-icon fail">📱</div>
          <div className="result-title">Fake Location Detected</div>
          <div className="result-sub">Please turn off mock GPS / fake location apps and try again.</div>
          <div className="scanner-btns">
            <button className="btn-white" onClick={resetScanner}>Try Again</button>
            <button className="btn-white-ghost" onClick={onBack}>Back</button>
          </div>
        </div>
      )}

      {scanPhase === 'devopts-fail' && (
        <div className="devopts-warn-body">
          <div className="result-icon fail" style={{ background: 'rgba(0,0,0,.2)', border: '2.5px solid rgba(255,255,255,.5)' }}>⚙️</div>
          <div className="result-title">Developer Options Detected</div>
          <div className="result-sub">Please turn off Developer Options and USB Debugging in your device settings to continue.</div>
          <div className="scanner-btns">
            <button className="btn-white" onClick={resetScanner}>I've Turned Them Off</button>
            <button className="btn-white-ghost" onClick={onBack}>Back</button>
          </div>
        </div>
      )}
    </>
  )
}
