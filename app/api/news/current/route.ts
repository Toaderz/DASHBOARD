import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Try to find a currently valid brief
  const { data: current } = await supabase
    .from('market_briefs')
    .select('*, market_news(*)')
    .eq('status', 'ready')
    .gt('valid_until', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (current) {
    return NextResponse.json({ data: current, stale: false })
  }

  // Stale fallback: serve last available brief
  const { data: stale } = await supabase
    .from('market_briefs')
    .select('*, market_news(*)')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ data: stale ?? null, stale: true })
}
