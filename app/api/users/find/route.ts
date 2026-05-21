import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim()
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const admin = getAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle()

  if (!data) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  if (data.id === user.id) return NextResponse.json({ error: 'No puedes compartir contigo mismo' }, { status: 400 })

  return NextResponse.json({ id: data.id, email: data.email })
}
