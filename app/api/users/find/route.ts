import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { OBS, errMessage, newCorrelationId, obsError } from '@/lib/utils/obs'

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  // Constructed INSIDE the handler (CLAUDE.md) and fail-closed: without a real service-role key
  // this throws instead of quietly running as anon and reporting "user not found" for everyone.
  const cid = newCorrelationId()
  let admin
  try {
    admin = createServiceRoleClient()
  } catch (err) {
    obsError({ event: OBS.CONFIG_ERROR, cid, endpoint: 'users/find', reason: errMessage(err) })
    return NextResponse.json({ error: 'Servicio no disponible' }, { status: 503 })
  }

  const { data, error } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    obsError({ event: OBS.UNHANDLED_ERROR, cid, endpoint: 'users/find', reason: error.message })
    return NextResponse.json({ error: 'Servicio no disponible' }, { status: 503 })
  }
  if (!data) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  if (data.id === user.id) return NextResponse.json({ error: 'No puedes compartir contigo mismo' }, { status: 400 })

  return NextResponse.json({ id: data.id, email: data.email })
}
