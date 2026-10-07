import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/api/rate-limit'

type Guard = { userId: string } | { response: NextResponse }

/**
 * Exige sesión de Supabase y aplica un límite por usuario y ruta. `proxy.ts` deja pasar /api/*,
 * así que cada ruta debe llamar a esto ANTES de tocar Supabase de servicio o proveedores.
 */
export async function guardApi(route: string, limitPerMin: number): Promise<Guard> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const userId = data?.user?.id
  if (!userId) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const rl = rateLimit(`${userId}:${route}`, limitPerMin, 60_000)
  if (!rl.ok) {
    return {
      response: NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      ),
    }
  }
  return { userId }
}
