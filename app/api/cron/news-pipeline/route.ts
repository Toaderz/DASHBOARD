import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { runNewsPipeline } from '@/lib/ai/news-pipeline'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { OBS, errMessage, newCorrelationId, obsError, obsInfo, obsWarn } from '@/lib/utils/obs'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Constant-time bearer comparison.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak length AND turn a wrong
 * token into a 500. Hashing both sides to a fixed 32 bytes first removes the length problem
 * entirely and keeps the comparison constant-time.
 */
function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

// Disparo del brief vía HTTP (uso manual / local con scripts/refresh-news.mjs).
// El cron automático ahora corre en GitHub Actions (scripts/run-news-pipeline.ts),
// que invoca runNewsPipeline() directamente sin el límite de 60s del plan Hobby.
// GET y POST comparten el mismo handler: refresh-news.mjs usa POST; GET evita un 405
// si algo (p.ej. un cron HTTP) lo invoca con GET.
async function handler(req: Request) {
  const cid = newCorrelationId()

  // FAIL CLOSED. The previous check compared against the template literal `Bearer ${CRON_SECRET}`
  // without asserting the secret exists, so with CRON_SECRET unset the literal string
  // "Bearer undefined" authenticated — an unauthenticated trigger for the whole pipeline.
  // A missing secret is a deployment fault, not an auth failure: 500, never 200 and never 401.
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length === 0) {
    obsError({ event: OBS.CONFIG_ERROR, cid, endpoint: 'cron/news-pipeline', reason: 'CRON_SECRET not set' })
    return NextResponse.json({ error: 'Server misconfigured', cid }, { status: 500 })
  }

  if (!bearerMatches(req.headers.get('Authorization'), secret)) {
    obsWarn({ event: OBS.AUTH_FAILURE, cid, endpoint: 'cron/news-pipeline', status: 401 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runNewsPipeline(createServiceRoleClient())
    if ('skipped' in result) {
      obsInfo({ event: OBS.MARKET_API_REQUEST, cid, endpoint: 'cron/news-pipeline', status: 'skipped' })
      return NextResponse.json(result)
    }
    obsInfo({ event: OBS.MARKET_API_REQUEST, cid, endpoint: 'cron/news-pipeline', status: 'ok' })
    return NextResponse.json({ success: true, briefId: result.briefId })
  } catch (error) {
    // The real cause goes to the logs (joined by `cid`); the client gets a generic message.
    // `String(error)` used to be returned verbatim, leaking stack/driver/config detail.
    obsError({ event: OBS.UNHANDLED_ERROR, cid, endpoint: 'cron/news-pipeline', reason: errMessage(error) })
    return NextResponse.json({ error: 'Pipeline failed', cid }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
