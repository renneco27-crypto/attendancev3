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
    // verify_jwt in config.toml ensures a valid JWT is present, but we also
    // need to confirm the caller is a teacher, not just any authenticated user.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // check teacher role via teachers table only.
    // user_metadata.role is NOT checked because any authenticated user can
    // self-set their own metadata via supabase.auth.updateUser() — it is not
    // a trustworthy authorization signal.
    const { data: teacherRecord } = await supabase
      .from('teachers')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!teacherRecord) {
      return new Response(JSON.stringify({ error: 'Forbidden: teachers only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { request_id, approve } = await req.json()

    if (!request_id) {
      return new Response(JSON.stringify({ error: 'request_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // fetch the change request
    const { data: changeRequest, error: fetchError } = await supabase
      .from('device_change_requests')
      .select('*')
      .eq('id', request_id)
      .single()

    if (fetchError || !changeRequest) {
      return new Response(JSON.stringify({ error: 'Device change request not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (changeRequest.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Request already resolved' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (approve === false) {
      // reject — just mark the request as rejected
      const { error: rejectError } = await supabase
        .from('device_change_requests')
        .update({ status: 'rejected', resolved_at: new Date().toISOString() })
        .eq('id', request_id)

      if (rejectError) {
        return new Response(JSON.stringify({ error: rejectError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ status: 'rejected' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // approve: deactivate old device, create new device, mark request approved
    const oldDeviceId = changeRequest.old_device_id

    if (oldDeviceId) {
      const { error: deactivateError } = await supabase
        .from('devices')
        .update({ active: false })
        .eq('id', oldDeviceId)

      if (deactivateError) {
        return new Response(JSON.stringify({ error: deactivateError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // insert new device
    const { data: newDevice, error: insertError } = await supabase
      .from('devices')
      .insert({
        student_id: changeRequest.student_id,
        device_identifier: changeRequest.new_device_identifier,
        active: true,
      })
      .select()
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        return new Response(JSON.stringify({ error: 'Device identifier already registered' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // mark request as approved
    const { error: updateError } = await supabase
      .from('device_change_requests')
      .update({ status: 'approved', resolved_at: new Date().toISOString() })
      .eq('id', request_id)

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ status: 'approved', device: newDevice }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
