import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

/**
 * POST /api/watchlists/[id]/share-team
 *
 * Comparte una watchlist con todos los miembros de Team Evolve.
 *
 * Sustituye a `addTeamShares` del cliente, que enumeraba el roster con
 * `profiles.select('id').eq('is_team_evolve', true)`. Esa lectura es
 * exactamente la que cierra `004_narrow_profiles.sql`: el roster del equipo no
 * es una contraparte de share del usuario, así que deja de ser legible desde el
 * navegador. Aquí el write entero ocurre en servidor y **solo sale un conteo**.
 *
 * Tres propiedades que el cliente no podía dar:
 *
 *  1. **Chequeo explícito de propiedad.** Se usa el service role, que salta RLS.
 *     Sin comprobar `watchlists.user_id === user.id` a mano, cualquier usuario
 *     autenticado podría compartir la watchlist de otro con todo el equipo.
 *  2. **404 en vez de 403** cuando la watchlist no existe o no es tuya. Un 403
 *     confirmaría que ese id existe y es de alguien; el 404 no distingue los
 *     dos casos, así que no filtra existencia.
 *  3. **Idempotencia** vía `on conflict do nothing`. De paso elimina una race
 *     real del cliente, que leía los shares existentes y luego insertaba: dos
 *     pulsaciones seguidas podían chocar contra `watchlist_shares_unique`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // `id` entra en una consulta por igualdad, no en SQL crudo, pero validar la
  // forma evita un round-trip y un 500 de Postgres (22P02) por un uuid inválido.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Watchlist no encontrada' }, { status: 404 })
  }

  const admin = createServiceRoleClient()

  // 1. Propiedad. El service role salta RLS, así que este chequeo es el control
  //    de acceso — no un detalle de eficiencia.
  const { data: watchlist, error: wlError } = await admin
    .from('watchlists')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle()

  if (wlError) {
    console.error('[share-team] watchlist lookup error:', wlError)
    return NextResponse.json({ error: 'Error al compartir' }, { status: 500 })
  }

  // No existe o no es tuya → la MISMA respuesta. No se filtra existencia.
  if (!watchlist || watchlist.user_id !== user.id) {
    return NextResponse.json({ error: 'Watchlist no encontrada' }, { status: 404 })
  }

  // 2. Roster del equipo. Se resuelve y se consume aquí dentro; nunca sale.
  const { data: teamMembers, error: teamError } = await admin
    .from('profiles')
    .select('id')
    .eq('is_team_evolve', true)
    .neq('id', user.id)

  if (teamError) {
    console.error('[share-team] team lookup error:', teamError)
    return NextResponse.json({ error: 'Error al compartir' }, { status: 500 })
  }

  if (!teamMembers?.length) {
    return NextResponse.json({ count: 0 })
  }

  // 3. Insert idempotente. `ignoreDuplicates` → INSERT ... ON CONFLICT DO NOTHING,
  //    y el `.select()` devuelve SOLO las filas realmente insertadas, que es
  //    justo el conteo que la UI necesita ("Compartida con N miembros").
  const { data: inserted, error: insertError } = await admin
    .from('watchlist_shares')
    .upsert(
      teamMembers.map((m) => ({ watchlist_id: id, shared_with_user_id: m.id })),
      { onConflict: 'watchlist_id,shared_with_user_id', ignoreDuplicates: true }
    )
    .select('id')

  if (insertError) {
    console.error('[share-team] insert error:', insertError)
    return NextResponse.json({ error: 'Error al compartir' }, { status: 500 })
  }

  // Solo el conteo. Ni ids, ni emails, ni tamaño del equipo cuando no hubo altas.
  return NextResponse.json({ count: inserted?.length ?? 0 })
}
