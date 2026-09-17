import { NextRequest, NextResponse } from 'next/server'
import { fetchBatchQuotes, fetchFundamentals, hasFundamentalsSignal } from '@/lib/market/finnhub'
import { fetchHistoricalData } from '@/lib/market/history'
import { createCacheClient } from '@/lib/supabase/service-role'
import { mapWithConcurrency } from '@/lib/utils/concurrency'
import { MAX_TICKERS, parseTickerList } from '@/lib/market/validation'
import { requireUser } from '@/lib/auth/require-user'
import { OBS, errMessage, newCorrelationId, obsError, obsInfo, obsWarn, startTimer } from '@/lib/utils/obs'

const CACHE_TTL_MS = 60_000
// Re-fetch fundamentals if they've never been fetched or are older than 24 h
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60_000

/**
 * Hard ceiling on fundamentals refreshed per request, and the pool that runs them.
 *
 * MANDATORY, not an optimisation. `fetchFundamentals` is a `quoteSummary` call per ticker; a cold
 * 475-ticker watchlist previously fired 475 of them in parallel from a single handler. Netlify's
 * synchronous-function ceiling (~10 s) does NOT honour `maxDuration`, so an unbudgeted pool merely
 * converts that burst into a guaranteed timeout.
 *
 * Candidates are ordered by `fundamentals_fetched_at ASC NULLS FIRST`, so each request refreshes
 * the staleest rows and a refreshed row sorts to the back — the whole set warms up over successive
 * polls (the client polls every 5 s) instead of being retried in the same doomed burst.
 */
const FUNDAMENTALS_BUDGET = 12
const FUNDAMENTALS_CONCURRENCY = 4
/** No NEW fundamentals fetch starts after this many ms into the request. */
const FUNDAMENTALS_DEADLINE_MS = 6_000

// Yahoo instrumentType → AssetType (para backfill de assets_metadata).
function instrumentToAssetType(t: string | null | undefined): string {
  switch ((t ?? '').toUpperCase()) {
    case 'ETF': return 'etf'
    case 'MUTUALFUND': return 'fund'
    case 'INDEX': return 'index'
    case 'CRYPTOCURRENCY': return 'crypto'
    default: return 'stock'
  }
}

function rowToQuote(row: Record<string, unknown>) {
  return {
    ticker: row.ticker,
    price: row.price,
    change_percent: row.change_percent,
    volume: row.volume,
    high_52w: row.high_52w,
    low_52w: row.low_52w,
    market_cap: row.market_cap ?? null,
    pe: row.pe ?? null,
    dividend_yield: row.dividend_yield ?? null,
    expense_ratio: row.expense_ratio ?? null,
    aum: row.aum ?? null,
    beta: row.beta ?? null,
    profit_margins: row.profit_margins ?? null,
    nav: row.nav ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    country: row.country ?? null,
    fund_family: row.fund_family ?? null,
    alpha: row.alpha ?? null,
    r_squared: row.r_squared ?? null,
    std_dev: row.std_dev ?? null,
    sharpe: row.sharpe ?? null,
    treynor: row.treynor ?? null,
    sector_weightings: row.sector_weightings ?? null,
    top_holdings: row.top_holdings ?? null,
    inception_date: row.inception_date ?? null,
    price_to_book: row.price_to_book ?? null,
    median_market_cap: row.median_market_cap ?? null,
    morningstar_category: row.morningstar_category ?? null,
    global_category: row.global_category ?? null,
    currency: row.currency ?? null,
    last_updated: row.last_updated,
  }
}

