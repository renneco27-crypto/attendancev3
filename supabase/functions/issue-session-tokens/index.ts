import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

interface TokenResponse {
  tokens: {
    session_id: string
    sequence_index: number
    token: string
    issued_at: string
  }[]
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
    const { session_id } = await req.json()

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: session } = await supabase
      .from('sessions')
      .select('id, ended_at')
      .eq('id', session_id)
      .single()

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (session.ended_at) {
      return new Response(JSON.stringify({ error: 'Session has ended' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: maxResult } = await supabase
      .from('session_tokens')
      .select('sequence_index')
      .eq('session_id', session_id)
      .order('sequence_index', { ascending: false })
      .limit(1)

    const nextIndex = maxResult && maxResult.length > 0 ? maxResult[0].sequence_index + 1 : 0
    const now = Date.now()
    const tokens = []

    for (let i = 0; i < 4; i++) {
      const issuedAt = new Date(now + i * 500)
      tokens.push({
        session_id,
        sequence_index: nextIndex + i,
        token: crypto.randomUUID(),
        issued_at: issuedAt.toISOString(),
      })
    }

    const { error: insertError } = await supabase
      .from('session_tokens')
      .insert(tokens)

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: existing } = await supabase
          .from('session_tokens')
          .select('session_id, sequence_index, token, issued_at')
          .eq('session_id', session_id)
          .gte('sequence_index', nextIndex)
          .order('sequence_index', { ascending: true })
          .limit(4)

        return new Response(JSON.stringify({ tokens: existing ?? [] }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const response: TokenResponse = { tokens }

    return new Response(JSON.stringify(response), {
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
