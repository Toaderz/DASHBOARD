import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runNewsPipeline } from '@/lib/ai/news-pipeline'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Disparo del brief vía HTTP (uso manual / local con scripts/refresh-news.mjs).
// El cron automático ahora corre en GitHub Actions (scripts/run-news-pipeline.ts),
// que invoca runNewsPipeline() directamente sin el límite de 60s del plan Hobby.
// GET y POST comparten el mismo handler: refresh-news.mjs usa POST; GET evita un 405
// si algo (p.ej. un cron HTTP) lo invoca con GET.
async function handler(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runNewsPipeline(getAdminClient())
    if ('skipped' in result) {
      return NextResponse.json(result)
    }
    return NextResponse.json({ success: true, briefId: result.briefId })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
