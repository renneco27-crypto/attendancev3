import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
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
    const { student_id, old_device_id, new_device_identifier } = await req.json()

    if (!student_id || !new_device_identifier) {
      return new Response(JSON.stringify({ error: 'student_id and new_device_identifier are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // verify student exists
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('id', student_id)
      .single()

    if (!student) {
      return new Response(JSON.stringify({ error: 'Student not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // check for existing pending request for this student
    const { data: existing } = await supabase
      .from('device_change_requests')
      .select('id')
      .eq('student_id', student_id)
      .eq('status', 'pending')
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ error: 'A pending device change request already exists' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data, error } = await supabase
      .from('device_change_requests')
      .insert({
        student_id,
        old_device_id: old_device_id || null,
        new_device_identifier,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ request: data }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
