import React, { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'

interface Props {
  onSelectRole: (role: 'student' | 'teacher' | 'register') => void
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toR = Math.PI / 180
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function HomeScreen({ onSelectRole }: Props) {
  const [geoLabel, setGeoLabel] = useState('Locating you…')
  const [locationReady, setLocationReady] = useState(false)
  const [geoBlocked, setGeoBlocked] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: locEnabled } = await supabase()
        .from('settings').select('value').eq('key', 'locationEnabled').maybeSingle()
      if (locEnabled?.value === 'false') { setGeoLabel('📍 Location check disabled'); setLocationReady(true); return }
      const { data: lat } = await supabase()
        .from('settings').select('value').eq('key', 'campusLat').maybeSingle()
      const { data: lng } = await supabase()
        .from('settings').select('value').eq('key', 'campusLng').maybeSingle()
      const { data: radius } = await supabase()
        .from('settings').select('value').eq('key', 'campusRadius').maybeSingle()
      const campusLat = lat?.value, campusLng = lng?.value, maxDist = radius?.value
      if (!campusLat || !campusLng || !maxDist) { setGeoLabel('📍 Location not configured'); setLocationReady(true); return }
      if (!navigator.geolocation) { setGeoLabel('📍 Location unavailable'); setGeoBlocked(true); return }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const dist = haversine(pos.coords.latitude, pos.coords.longitude, parseFloat(campusLat), parseFloat(campusLng))
          const onCampus = dist <= parseInt(maxDist)
          setGeoLabel(onCampus ? `📍 On campus (${Math.round(dist)}m from gate)` : `📍 Off campus — ${Math.round(dist)}m away`)
          setGeoBlocked(!onCampus)
          if (onCampus) setLocationReady(true)
        },
        () => { setGeoLabel('📍 Location unavailable'); setGeoBlocked(true) },
        { enableHighAccuracy: true, timeout: 8000 }
      )
    })()
  }, [])

  return (
    <>
      <div className="home-bg" />
      <div className="home-content">
        <div className="logo-ring">
          <img src="/photo_2.webp" alt="ACLC Ormoc" />
        </div>
        <div className="home-uni">ACLC College Ormoc</div>
        <div className="home-college">College of Computer Studies</div>
        <div className="home-title">Attendance<br />Scanner</div>
        <div className="geo-pill"><div className="geo-dot" /><span id="home-geo-label">{geoLabel}</span></div>
        {geoBlocked && (
          <div style={{ background: 'rgba(212,0,0,.2)', border: '1px solid rgba(255,255,255,.35)', borderRadius: 12, padding: '10px 16px', marginBottom: 16, color: '#fff', fontSize: 13, fontWeight: 600, textAlign: 'center', backdropFilter: 'blur(4px)' }}>
            ⚠️ You must be on campus to use this app. Please proceed to ACLC Ormoc campus.
          </div>
        )}
        <div className="home-sub">Scan your QR code to log attendance instantly. Built for students and teachers at ACLC Ormoc.</div>
        <div className="home-btns">
          <button className="btn-primary" onClick={() => onSelectRole('student')} disabled={!locationReady} style={{ opacity: locationReady ? 1 : 0.5 }}>📱 I'm a Student</button>
          <div className="home-row">
            <button className="btn-outline" onClick={() => onSelectRole('teacher')} disabled={!locationReady} style={{ opacity: locationReady ? 1 : 0.5 }}>🔐 I'm a Teacher</button>
            <button className="btn-outline" onClick={() => onSelectRole('register')} disabled={!locationReady} style={{ opacity: locationReady ? 1 : 0.5 }}>📋 Register Device</button>
          </div>
        </div>
      </div>
    </>
  )
}
