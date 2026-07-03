import { supabase } from '../services/supabase'

interface EmailJsProvider {
  name: string
  serviceId: string
  templateId: string
  publicKey: string
  dailyLimit: number
}

const providers: EmailJsProvider[] = [
  { name: 'emailjs_1', serviceId: '', templateId: '', publicKey: '', dailyLimit: 50 },
  { name: 'emailjs_2', serviceId: '', templateId: '', publicKey: '', dailyLimit: 50 },
  { name: 'emailjs_3', serviceId: '', templateId: '', publicKey: '', dailyLimit: 50 },
  { name: 'emailjs_4', serviceId: '', templateId: '', publicKey: '', dailyLimit: 50 },
  { name: 'emailjs_5', serviceId: '', templateId: '', publicKey: '', dailyLimit: 50 },
]

export async function sendParentEmail(
  parentEmail: string,
  studentName: string,
  section: string,
  attendanceId: string,
): Promise<{ success: boolean; provider?: string }> {
  for (const p of providers) {
    if (!p.serviceId || !p.templateId || !p.publicKey) continue

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
          template_params: {
            to_email: parentEmail,
            student_name: studentName,
            school_name: 'ACLC Attendance',
            timestamp: new Date().toLocaleString(),
            section,
          },
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

  return { success: false }
}