export async function GET(request: NextRequest) {
  const cid = newCorrelationId()
  const elapsed = startTimer()

  // AUTH FIRST — before parsing, before Yahoo, before any cache read/write. `/api` is exempt from
  // the middleware gate, so this is the only thing standing between an anonymous caller and a
  // Yahoo proxy that also writes to `price_cache`. A 401 must cost zero upstream work.
  const auth = await requireUser(request, { endpoint: 'quote', cid })
  if (!auth.ok) return auth.response

  const { searchParams } = request.nextUrl
  const tickersParam = searchParams.get('tickers')

  if (!tickersParam) {
    return NextResponse.json({ error: 'Missing tickers param' }, { status: 400 })
  }

  // ⚠️ `uppercase: false` is LOAD-BEARING, do not "fix" it. The response below is
  // `Object.fromEntries(freshMap)`, keyed by the EXACT string the client sent, and PostgREST's
  // `.in('ticker', …)` is case-sensitive. Normalising to upper case here would make the response
  // keys stop matching the keys the client looks up → prices render blank across the whole app.
  // MAX_TICKERS is shared with /api/market/returns; this endpoint previously had NO cap at all.
  const { tickers, truncated, rejected } = parseTickerList(tickersParam, {
    max: MAX_TICKERS,
    uppercase: false,
  })
  if (truncated) {
    obsWarn({ event: OBS.BUDGET_EXHAUSTED, cid, endpoint: 'quote', count: MAX_TICKERS, reason: 'ticker_list_truncated' })
  }
  if (rejected > 0) {
    obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'quote', count: rejected, reason: 'malformed_tickers' })
  }
  if (tickers.length === 0) {
    return NextResponse.json({})
  }

  const { client: supabaseAdmin, canWrite } = createCacheClient('quote')

  // 1. Check Supabase price_cache
  const { data: cached, error: cacheReadErr } = await supabaseAdmin
    .from('price_cache')
    .select('*')
    .in('ticker', tickers)
  if (cacheReadErr) {
    obsError({ event: OBS.UNHANDLED_ERROR, cid, endpoint: 'quote', reason: `price_cache read: ${cacheReadErr.message}` })
  }

  const now = Date.now()
  const freshMap = new Map<string, object>()
  const staleOrMissing: string[] = []
  /** Fundamentals candidates carrying their staleness, so we can prioritise the oldest. */
  const fundamentalsCandidates: Array<{ ticker: string; fetchedAt: number | null }> = []

  for (const ticker of tickers) {
    const row = cached?.find((c: Record<string, unknown>) => c.ticker === ticker)
    const fundamentalsFetchedAt = row?.fundamentals_fetched_at
      ? new Date(row.fundamentals_fetched_at as string).getTime()
      : null
    const fundamentalsStale = fundamentalsFetchedAt == null
      || now - fundamentalsFetchedAt > FUNDAMENTALS_TTL_MS

    if (row && now - new Date(row.last_updated as string).getTime() < CACHE_TTL_MS) {
      freshMap.set(ticker, rowToQuote(row))
    } else {
      staleOrMissing.push(ticker)
    }
    if (fundamentalsStale) fundamentalsCandidates.push({ ticker, fetchedAt: fundamentalsFetchedAt })
  }

  // Counters. The summary line at the end always carries both numbers; these dedicated events fire
  // only when something actually missed, so a fully-cached 5-second poll stays at ONE log line.
  if (staleOrMissing.length > 0) {
    obsInfo({ event: OBS.CACHE_HIT, cid, endpoint: 'quote', count: tickers.length - staleOrMissing.length })
    obsInfo({ event: OBS.CACHE_MISS, cid, endpoint: 'quote', count: staleOrMissing.length })
  }

  // 2. Batch-fetch stale/missing prices from Yahoo Finance (bounded inside fetchBatchQuotes)
  if (staleOrMissing.length > 0) {
    try {
      const fetched = await fetchBatchQuotes(staleOrMissing)
      const upsertRows: object[] = []

      fetched.forEach((q) => {
        // Preserve cached fundamentals — v8 chart always returns pe/dividend_yield/market_cap as null
        const cachedRow = cached?.find((c: Record<string, unknown>) => c.ticker === q.ticker) as Record<string, unknown> | undefined
        const base = cachedRow ? rowToQuote(cachedRow) : {}
        freshMap.set(q.ticker, {
          ...base,
          ticker: q.ticker,
          price: q.price,
          change_percent: q.change_percent,
          name: q.name ?? null,
          instrument_type: q.instrument_type ?? null,
          volume: q.volume ?? null,
          high_52w: q.high_52w ?? null,
          low_52w: q.low_52w ?? null,
          last_updated: q.last_updated,
        })
        upsertRows.push({
          ticker: q.ticker,
          price: q.price,
          change_percent: q.change_percent,
          volume: q.volume ?? null,
          high_52w: q.high_52w ?? null,
          low_52w: q.low_52w ?? null,
          currency: q.currency ?? null,
          last_updated: q.last_updated,
        })
      })

      if (upsertRows.length > 0) {
        if (!canWrite) {
          obsWarn({ event: OBS.CACHE_WRITE_SKIPPED, cid, endpoint: 'quote', count: upsertRows.length, reason: 'no_service_role' })
        } else {
          // ⚠️ `currency` is part of this row on purpose. If the column is missing from the live
          // schema the whole upsert fails with PGRST204 — the fix is the migration that adds it,
          // NOT dropping the field here. What this PR guarantees is that the failure is VISIBLE.
          const { error: upsertErr } = await supabaseAdmin
            .from('price_cache')
            .upsert(upsertRows, { onConflict: 'ticker' })
          if (upsertErr) {
            obsError({ event: OBS.CACHE_WRITE_ERROR, cid, endpoint: 'quote', count: upsertRows.length, reason: upsertErr.message })
          }
        }
      }

      // Backfill de nombres/tipos en assets_metadata (almacén canónico de nombres). Solo RELLENA
      // huecos (ignoreDuplicates) → nunca pisa nombres curados. Sirve para que los peers de activos
      // STATIC (que no se materializan en watchlist) tengan nombre real en vez del ticker/ISIN.
      const metaRows = [...fetched.values()]
        .filter((q) => q.name && q.name !== q.ticker)
        .map((q) => ({ ticker: q.ticker, name: q.name as string, type: instrumentToAssetType(q.instrument_type) }))
      if (metaRows.length > 0) {
        const { error: metaErr } = await supabaseAdmin
          .from('assets_metadata')
          .upsert(metaRows, { onConflict: 'ticker', ignoreDuplicates: true })
        if (metaErr) {
          obsError({ event: OBS.CACHE_WRITE_ERROR, cid, endpoint: 'quote', reason: `assets_metadata backfill: ${metaErr.message}` })
        }
      }
    } catch (err) {
      obsError({ event: OBS.UNHANDLED_ERROR, cid, endpoint: 'quote', provider: 'yahoo', reason: errMessage(err) })
    }

    // Last-good fallback for anything the batch did not produce — whether Yahoo threw outright,
    // rate-limited a subset, or the bounded pool ran out of room. Serving the cached row (which was
    // already read above, so this costs no extra round trip) is the same policy /api/market/returns
    // applies: once a ticker has a known price, a hiccup degrades it to last-good, never to blank.
    const stillMissing = staleOrMissing.filter((t) => !freshMap.has(t))
    if (stillMissing.length > 0) {
      let recovered = 0
      for (const t of stillMissing) {
        const row = cached?.find((c: Record<string, unknown>) => c.ticker === t)
        if (row) { freshMap.set(t, rowToQuote(row as Record<string, unknown>)); recovered++ }
      }
      obsWarn({
        event: OBS.YAHOO_5XX, cid, endpoint: 'quote', provider: 'yahoo',
        count: stillMissing.length, recovered_from_cache: recovered, reason: 'quotes_missing_after_batch',
      })
    }
  }

  // 3. Fundamentals (market_cap, pe, beta, profit_margins for stocks; expense_ratio, aum,
  //    sector_weightings, top_holdings for ETFs) — oldest first, pooled and budgeted.
  if (fundamentalsCandidates.length > 0) {
    // ASC NULLS FIRST: never-fetched rows first, then the staleest.
    fundamentalsCandidates.sort((a, b) => {
      if (a.fetchedAt === b.fetchedAt) return a.ticker < b.ticker ? -1 : 1
      if (a.fetchedAt == null) return -1
      if (b.fetchedAt == null) return 1
      return a.fetchedAt - b.fetchedAt
    })

    const batch = fundamentalsCandidates.slice(0, FUNDAMENTALS_BUDGET)
    if (fundamentalsCandidates.length > batch.length) {
      obsWarn({
        event: OBS.BUDGET_EXHAUSTED, cid, endpoint: 'quote',
        count: fundamentalsCandidates.length - batch.length, reason: 'fundamentals_deferred_to_next_request',
      })
    }

    const deadline = now + FUNDAMENTALS_DEADLINE_MS
    let refreshed = 0
    let failed = 0

    await mapWithConcurrency(batch, FUNDAMENTALS_CONCURRENCY, async ({ ticker, fetchedAt }) => {
      if (Date.now() >= deadline) return
      try {
        let f = await fetchFundamentals(ticker)
        const signal = hasFundamentalsSignal(f)

        // Inception fallback: derive from the first history point when Yahoo has no inception date.
        // Gated to the FIRST fundamentals fetch for this ticker (`fetchedAt == null`). Before this,
        // every 24 h refresh of every ticker Yahoo has no inception date for fired an extra
        // `range=max` request — a permanent ×2 amplifier on the whole watchlist. Once derived, the
        // value lives in price_cache and is served from there.
        if (signal && f.inception_date == null && fetchedAt == null && Date.now() < deadline) {
          try {
            const history = await fetchHistoricalData(ticker, 'MAX', { cid, maxAttempts: 1 })
            if (history.length > 0) f = { ...f, inception_date: history[0].date }
          } catch { /* ignore */ }
        }

        if (signal) {
          refreshed++
          // Merge into freshMap so the response carries the latest values.
          const existing = freshMap.get(ticker) as Record<string, unknown> | undefined
          if (existing) freshMap.set(ticker, { ...existing, ...f })
        } else {
          // `fetchFundamentals` swallows its own errors and returns EMPTY_FUNDAMENTALS, which is
          // indistinguishable from "Yahoo has nothing". Writing it would blank
          // morningstar_category / sector_weightings / aum for 24 h — exactly the columns
          // /api/peers/init needs. So: do NOT merge it into the response (keep the cached values)
          // and do NOT write data columns.
          failed++
          obsWarn({ event: OBS.FUNDAMENTALS_FAILURE, cid, endpoint: 'quote', ticker, reason: 'no_signal' })
        }

        if (!canWrite) {
          obsWarn({ event: OBS.CACHE_WRITE_SKIPPED, cid, endpoint: 'quote', ticker, reason: 'no_service_role' })
          return
        }

        // `fundamentals_fetched_at` always advances, signal or not, so a ticker Yahoo has nothing
        // for rotates to the back of the queue instead of being retried on every single request.
        const row = signal
          ? { ticker, ...f, fundamentals_fetched_at: new Date().toISOString() }
          : { ticker, fundamentals_fetched_at: new Date().toISOString() }

        const { error: fundamentalsErr } = await supabaseAdmin
          .from('price_cache')
          .upsert(row, { onConflict: 'ticker' })
        if (fundamentalsErr) {
          obsError({ event: OBS.CACHE_WRITE_ERROR, cid, endpoint: 'quote', ticker, reason: fundamentalsErr.message })
        }
      } catch (err) {
        failed++
        obsError({ event: OBS.FUNDAMENTALS_FAILURE, cid, endpoint: 'quote', ticker, reason: errMessage(err) })
      }
    })

    obsInfo({ event: OBS.FUNDAMENTALS_REFRESH, cid, endpoint: 'quote', count: refreshed, failed, budget: FUNDAMENTALS_BUDGET })
  }

  obsInfo({
    event: OBS.MARKET_API_REQUEST,
    cid,
    endpoint: 'quote',
    status: 200,
    latency_ms: elapsed(),
    count: tickers.length,
    cache_hit: tickers.length - staleOrMissing.length,
    cache_miss: staleOrMissing.length,
  })

  return NextResponse.json(Object.fromEntries(freshMap))
}
