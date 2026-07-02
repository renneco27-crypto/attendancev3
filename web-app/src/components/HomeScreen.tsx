import React, { useEffect, useState } from 'react'

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

  useEffect(() => {
    if (!navigator.geolocation) { setGeoLabel('📍 Location unavailable'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = haversine(pos.coords.latitude, pos.coords.longitude, 11.021893, 124.587584)
        setGeoLabel(dist <= 300 ? `📍 On campus (${Math.round(dist)}m from gate)` : `📍 Off campus — ${Math.round(dist)}m away`)
      },
      () => setGeoLabel('📍 Location unavailable'),
      { enableHighAccuracy: true, timeout: 8000 }
    )
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
        <div className="home-sub">Scan your QR code to log attendance instantly. Built for students and teachers at ACLC Ormoc.</div>
        <div className="home-btns">
          <button className="btn-primary" onClick={() => onSelectRole('student')}>📱 I'm a Student</button>
          <div className="home-row">
            <button className="btn-outline" onClick={() => onSelectRole('teacher')}>🔐 I'm a Teacher</button>
            <button className="btn-outline" onClick={() => onSelectRole('register')}>📋 Register Device</button>
          </div>
        </div>
      </div>
    </>
  )
}
