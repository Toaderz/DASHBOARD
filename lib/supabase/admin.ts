import { createClient } from '@supabase/supabase-js'

/** Cliente con la clave de servicio. Falla cerrado: nunca cae a la clave anon. Llamar DENTRO del handler. */
export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase admin client is not configured')
  return createClient(url, key)
}
