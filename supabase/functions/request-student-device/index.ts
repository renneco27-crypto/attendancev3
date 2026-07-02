import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { student_name, device_identifier, pin } = await req.json()

    if (!student_name || !device_identifier || !pin || pin.length !== 4) {
      return new Response(JSON.stringify({ success: false, reason: 'MISSING_FIELDS' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
      return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR', message: 'Server misconfigured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: existing } = await supabase
      .from('device_registrations')
      .select('id, status')
      .ilike('student_name', student_name.trim())
      .limit(1)

    if (existing && existing.length > 0) {
      const row = existing[0]
      if (row.status === 'approved') {
        return new Response(JSON.stringify({
          success: false, reason: 'ALREADY_APPROVED',
          message: 'This name already has an approved device.',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      if (row.status === 'pending') {
        const { error: upErr } = await supabase
          .from('device_registrations')
          .update({ device_identifier, pin })
          .eq('id', row.id)
        if (upErr) {
          console.error('Update error:', upErr)
          return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR', message: 'Failed to register device' }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({
          success: true, reason: null, message: 'Device registered! Ask your teacher to approve it.',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        success: false, reason: 'REVOKED', message: 'This registration was revoked. Ask your teacher to add you again.',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: teachers } = await supabase
      .from('teachers')
      .select('auth_user_id')
      .limit(1)

    if (!teachers || teachers.length === 0) {
      console.error('No teachers found')
      return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR', message: 'No teacher configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: insErr } = await supabase
      .from('device_registrations')
      .insert({
        student_name: student_name.trim(),
        device_identifier,
        pin,
        teacher_id: teachers[0].auth_user_id,
        status: 'pending',
      })

    if (insErr) {
      console.error('Insert error:', insErr)
      return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR', message: 'Failed to register device' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      success: true, reason: null, message: 'Device registered! Ask your teacher to approve it.',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('request-student-device error:', err)
    return new Response(JSON.stringify({ success: false, reason: 'SERVER_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
