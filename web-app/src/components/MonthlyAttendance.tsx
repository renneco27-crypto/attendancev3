import React, { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

interface Props {
  selectedSection: string
}

interface StudentRow {
  id: string
  student_id: string
  student_name: string
}

interface HistoryEntry {
  studentId: string
  studentName: string
  day: number
  wasPresent: boolean
}

export default function MonthlyAttendance({ selectedSection }: Props) {
  const [date, setDate] = useState(new Date())
  const [students, setStudents] = useState<StudentRow[]>([])
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])

  const year = date.getFullYear()
  const month = date.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  useEffect(() => {
    if (selectedSection) loadData()
    else setStudents([])
  }, [selectedSection, year, month])

  async function loadData() {
    setLoading(true)
    const { data: roster } = await supabase()
      .from('device_registrations')
      .select('id, student_id, student_name')
      .eq('section', selectedSection)
      .neq('status', 'revoked')
      .order('student_name', { ascending: true })

    const start = new Date(year, month, 1).toISOString()
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString()

    const { data: attRecords } = await supabase()
      .from('attendance_records')
      .select('student_id, scanned_at')
      .eq('section', selectedSection)
      .gte('scanned_at', start)
      .lte('scanned_at', end)

    const ps = new Set<string>()
    if (attRecords) {
      attRecords.forEach(r => {
        const day = new Date(r.scanned_at).getDate()
        ps.add(r.student_id + '-' + day)
      })
    }

    if (roster) setStudents(roster)
    setPresent(ps)
    setLoading(false)
  }

  async function toggleCell(studentId: string, studentName: string, day: number, newPresent: boolean) {
    const key = studentId + '-' + day
    if (newPresent) {
      const scannedAt = new Date(year, month, day, 12, 0, 0).toISOString()
      await supabase()
        .from('attendance_records')
        .insert({ student_id: studentId, student_name: studentName, section: selectedSection, scanned_at: scannedAt })
      const next = new Set(present)
      next.add(key)
      setPresent(next)
    } else {
      const dayStart = new Date(year, month, day).toISOString()
      const dayEnd = new Date(year, month, day, 23, 59, 59).toISOString()
      await supabase()
        .from('attendance_records')
        .delete()
        .eq('student_id', studentId)
        .eq('section', selectedSection)
        .gte('scanned_at', dayStart)
        .lte('scanned_at', dayEnd)
      const next = new Set(present)
      next.delete(key)
      setPresent(next)
    }
  }

  async function toggle(studentId: string, studentName: string, day: number) {
    const wasPresent = present.has(studentId + '-' + day)
    setUndoStack(prev => [...prev, { studentId, studentName, day, wasPresent }])
    setRedoStack([])
    await toggleCell(studentId, studentName, day, !wasPresent)
  }

  async function undo() {
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setRedoStack(prev => [...prev, entry])
    await toggleCell(entry.studentId, entry.studentName, entry.day, entry.wasPresent)
  }

  async function redo() {
    if (redoStack.length === 0) return
    const entry = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    setUndoStack(prev => [...prev, entry])
    await toggleCell(entry.studentId, entry.studentName, entry.day, !entry.wasPresent)
  }

  function prevMonth() { setDate(new Date(year, month - 1, 1)) }
  function nextMonth() { setDate(new Date(year, month + 1, 1)) }

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="monthly-att">
      <div className="att-header">
        <div className="att-header-row">
          <button className="month-nav" onClick={prevMonth}>‹</button>
          <div className="month-label">{monthLabel}</div>
          <button className="month-nav" onClick={nextMonth}>›</button>
        </div>
        <div className="att-count">
          {students.length > 0 && (
            <span>Present today: {students.filter(s => present.has(s.student_id + '-' + new Date().getDate())).length} / {students.length}</span>
          )}
        </div>
        {selectedSection && students.length > 0 && (
          <div className="att-actions">
            <button className="btn-small" onClick={undo} disabled={undoStack.length === 0} style={{ opacity: undoStack.length === 0 ? 0.4 : 1 }}>↩ Undo</button>
            <button className="btn-small" onClick={redo} disabled={redoStack.length === 0} style={{ opacity: redoStack.length === 0 ? 0.4 : 1 }}>↪ Redo</button>
          </div>
        )}
      </div>

      {!selectedSection && <div className="att-empty">Select a section above to view attendance.</div>}
      {loading && <div className="att-empty"><img src="/emu-300.gif" style={{ width: 80, height: 80 }} /></div>}
      {selectedSection && !loading && students.length === 0 && <div className="att-empty">No students in this section.</div>}

      {selectedSection && !loading && students.length > 0 && (
        <div className="att-grid-wrap">
          <div className="att-grid">
            <div className="att-grid-row att-grid-head">
              <div className="att-grid-name">Student</div>
              {Array.from({ length: daysInMonth }, (_, i) => (
                <div key={i} className={`att-grid-day ${weekdays[new Date(year, month, i + 1).getDay()] === 'Sun' || weekdays[new Date(year, month, i + 1).getDay()] === 'Sat' ? 'att-weekend' : ''}`}>
                  {i + 1}
                  <div className="att-dow">{weekdays[new Date(year, month, i + 1).getDay()].slice(0, 2)}</div>
                </div>
              ))}
            </div>
            {students.map(s => (
              <div key={s.student_id} className="att-grid-row">
                <div className="att-grid-name">{s.student_name}</div>
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1
                  const isPresent = present.has(s.student_id + '-' + day)
                  return (
                    <div key={day}
                      className={`att-grid-cell ${isPresent ? 'att-cell-present' : 'att-cell-absent'} ${new Date(year, month, day).getDay() === 0 || new Date(year, month, day).getDay() === 6 ? 'att-weekend' : ''}`}
                      onClick={() => toggle(s.student_id, s.student_name, day)}>
                      {isPresent ? '✓' : ''}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
