import { supabase } from '../services/supabase'

interface EmailJsProvider {
  name: string
  serviceId: string
  templateId: string
  publicKey: string
  dailyLimit: number
}

function loadProviders(): EmailJsProvider[] {
  const hardcoded: EmailJsProvider[] = [
    { name: 'emailjs_1', serviceId: 'service_xm4jf6f', templateId: 'template_hr3tjks', publicKey: '9CxKfrBe4TlhWCtqO', dailyLimit: 30 },
    { name: 'emailjs_2', serviceId: 'service_qbtste8', templateId: 'template_72opyxl', publicKey: 'fwleshmOUbIuDPuRT', dailyLimit: 30 },
    { name: 'emailjs_3', serviceId: 'service_x13oewk', templateId: 'template_91ax3xp', publicKey: 'MoG3Pqw56ewTj3oKa', dailyLimit: 30 },
  ]
  const keys = ['1', '2', '3'] as const
  const fromEnv: EmailJsProvider[] = []
  for (const k of keys) {
    const sid = import.meta.env[`VITE_EMAILJS_${k}_SERVICE_ID`] as string | undefined
    const tid = import.meta.env[`VITE_EMAILJS_${k}_TEMPLATE_ID`] as string | undefined
    const pk = import.meta.env[`VITE_EMAILJS_${k}_PUBLIC_KEY`] as string | undefined
    if (sid && tid && pk) {
      fromEnv.push({ name: `emailjs_${k}`, serviceId: sid, templateId: tid, publicKey: pk, dailyLimit: 30 })
    }
  }
  return fromEnv.length === 3 ? fromEnv : hardcoded
}

const providers = loadProviders()

export async function sendParentEmail(
  studentId: string,
  attendanceId: string,
): Promise<{ success: boolean; provider?: string }> {
  const { data: student } = await supabase()
    .from('device_registrations')
    .select('parent_email, parent_name, student_name')
    .eq('student_id', studentId)
    .maybeSingle()

  if (!student || !student.parent_email) {
    return { success: false }
  }

  const templateParams = {
    to_email: student.parent_email,
    parent_name: student.parent_name,
    student_name: student.student_name,
    school_name: 'ACLC Attendance',
    timestamp: new Date().toLocaleString(),
  }

  for (const p of providers) {
    const { data: canSend } = await supabase()
      .rpc('increment_email_quota', { p_provider: p.name, p_limit: p.dailyLimit })
    if (!canSend) continue

    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: p.serviceId,
          template_id: p.templateId,
          user_id: p.publicKey,
          template_params: templateParams,
        }),
      })

      if (res.ok) {
        supabase()
          .from('attendance_records')
          .update({ email_sent: true, email_provider_used: p.name })
          .eq('id', attendanceId)
          .then()
        return { success: true, provider: p.name }
      }
    } catch {
      // fall through to next provider
    }
  }

  console.error('All 3 EmailJS providers exhausted or failed')
  return { success: false }
}
