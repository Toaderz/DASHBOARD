import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { calculateMultiReturns, type MultiReturns } from '@/lib/market/history'

// Returns change daily; 6 h keeps it fresh enough while sparing Yahoo requests.
const RETURNS_TTL_MS = 6 * 60 * 60_000
// Cap concurrent Yahoo fetches to avoid rate limiting on cold loads.
const FETCH_CONCURRENCY = 8

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function POST(request: NextRequest) {
  let body: { tickers?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = Array.isArray(body.tickers) ? body.tickers : []
  // Dedup + normalize; cap to a sane upper bound to protect the endpoint.
  const tickers = [...new Set(raw.filter((t): t is string => typeof t === 'string' && t.length > 0))].slice(0, 400)

  if (tickers.length === 0) {
    return NextResponse.json({})
  }

  const supabaseAdmin = getAdminClient()
  const now = Date.now()
  const out: Record<string, MultiReturns> = {}
  const staleOrMissing: string[] = []

  // 1. Read cache
  const { data: cached } = await supabaseAdmin
    .from('returns_cache')
    .select('ticker, returns, years, fetched_at')
    .in('ticker', tickers)

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

  // 2. Fetch stale/missing from Yahoo (bounded concurrency), upsert into cache
  if (staleOrMissing.length > 0) {
    const fetched = await mapWithConcurrency(staleOrMissing, FETCH_CONCURRENCY, async (ticker) => {
      const data = await calculateMultiReturns(ticker)
      return { ticker, data }
    })

    for (const { ticker, data } of fetched) out[ticker] = data

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

    // Best-effort cache write; failure must not break the response.
    if (upsertRows.length > 0) {
      try {
        await supabaseAdmin.from('returns_cache').upsert(upsertRows, { onConflict: 'ticker' })
      } catch {
        /* ignore cache write errors */
      }
    }
  }

  return NextResponse.json(out)
}
