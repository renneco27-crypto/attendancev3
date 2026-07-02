import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '')
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        'Missing Supabase credentials.\n\n' +
        '1. Go to supabase.com → Project Settings → API\n' +
        '2. Copy Project URL and anon public key\n' +
        '3. Paste them into web-app/.env:\n\n' +
        '   VITE_SUPABASE_URL=https://your-project.supabase.co\n' +
        '   VITE_SUPABASE_ANON_KEY=eyJ...\n\n' +
        '4. Restart the dev server'
      )
    }
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  }
  return client
}

export function supabase(): SupabaseClient {
  return getClient()
}

export function resetSupabaseClient(): void {
  client = null
}
