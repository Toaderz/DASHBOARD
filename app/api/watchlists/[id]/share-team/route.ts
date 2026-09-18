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
 *  1. **Chequeo explícito de propiedad Y de pertenencia al equipo.** Se usa el
 *     service role, que salta RLS. Sin comprobar `watchlists.user_id === user.id`
 *     a mano, cualquier usuario autenticado podría compartir la watchlist de otro
 *     con todo el equipo. Y sin comprobar `is_team_evolve` del LLAMANTE, esta ruta
 *     era auto-otorgable: un usuario de fuera pulsaba el botón sobre su propia
 *     watchlist, el insert le convertía en contraparte de share de todos los
 *     miembros y `share_counterpart_read_profiles` (004) le abría el roster —
 *     justo la enumeración que 004 cierra. Hallazgo del pase de security-review.
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

  // 2. Pertenencia del LLAMANTE al equipo. Compartir con Team Evolve es una
  //    operación DE miembro del equipo: no basta con ser dueño de una watchlist.
  //    Sin esto la ruta se auto-otorga acceso — el insert convierte al llamante en
  //    contraparte de share de todos los miembros y, vía la política
  //    `share_counterpart_read_profiles` de 004, le deja leer sus perfiles
  //    (emails incluidos). Se responde el MISMO 404 que arriba: un 403 confirmaría
  //    que el equipo existe y que el llamante no está en él.
  const { data: me, error: meError } = await admin
    .from('profiles')
    .select('is_team_evolve')
    .eq('id', user.id)
    .maybeSingle()

  if (meError) {
    console.error('[share-team] caller profile lookup error:', meError)
    return NextResponse.json({ error: 'Error al compartir' }, { status: 500 })
  }

  // Falla CERRADO: sin perfil o sin el flag no se toca el roster.
  if (!me?.is_team_evolve) {
    return NextResponse.json({ error: 'Watchlist no encontrada' }, { status: 404 })
  }

  // 3. Roster del equipo. Se resuelve y se consume aquí dentro; nunca sale.
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

  // 4. Insert idempotente. `ignoreDuplicates` → INSERT ... ON CONFLICT DO NOTHING,
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
