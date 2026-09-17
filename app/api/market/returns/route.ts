import { NextRequest, NextResponse } from 'next/server'
import { calculateMultiReturns, type MultiReturns } from '@/lib/market/history'
import { createCacheClient } from '@/lib/supabase/service-role'
import { mapWithConcurrency } from '@/lib/utils/concurrency'
import { MAX_TICKERS, parseTickerList } from '@/lib/market/validation'
import { OBS, newCorrelationId, obsInfo, obsError, obsWarn, startTimer } from '@/lib/utils/obs'

// The full Beating-Peers union (several hundred tickers) can need many cold Yahoo fetches on a
// cache miss; allow headroom over Vercel's default so a partial-cold load completes instead of
// timing out and blanking every peer. Cached loads still return in ~3s.
export const maxDuration = 60

// Returns change daily; 6 h keeps it fresh enough while sparing Yahoo requests.
const RETURNS_TTL_MS = 6 * 60 * 60_000
// Cap concurrent Yahoo fetches to avoid rate limiting on cold loads.
const FETCH_CONCURRENCY = 8
// MAX_TICKERS (1500) and the ticker grammar now live in lib/market/validation.ts — one definition
// shared with /api/market/quote. The cap is purely an abuse guard: Beating-Peers legitimately sends
// the full union (assets ∪ all peers), ~475 for a real portfolio, and an older 400 cap silently
// TRUNCATED it so any peer past position 400 rendered "— sin dato" forever. Truncation is logged.

export async function POST(request: NextRequest) {
  const cid = newCorrelationId()
  const elapsed = startTimer()

  let body: { tickers?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ⚠️ `uppercase: false` is LOAD-BEARING, do not "fix" it. The response is keyed by the exact
  // string the client sent and PostgREST's `.in('ticker', …)` is case-sensitive; upper-casing here
  // would make the response keys stop matching what the client looks up → blank returns app-wide.
  const { tickers, truncated, rejected } = parseTickerList(body.tickers, {
    max: MAX_TICKERS,
    uppercase: false,
  })
  if (truncated) {
    obsWarn({ event: OBS.BUDGET_EXHAUSTED, cid, endpoint: 'returns', count: MAX_TICKERS, reason: 'ticker_union_truncated' })
  }
  if (rejected > 0) {
    obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'returns', count: rejected, reason: 'malformed_tickers' })
  }

  if (tickers.length === 0) {
    return NextResponse.json({})
  }

  const { client: supabaseAdmin, canWrite } = createCacheClient('returns')
  const now = Date.now()
  const out: Record<string, MultiReturns> = {}
  const staleOrMissing: string[] = []

  // 1. Read cache
  const { data: cached, error: cacheReadErr } = await supabaseAdmin
    .from('returns_cache')
    .select('ticker, returns, years, fetched_at')
    .in('ticker', tickers)
  if (cacheReadErr) {
    obsError({ event: OBS.UNHANDLED_ERROR, cid, endpoint: 'returns', reason: `returns_cache read: ${cacheReadErr.message}` })
  }

  const cacheByTicker = new Map<string, { returns: MultiReturns['returns']; years: MultiReturns['years']; fetched_at: string }>()
  for (const row of (cached ?? []) as Array<{ ticker: string; returns: MultiReturns['returns']; years: MultiReturns['years']; fetched_at: string }>) {
    cacheByTicker.set(row.ticker, row)
  }

  // A healthy full series always produces the 1Y anchor; a null 1Y means the cached bundle was
  // written from a degraded fetch (legacy poisoned row). Treat those as stale so they self-heal
  // instead of serving "— sin dato" for up to 6h.
  const isHealthy = (r: MultiReturns['returns'] | null | undefined): boolean =>
    !!r && r['1Y'] != null

  for (const ticker of tickers) {
    const row = cacheByTicker.get(ticker)
    if (row && isHealthy(row.returns) && now - new Date(row.fetched_at).getTime() < RETURNS_TTL_MS) {
      out[ticker] = { returns: row.returns, years: row.years }
    } else {
      staleOrMissing.push(ticker)
    }
  }

  // Dedicated counter events only when something missed; the summary line below always has both.
  if (staleOrMissing.length > 0) {
    obsInfo({ event: OBS.CACHE_HIT, cid, endpoint: 'returns', count: tickers.length - staleOrMissing.length })
    obsInfo({ event: OBS.CACHE_MISS, cid, endpoint: 'returns', count: staleOrMissing.length })
  }

  // 2. Fetch stale/missing from Yahoo (bounded concurrency), upsert into cache
  if (staleOrMissing.length > 0) {
    const fetched = await mapWithConcurrency(staleOrMissing, FETCH_CONCURRENCY, async (ticker) => {
      const data = await calculateMultiReturns(ticker, { cid })
      return { ticker, data }
    })

    // Stale-fallback: a fresh fetch that comes back unhealthy (transient Yahoo failure) must NOT
    // blank a ticker that was previously good. If a healthy cached row exists (even past its TTL),
    // serve that last-good value instead of nulls. Only a ticker with NO prior good data shows the
    // degraded result. This is what makes the peer section as resilient as the watchlist: once a
    // ticker has been fetched successfully, a later hiccup degrades to last-good, never to "sin dato".
    for (const { ticker, data } of fetched) {
      if (isHealthy(data.returns)) {
        out[ticker] = data
      } else {
        const stale = cacheByTicker.get(ticker)
        out[ticker] = stale && isHealthy(stale.returns)
          ? { returns: stale.returns, years: stale.years }
          : data
      }
    }

    // Only cache healthy bundles (1Y anchor present). A degraded/all-null result (total Yahoo
    // outage) is still returned to the client but NOT cached, so the next request retries instead
    // of pinning stale nulls for 6h.
    const upsertRows = fetched
      .filter(({ data }) => isHealthy(data.returns))
      .map(({ ticker, data }) => ({
        ticker,
        returns: data.returns,
        years: data.years,
        fetched_at: new Date(now).toISOString(),
      }))

    // Best-effort cache write; failure must not break the response — but it MUST be visible.
    // The old `try/catch` here caught nothing: supabase-js RESOLVES with `{ error }`, it does not
    // throw, so every RLS rejection and every PGRST error was swallowed in complete silence.
    if (upsertRows.length > 0) {
      if (!canWrite) {
        obsWarn({ event: OBS.CACHE_WRITE_SKIPPED, cid, endpoint: 'returns', count: upsertRows.length, reason: 'no_service_role' })
      } else {
        const { error: upsertErr } = await supabaseAdmin
          .from('returns_cache')
          .upsert(upsertRows, { onConflict: 'ticker' })
        if (upsertErr) {
          obsError({ event: OBS.CACHE_WRITE_ERROR, cid, endpoint: 'returns', count: upsertRows.length, reason: upsertErr.message })
        }
      }
    }
  }

  obsInfo({
    event: OBS.MARKET_API_REQUEST,
    cid,
    endpoint: 'returns',
    status: 200,
    latency_ms: elapsed(),
    count: tickers.length,
    cache_hit: tickers.length - staleOrMissing.length,
    cache_miss: staleOrMissing.length,
  })

  return NextResponse.json(out)
}
