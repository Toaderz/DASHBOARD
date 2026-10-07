import { NextRequest, NextResponse, after } from 'next/server'
import { fetchBatchQuotes, fetchFundamentals } from '@/lib/market/finnhub'
import { fetchHistoricalData } from '@/lib/market/history'
import { parseTickerList } from '@/lib/market/validation'
import { guardApi } from '@/lib/api/guard'
import { getAdminClient } from '@/lib/supabase/admin'
import { mapWithConcurrency } from '@/lib/utils/concurrency'

const CACHE_TTL_MS = 60_000
// Re-fetch fundamentals if they've never been fetched or are older than 24 h
const FUNDAMENTALS_TTL_MS = 24 * 60 * 60_000
// Beating-Peers consulta la unión activos ∪ peers (~475 observados); por encima del tope se rechaza (400).
const MAX_TICKERS = 1000
const FUNDAMENTALS_CONCURRENCY = 8
// Hasta este número de tickers con fundamentals vencidos se esperan en la respuesta; por encima, en segundo plano.
const INLINE_FUNDAMENTALS_MAX = 10
// Tickers con fundamentals en curso en esta instancia → instante de inicio. Evita repetir el trabajo en cada
// sondeo de 5 s. Caduca a los 2 min por si la plataforma corta la tarea en segundo plano antes de terminar.
const fundamentalsInFlight = new Map<string, number>()
const IN_FLIGHT_TTL_MS = 2 * 60_000
// useRealtimePrices sondea cada 5 s desde varios componentes: barrera de contención, no control fino.
const LIMIT_PER_MIN = 600

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
  const guard = await guardApi('quote', LIMIT_PER_MIN)
  if ('response' in guard) return guard.response

  const { searchParams } = request.nextUrl
  const tickersParam = searchParams.get('tickers')

  if (!tickersParam) {
    return NextResponse.json({ error: 'Missing tickers param' }, { status: 400 })
  }

  const parsed = parseTickerList(tickersParam, MAX_TICKERS)
  if (parsed.tooMany) {
    return NextResponse.json({ error: `Too many tickers (max ${MAX_TICKERS})` }, { status: 400 })
  }
  if (parsed.tickers.length === 0) {
    return NextResponse.json({ error: 'No valid tickers' }, { status: 400 })
  }
  const tickers = parsed.tickers

  let supabaseAdmin: ReturnType<typeof getAdminClient>
  try {
    supabaseAdmin = getAdminClient()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // 1. Check Supabase price_cache
  const { data: cached } = await supabaseAdmin
    .from('price_cache')
    .select('*')
    .in('ticker', tickers)

  const now = Date.now()
  const freshMap = new Map<string, object>()
  const staleOrMissing: string[] = []
  const needsFundamentals: string[] = []

  for (const ticker of tickers) {
    const row = cached?.find((c: Record<string, unknown>) => c.ticker === ticker)
    const fundamentalsFetchedAt = row?.fundamentals_fetched_at
      ? new Date(row.fundamentals_fetched_at as string).getTime()
      : null
    const fundamentalsStale = fundamentalsFetchedAt == null
      || now - fundamentalsFetchedAt > FUNDAMENTALS_TTL_MS

    if (row && now - new Date(row.last_updated as string).getTime() < CACHE_TTL_MS) {
      freshMap.set(ticker, rowToQuote(row))
      if (fundamentalsStale) needsFundamentals.push(ticker)
    } else {
      staleOrMissing.push(ticker)
      if (fundamentalsStale) needsFundamentals.push(ticker)
    }
  }

  // 2. Batch-fetch stale/missing prices from Yahoo Finance
  if (staleOrMissing.length > 0) {
    let yahooFailed = false
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
        const { error: upsertErr } = await supabaseAdmin
          .from('price_cache')
          .upsert(upsertRows, { onConflict: 'ticker' })
        if (upsertErr) console.error('[quote] Supabase upsert error:', upsertErr.message)
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
        if (metaErr) console.error('[quote] assets_metadata backfill error:', metaErr.message)
      }
    } catch (err) {
      console.error('[quote] Yahoo Finance fetch failed:', err instanceof Error ? err.message : err)
      yahooFailed = true
    }

    if (yahooFailed) {
      const { data: staleRows } = await supabaseAdmin
        .from('price_cache')
        .select('*')
        .in('ticker', staleOrMissing)
      for (const row of (staleRows ?? []) as Record<string, unknown>[]) {
        if (!freshMap.has(row.ticker as string)) {
          freshMap.set(row.ticker as string, rowToQuote(row))
        }
      }
    }
  }

  // 3. Fetch all fundamentals (market_cap, pe, beta, profit_margins for stocks;
  //    expense_ratio, aum, sector_weightings, top_holdings for ETFs).
  //    Pocos tickers (modal, comparar): se esperan y van en esta respuesta. Muchos (Beating Peers pide
  //    ~475): bloqueaban la respuesta minutos y con ella el 1D; se hacen DESPUÉS de responder y el
  //    siguiente sondeo (5 s) ya los lee de price_cache. `inFlight` evita relanzarlos en cada sondeo.
  const pending = needsFundamentals.filter((t) => now - (fundamentalsInFlight.get(t) ?? 0) > IN_FLIGHT_TTL_MS)
  if (pending.length > 0 && pending.length <= INLINE_FUNDAMENTALS_MAX) {
    await refreshFundamentals(pending, freshMap, supabaseAdmin)
  } else if (pending.length > 0) {
    pending.forEach((t) => fundamentalsInFlight.set(t, now))
    const job = () =>
      refreshFundamentals(pending, null, supabaseAdmin).finally(() =>
        pending.forEach((t) => fundamentalsInFlight.delete(t))
      )
    try {
      after(job)
    } catch {
      void job() // fuera de una petición (pruebas): se lanza sin esperar
    }
  }

  return NextResponse.json(Object.fromEntries(freshMap))
}

async function refreshFundamentals(
  tickers: string[],
  freshMap: Map<string, object> | null,
  supabaseAdmin: ReturnType<typeof getAdminClient>
) {
  await mapWithConcurrency(tickers, FUNDAMENTALS_CONCURRENCY, async (ticker) => {
      try {
        let f = await fetchFundamentals(ticker)
        // If fundProfile didn't return inceptionDate, derive from first available history point
        if (f.inception_date == null) {
          try {
            const history = await fetchHistoricalData(ticker, 'MAX')
            if (history.length > 0) f = { ...f, inception_date: history[0].date }
          } catch { /* ignore */ }
        }
        // Always merge into freshMap so the response has the latest values
        const existing = freshMap?.get(ticker) as Record<string, unknown> | undefined
        if (existing) freshMap?.set(ticker, { ...existing, ...f })
        // Upsert fundamentals columns only (preserves price/volume data in cache).
        // fundamentals_fetched_at marks this row as "fundamentals attempted" so the
        // cache trigger doesn't loop forever on partially-populated rows.
        const { error: fundamentalsErr } = await supabaseAdmin
          .from('price_cache')
          .upsert({ ticker, ...f, fundamentals_fetched_at: new Date().toISOString() }, { onConflict: 'ticker' })
        if (fundamentalsErr) console.error('[quote] Fundamentals upsert error:', ticker, fundamentalsErr.message)
      } catch (err) {
        console.error('[quote] Fundamentals fetch error:', ticker, err)
      }
    })
}
