import React, { useState, useEffect } from 'react'
import HomeScreen from './components/HomeScreen'
import PINGate from './components/PINGate'
import StudentScanner from './components/StudentScanner'
import TeacherLogin from './components/TeacherLogin'
import TeacherSession from './components/TeacherSession'
import RegisterDevice from './components/RegisterDevice'
import { supabase } from './services/supabase'
import './App.css'

type Phase = 'home' | 'pin' | 'scanner' | 'teacher-login' | 'teacher' | 'register'

export default function App() {
  const [phase, setPhase] = useState<Phase>('home')
  const [pinValue, setPinValue] = useState('')
  const [navCount, setNavCount] = useState(0)

  useEffect(() => {
    supabase().auth.getSession().then(({ data: { session } }) => {
      if (session) setPhase('teacher')
    }).catch(() => {})
  }, [])

  function go(id: Phase) { setNavCount(c => c + 1); setPhase(id); window.scrollTo(0, 0) }
  function handleRegistered(pin: string) { setPinValue(pin) }
  async function handleSelectRole(role: string) {
    if (role === 'teacher') {
      const { data: { session } } = await supabase().auth.getSession()
      go(session ? 'teacher' : 'teacher-login')
    } else if (role === 'student') {
      go('pin')
    } else {
      go('register')
    }
  }

  return (
    <div className="app">
      <div className={`screen ${phase === 'home' ? 'active' : ''}`} id="home">
        <HomeScreen onSelectRole={handleSelectRole} />
      </div>
      <div className={`screen ${phase === 'pin' ? 'active' : ''}`} id="pin">
        <PINGate key={navCount} onSuccess={(pin) => { setPinValue(pin); setPhase('scanner') }} onBack={() => go('home')} />
      </div>
      <div className={`screen ${phase === 'scanner' ? 'active' : ''}`} id="scanner">
        <StudentScanner key={navCount} onBack={() => go('home')} pinValue={pinValue} />
      </div>
      <div className={`screen ${phase === 'register' ? 'active' : ''}`} id="register">
        <RegisterDevice key={navCount} onBack={() => go('home')} onRegistered={handleRegistered} />
      </div>
      <div className={`screen ${phase === 'teacher-login' ? 'active' : ''}`} id="teacher-login">
        <TeacherLogin onLogin={() => go('teacher')} onBack={() => go('home')} />
      </div>
      <div className={`screen ${phase === 'teacher' ? 'active' : ''}`} id="teacher-dash">
        <TeacherSession onLogout={() => go('home')} />
      </div>
    </div>
  )
}
