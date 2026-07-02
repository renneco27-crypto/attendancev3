import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Tunable after real-device testing. ±300ms suggested initial value.
const TIMESTAMP_TOLERANCE_MS = 300

interface CapturedToken {
  token: string
  sequence_index: number
  capture_timestamp: number
}

interface AttendancePayload {
  student_device_id: string
  biometric_pass: boolean
  captured_sequence: CapturedToken[]
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: AttendancePayload = await req.json()

    // 6a. biometric_pass sanity check
    if (!payload.biometric_pass) {
      return new Response(JSON.stringify({ success: false, reason: 'BIOMETRIC_FAILED' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 6b. device lookup
    const { data: device, error: deviceError } = await supabase
      .from('devices')
      .select('id, student_id, active')
      .eq('device_identifier', payload.student_device_id)
      .single()

    if (deviceError || !device) {
      return new Response(JSON.stringify({ success: false, reason: 'DEVICE_NOT_FOUND' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!device.active) {
      return new Response(JSON.stringify({ success: false, reason: 'DEVICE_INACTIVE' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // validate captured_sequence
    const seq = payload.captured_sequence
    if (!seq || seq.length < 2) {
      return new Response(JSON.stringify({ success: false, reason: 'INSUFFICIENT_TOKENS' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6c. look up all tokens by their value
    const tokenValues = seq.map(s => s.token)
    const { data: tokenRecords } = await supabase
      .from('session_tokens')
      .select('*')
      .in('token', tokenValues)

    if (!tokenRecords || tokenRecords.length !== tokenValues.length) {
      return new Response(JSON.stringify({ success: false, reason: 'INVALID_TOKENS' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // all tokens must belong to the same session
    const sessionIds = [...new Set(tokenRecords.map(t => t.session_id))]
    if (sessionIds.length !== 1) {
      return new Response(JSON.stringify({ success: false, reason: 'INVALID_TOKENS' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const sessionId = sessionIds[0]

    const tokenMap = new Map(tokenRecords.map(t => [t.token, t]))
    let prevIndex = -1

    // 6d/6e. validate order and timing
    for (const entry of seq) {
      const record = tokenMap.get(entry.token)
      if (!record) {
        return new Response(JSON.stringify({ success: false, reason: 'INVALID_TOKENS' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // 6d. strictly increasing sequence_index
      if (record.sequence_index <= prevIndex) {
        return new Response(JSON.stringify({ success: false, reason: 'SEQUENCE_ERROR' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      prevIndex = record.sequence_index

      // 6e. timing tolerance
      const captureTime = new Date(entry.capture_timestamp).getTime()
      const issuedTime = new Date(record.issued_at).getTime()
      const drift = Math.abs(captureTime - issuedTime)

      if (drift > TIMESTAMP_TOLERANCE_MS) {
        return new Response(JSON.stringify({ success: false, reason: 'TIMING_DRIFT' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 6f. duplicate check — last, per spec ordering
    const { data: existingAttendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('session_id', sessionId)
      .eq('student_id', device.student_id)
      .maybeSingle()

    if (existingAttendance) {
      return new Response(JSON.stringify({ success: false, reason: 'ALREADY_CHECKED_IN' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // all checks pass — insert attendance
    const { error: insertError } = await supabase
      .from('attendance')
      .insert({
        session_id: sessionId,
        student_id: device.student_id,
        device_id: device.id,
        checked_in_at: new Date().toISOString(),
      })

    if (insertError) {
      if (insertError.code === '23505') {
        return new Response(JSON.stringify({ success: false, reason: 'ALREADY_CHECKED_IN' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, reason: null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
