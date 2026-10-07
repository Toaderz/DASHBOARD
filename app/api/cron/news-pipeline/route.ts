import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { runNewsPipeline } from '@/lib/ai/news-pipeline'
import { getAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Comparación en tiempo constante: se comparan los hashes (misma longitud siempre).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Disparo del brief vía HTTP (uso manual / local con scripts/refresh-news.mjs).
// El cron automático corre en GitHub Actions (scripts/run-news-pipeline.ts), que invoca
// runNewsPipeline() directamente sin el límite de 60s del plan Hobby.
// GET y POST comparten el mismo handler: refresh-news.mjs usa POST; GET evita un 405
// si algo (p.ej. un cron HTTP) lo invoca con GET.
async function handler(req: Request) {
  // Falla cerrado: sin secreto configurado NADIE entra (antes "Bearer undefined" pasaba).
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[news-cron] CRON_SECRET no está configurado: ruta deshabilitada')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  if (!safeEqual(req.headers.get('Authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runNewsPipeline(getAdminClient())
    if ('skipped' in result) {
      return NextResponse.json(result)
    }
    return NextResponse.json({ success: true, briefId: result.briefId })
  } catch (error) {
    // El detalle va al log del servidor; la respuesta no filtra texto de proveedores.
    console.error('[news-cron] pipeline failed:', error)
    return NextResponse.json({ error: 'Pipeline failed' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
