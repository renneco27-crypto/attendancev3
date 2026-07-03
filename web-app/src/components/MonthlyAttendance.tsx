import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../services/supabase'
import * as XLSX from 'xlsx'

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
  const [csvHelp, setCsvHelp] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function exportExcel() {
    const wsData: (string | number)[][] = []
    const header: string[] = ['Student']
    for (let d = 1; d <= daysInMonth; d++) header.push(String(d))
    header.push('Total')
    wsData.push(header)

    students.forEach(s => {
      let count = 0
      const row: (string | number)[] = [s.student_name]
      for (let d = 1; d <= daysInMonth; d++) {
        const p = present.has(s.student_id + '-' + d)
        if (p) count++
        row.push(p ? '✓' : '')
      }
      row.push(`${count}/${daysInMonth}`)
      wsData.push(row)
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    ws['!cols'] = [{ wch: 25 }, ...Array(daysInMonth).fill({ wch: 5 }), { wch: 10 }]

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (!ws[addr]) continue
      ws[addr].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1A3A6B' } }, alignment: { horizontal: 'center' } }
    }
    for (let r = 1; r <= range.e.r; r++) {
      for (let c = 1; c < range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (!ws[addr]) continue
        const isPresent = ws[addr].v === '✓'
        ws[addr].s = { fill: { fgColor: { rgb: isPresent ? 'E8F5EC' : 'F5F5F5' } }, alignment: { horizontal: 'center' } }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, selectedSection + '_' + monthLabel.replace(' ', '_') + '.xlsx')
  }

  function exportPdf() {
    const printWin = window.open('', '_blank')
    if (!printWin) return
    let html = `<html><head><title>${selectedSection} - ${monthLabel}</title>
<style>body{font-family:sans-serif;padding:20px}
h2{text-align:center;margin-bottom:20px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #ccc;padding:4px 6px;text-align:center}
th{background:#f5f5f5}
td.name{text-align:left;font-weight:600}
td.present{background:#d4edda;color:#155724}
td.absent{color:#ccc}
h3{margin-top:24px}
@media print{body{padding:0}}
</style></head><body>
<h2>${selectedSection}</h2>
<h3>${monthLabel} — Present: ${students.filter(s => present.has(s.student_id + '-' + new Date().getDate())).length} / ${students.length}</h3>
<table><tr><th>Student</th>`
    for (let d = 1; d <= daysInMonth; d++) html += `<th>${d}</th>`
    html += '</tr>'
    students.forEach(s => {
      html += `<tr><td class="name">${s.student_name}</td>`
      for (let d = 1; d <= daysInMonth; d++) {
        html += present.has(s.student_id + '-' + d) ? '<td class="present">✓</td>' : '<td class="absent">—</td>'
      }
      html += '</tr>'
    })
    html += '</table></body></html>'
    printWin.document.write(html)
    printWin.document.close()
    setTimeout(() => printWin.print(), 300)
  }

  function handleUpload() {
    fileInputRef.current?.click()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) { alert('CSV must have a header row and at least one student name.'); return }
    const names = lines.slice(1).map(l => l.split(',')[0].replace(/"/g, '').trim()).filter(n => n)
    if (!names.length) { alert('No student names found in CSV.'); return }
    const { data: teachers } = await supabase().from('teachers').select('auth_user_id').limit(1)
    const teacherId = teachers?.[0]?.auth_user_id
    if (!teacherId) { alert('No teacher configured.'); return }
    let added = 0
    for (const name of names) {
      const { data: existing } = await supabase()
        .from('device_registrations')
        .select('id').eq('student_name', name).eq('section', selectedSection)
        .neq('status', 'revoked').maybeSingle()
      if (!existing) {
        await supabase().from('device_registrations').insert({
          student_name: name, section: selectedSection, device_identifier: '', status: 'pending',
        })
        added++
      }
    }
    loadData()
    if (added > 0) alert(`Added ${added} new student(s) to ${selectedSection}.`)
    e.target.value = ''
  }

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
            <button className="btn-small" onClick={exportExcel}>📥 Download Excel</button>
            <button className="btn-small" onClick={exportPdf}>📄 PDF</button>
            <button className="btn-small" onClick={handleUpload}>📤 Upload CSV</button>
            <button className="btn-small" onClick={() => setCsvHelp(true)} style={{ minWidth: 32, padding: '4px 10px', fontWeight: 800, fontSize: 14 }}>?</button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
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

      {csvHelp && (
        <div className="img-preview-overlay" onClick={() => setCsvHelp(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', borderRadius: 16, padding: 28, maxWidth: 420, width: '90%', margin: '0 auto', position: 'relative', top: '20%' }}>
            <div style={{ fontFamily: "'Sora','Inter',sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>CSV Format</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Upload a .csv file with student names in the first column:</div>
            <div style={{ background: 'var(--off)', borderRadius: 10, padding: 14, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8, color: 'var(--text)' }}>
              Name<br />
              "Juan Dela Cruz"<br />
              "Maria Santos"<br />
              "Jose Rizal"<br />
              …
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
              First row is the header (skipped). Each row after adds a pending student registration under the selected section. Duplicate names are ignored.
            </div>
            <button className="btn-primary mt24" onClick={() => setCsvHelp(false)} style={{ width: '100%' }}>Got it</button>
          </div>
        </div>
      )}
    </div>
  )
}
