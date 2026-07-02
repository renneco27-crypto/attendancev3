import { supabase } from './supabase'

export interface CapturedToken {
  token: string
  sequence_index: number
  capture_timestamp: number
}

export interface AttendanceResult {
  success: boolean
  reason: string | null
}

export async function submitAttendance(
  studentDeviceId: string,
  capturedSequence: CapturedToken[],
  pinPassed: boolean
): Promise<AttendanceResult> {
  const { data, error } = await supabase().functions.invoke('validate-attendance', {
    body: {
      student_device_id: studentDeviceId,
      biometric_pass: pinPassed,
      captured_sequence: capturedSequence,
    },
  })

  if (error) {
    return { success: false, reason: 'SERVER_ERROR' }
  }

  return data as AttendanceResult
}

export async function validateScan(body: {
  session_id: string
  rotation_key: string
  previous_rotation_key: string
  student_device_id: string
  pin: string
}): Promise<{ success: boolean; student_name?: string; error?: string }> {
  const { data, error } = await supabase().functions.invoke('validate-scan', { body })

  if (error) {
    return { success: false, error: 'SERVER_ERROR' }
  }

  if (data?.error) {
    return { success: false, error: data.error }
  }

  return { success: true, student_name: data.student_name }
}

export async function revokeDevice(deviceRegistrationId: string): Promise<boolean> {
  const { error } = await supabase().functions.invoke('revoke-device', {
    body: { device_registration_id: deviceRegistrationId },
  })
  return !error
}

export async function kickFromSession(attendanceRecordId: string): Promise<boolean> {
  const { error } = await supabase().functions.invoke('kick-from-session', {
    body: { attendance_record_id: attendanceRecordId },
  })
  return !error
}

export async function rotateSessionKey(sessionId: string): Promise<{ rotation_key: string } | { error: string; ended?: boolean }> {
  const { data, error } = await supabase().functions.invoke('rotate-session-key', {
    body: { session_id: sessionId },
  })

  if (error) {
    return { error: 'SERVER_ERROR' }
  }

  if (data?.error) {
    return { error: data.error, ended: data.error === 'Session has ended' }
  }

  return { rotation_key: data.rotation_key }
}

export async function createSession(className: string, teacherId: string): Promise<{ id: string; rotation_key: string }> {
  const rotationKey = crypto.randomUUID()
  const c = supabase()

  const { data, error } = await c
    .from('attendance_sessions')
    .insert({
      class_name: className,
      teacher_id: teacherId,
      rotation_key: rotationKey,
      is_active: true,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })
    .select('id, rotation_key')
    .single()

  if (error) throw new Error(error.message)
  return { id: data.id, rotation_key: data.rotation_key }
}

export async function endSession(sessionId: string): Promise<void> {
  const c = supabase()
  const { error } = await c
    .from('attendance_sessions')
    .update({ is_active: false })
    .eq('id', sessionId)

  if (error) throw new Error(error.message)
}
