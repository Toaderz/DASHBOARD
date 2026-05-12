import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchBatchQuotes, fetchFundamentals } from '@/lib/market/finnhub'

const CACHE_TTL_MS = 60_000

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
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
    fund_family: row.fund_family ?? null,
    alpha: row.alpha ?? null,
    r_squared: row.r_squared ?? null,
    std_dev: row.std_dev ?? null,
    sharpe: row.sharpe ?? null,
    treynor: row.treynor ?? null,
    sector_weightings: row.sector_weightings ?? null,
    top_holdings: row.top_holdings ?? null,
    last_updated: row.last_updated,
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tickersParam = searchParams.get('tickers')

  if (!tickersParam) {
    return NextResponse.json({ error: 'Missing tickers param' }, { status: 400 })
  }

  const tickers = tickersParam.split(',').map((t) => t.trim()).filter(Boolean)
  const supabaseAdmin = getAdminClient()

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
    if (row && now - new Date(row.last_updated as string).getTime() < CACHE_TTL_MS) {
      freshMap.set(ticker, rowToQuote(row))
      // Fetch fundamentals if neither stock metrics (market_cap) nor fund metrics (expense_ratio/aum) are cached
      if (row.market_cap == null && row.expense_ratio == null && row.aum == null) {
        needsFundamentals.push(ticker)
      }
    } else {
      staleOrMissing.push(ticker)
      if (!row || (row.market_cap == null && row.expense_ratio == null && row.aum == null)) {
        needsFundamentals.push(ticker)
      }
    }
  }

  // 2. Batch-fetch stale/missing prices from Yahoo Finance
  if (staleOrMissing.length > 0) {
    let yahooFailed = false
    try {
      const fetched = await fetchBatchQuotes(staleOrMissing)
      const upsertRows: object[] = []

      fetched.forEach((q) => {
        freshMap.set(q.ticker, { ...q, expense_ratio: null, aum: null })
        upsertRows.push({
          ticker: q.ticker,
          price: q.price,
          change_percent: q.change_percent,
          volume: q.volume ?? null,
          high_52w: q.high_52w ?? null,
          low_52w: q.low_52w ?? null,
          market_cap: q.market_cap ?? null,
          pe: q.pe ?? null,
          dividend_yield: q.dividend_yield ?? null,
          last_updated: q.last_updated,
        })
      })

      if (upsertRows.length > 0) {
        const { error: upsertErr } = await supabaseAdmin
          .from('price_cache')
          .upsert(upsertRows, { onConflict: 'ticker' })
        if (upsertErr) console.error('[quote] Supabase upsert error:', upsertErr.message)
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
  //    expense_ratio, aum, sector_weightings, top_holdings for ETFs) — fire in parallel
  if (needsFundamentals.length > 0) {
    const results = await Promise.allSettled(
      needsFundamentals.map(async (ticker) => {
        const f = await fetchFundamentals(ticker)
        // Always merge into freshMap so the response has the latest values
        const existing = freshMap.get(ticker) as Record<string, unknown> | undefined
        if (existing) freshMap.set(ticker, { ...existing, ...f })
        // Upsert fundamentals columns only (preserves price/volume data in cache)
        await supabaseAdmin
          .from('price_cache')
          .upsert({ ticker, ...f }, { onConflict: 'ticker' })
      })
    )
    results.forEach((r) => {
      if (r.status === 'rejected') console.error('[quote] Fundamentals fetch error:', r.reason)
    })
  }

  return NextResponse.json(Object.fromEntries(freshMap))
}
