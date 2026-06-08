import type { HistoricalDataPoint } from '@/types'
import YahooFinanceLib from 'yahoo-finance2'

const yf = new YahooFinanceLib({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false, allowAdditionalProps: true },
})

export type PeriodKey = '1W' | '1M' | '6M' | '1Y' | '3Y' | '5Y' | 'YTD' | '10Y' | 'MAX'

const YAHOO_RANGE_MAP: Record<PeriodKey, string> = {
  '1W': '5d',
  '1M': '1mo',
  '6M': '6mo',
  '1Y': '1y',
  '3Y': '3y',
  '5Y': '5y',
  YTD: 'ytd',
  '10Y': '10y',
  MAX: 'max',
}

const YAHOO_INTERVAL_MAP: Record<PeriodKey, string> = {
  '1W': '1d',
  '1M': '1d',
  '6M': '1d',
  '1Y': '1d',
  '3Y': '1d',
  '5Y': '1d',
  YTD: '1d',
  '10Y': '1d',
  MAX: '3mo',
}

interface YahooChartResult {
  chart: {
    result: Array<{
      timestamp: number[]
      indicators: {
        adjclose?: Array<{ adjclose: number[] }>
        quote: Array<{
          close: number[]
          open: number[]
          high: number[]
          low: number[]
          volume: number[]
        }>
      }
    }>
    error: unknown
  }
}

// Parses one Yahoo v8 chart response into points; returns [] on any structural gap.
function parseChart(data: YahooChartResult): HistoricalDataPoint[] {
  const result = data.chart?.result?.[0]
  if (!result) return []

  const { timestamp, indicators } = result
  const quotes = indicators.quote[0]
  const adjClose = indicators.adjclose?.[0]?.adjclose

  return timestamp.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split('T')[0],
    close: adjClose?.[i] ?? quotes.close[i] ?? 0,
    open: quotes.open[i],
    high: quotes.high[i],
    low: quotes.low[i],
    volume: quotes.volume[i],
  })).filter((d) => d.close > 0)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchHistoricalData(
  ticker: string,
  period: PeriodKey
): Promise<HistoricalDataPoint[]> {
  const range = YAHOO_RANGE_MAP[period]
  const interval = YAHOO_INTERVAL_MAP[period]

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`

  // Resilience: Yahoo intermittently returns 429/5xx or an empty body under concurrent load
  // (the Beating-Peers batch fires dozens of tickers at once). A single failed attempt used to
  // become a permanent "— sin dato" because failures aren't cached. Retry transient failures with
  // a short backoff so the peer path is as reliable as the watchlist's per-period fetches.
  // Successful responses (the common case) hit `next.revalidate` and never retry → zero overhead.
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 3600 },
      })

      if (!res.ok) {
        // 4xx other than rate-limit won't fix itself; only retry 429/5xx.
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
          await sleep(250 * attempt)
          continue
        }
        return []
      }

      const data = (await res.json()) as YahooChartResult
      const points = parseChart(data)
      if (points.length === 0 && attempt < MAX_ATTEMPTS) {
        await sleep(250 * attempt)
        continue
      }
      return points
    } catch {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(250 * attempt)
        continue
      }
      return []
    }
  }
  return []
}

async function fetchCalendarYearReturnFromPrice(
  ticker: string,
  year: number
): Promise<{ value: number | null }> {
  const period1 = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000)
  const period2 = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000) - 1

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { value: null }

    const data = (await res.json()) as YahooChartResult
    const result = data.chart?.result?.[0]
    if (!result) return { value: null }

    const { indicators } = result
    const adjClose = indicators.adjclose?.[0]?.adjclose
    const closes = adjClose ?? indicators.quote[0]?.close

    if (!closes || closes.length < 2) return { value: null }

    const valid = closes.filter((c): c is number => c != null && c > 0)
    if (valid.length < 2) return { value: null }

    const first = valid[0]
    const last = valid[valid.length - 1]
    return { value: ((last - first) / first) * 100 }
  } catch {
    return { value: null }
  }
}

export async function fetchCalendarYearReturn(
  ticker: string,
  year: number
): Promise<{ value: number | null }> {
  // For ETFs/funds: use Morningstar NAV-based total returns (matches Yahoo Finance fund pages exactly)
  try {
    const summary = await yf.quoteSummary(ticker, { modules: ['fundPerformance'] }, { validateResult: false }) as Record<string, unknown>
    const fp = summary.fundPerformance as Record<string, unknown> | null | undefined
    const annualReturns = (fp?.annualTotalReturns as { returns?: Array<{ year: string | number; annualValue: number | null }> } | null)?.returns
    if (Array.isArray(annualReturns)) {
      const match = annualReturns.find((r) => String(r.year) === String(year))
      if (match?.annualValue != null) {
        return { value: match.annualValue * 100 }
      }
    }
  } catch (err) {
    console.error('[fundPerformance] quoteSummary failed for', ticker, year, err instanceof Error ? err.message : err)
  }

  // For stocks: calculate from adjusted close price history
  return fetchCalendarYearReturnFromPrice(ticker, year)
}

export async function calculateReturn(
  ticker: string,
  period: PeriodKey,
  _currentPrice: number
): Promise<{ value: number | null; years: number | null }> {
  const history = await fetchHistoricalData(ticker, period)
  if (history.length < 2) return { value: null, years: null }

  // Use adjclose for both endpoints so splits and dividends are factored in
  // consistently (total return methodology). Mixing adjclose base with a live
  // unadjusted price inflates returns for dividend-paying stocks.
  const baseClose = history[0].close
  const endClose = history[history.length - 1].close

  if (!baseClose || baseClose === 0) return { value: null, years: null }

  const value = ((endClose - baseClose) / baseClose) * 100
  const startMs = new Date(history[0].date).getTime()
  const endMs = new Date(history[history.length - 1].date).getTime()
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000)

  return { value, years }
}

// Periods computed from a single ~1Y daily series (1D comes from live quotes).
export const MULTI_RETURN_PERIODS = ['1W', '1M', '6M', 'YTD', '1Y'] as const
export type MultiReturnPeriod = typeof MULTI_RETURN_PERIODS[number]

export interface MultiReturns {
  returns: Record<MultiReturnPeriod, number | null>
  years: Record<MultiReturnPeriod, number | null>
}

const EMPTY_MULTI: MultiReturns = {
  returns: { '1W': null, '1M': null, '6M': null, YTD: null, '1Y': null },
  years: { '1W': null, '1M': null, '6M': null, YTD: null, '1Y': null },
}

// Return value (%) and years between the close nearest `targetMs` and the last close.
function returnFrom(
  history: HistoricalDataPoint[],
  parsed: number[],
  endClose: number,
  endMs: number,
  targetMs: number
): { value: number | null; years: number | null } {
  // Find the earliest point on/after the target date; fall back to the first point
  // only when the series itself starts after the target (period not fully covered).
  let idx = -1
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i] >= targetMs) { idx = i; break }
  }
  if (idx === -1) return { value: null, years: null }
  // If the very first datapoint is already after the target, the window isn't
  // fully covered (e.g. a fund younger than the period) → not enough history.
  if (idx === 0 && parsed[0] > targetMs) {
    // Only treat as covered when the gap is small (≤7 days of missing leading data).
    if (parsed[0] - targetMs > 7 * 24 * 60 * 60 * 1000) return { value: null, years: null }
  }
  const baseClose = history[idx].close
  if (!baseClose || baseClose === 0) return { value: null, years: null }
  const value = ((endClose - baseClose) / baseClose) * 100
  const years = (endMs - parsed[idx]) / (365.25 * 24 * 60 * 60 * 1000)
  return { value, years }
}

/**
 * Computes 1W / 1M / 6M / YTD / 1Y total returns from a single 1Y daily series.
 * One Yahoo request per ticker instead of five. Null-safe: any period without
 * enough history resolves to null and never throws.
 */
export async function calculateMultiReturns(ticker: string): Promise<MultiReturns> {
  let history: HistoricalDataPoint[]
  try {
    history = await fetchHistoricalData(ticker, '1Y')
  } catch {
    return EMPTY_MULTI
  }
  if (!history || history.length < 2) return EMPTY_MULTI

  const parsed = history.map((h) => new Date(h.date).getTime())
  const endClose = history[history.length - 1].close
  const endMs = parsed[parsed.length - 1]
  if (!endClose || endClose === 0) return EMPTY_MULTI

  const DAY = 24 * 60 * 60 * 1000
  const endDate = new Date(endMs)
  const ytdMs = Date.UTC(endDate.getUTCFullYear(), 0, 1)

  const targets: Record<MultiReturnPeriod, number> = {
    '1W': endMs - 7 * DAY,
    '1M': endMs - 30 * DAY,
    '6M': endMs - 182 * DAY,
    YTD: ytdMs,
    '1Y': parsed[0], // first point of the 1Y window
  }

  const returns = {} as Record<MultiReturnPeriod, number | null>
  const years = {} as Record<MultiReturnPeriod, number | null>
  for (const p of MULTI_RETURN_PERIODS) {
    const { value, years: y } = returnFrom(history, parsed, endClose, endMs, targets[p])
    returns[p] = value
    years[p] = y
  }

  // Self-healing fallback: deriving every period from a single 1Y series is efficient but fragile —
  // a short/degraded Yahoo response (or a window `returnFrom` can't cleanly cover) yields a null for
  // a period that genuinely has data. The watchlist never hits this because it fetches a dedicated
  // range per period. So for any null period, retry it via the SAME robust per-range path the
  // watchlist uses (`calculateReturn`), guaranteeing PeerCard parity with WatchlistTable. Fires only
  // for the rare null periods; each failure is swallowed so the period stays null (never throws).
  const missing = MULTI_RETURN_PERIODS.filter((p) => returns[p] == null)
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (p) => {
        try {
          // MultiReturnPeriod strings are a subset of PeriodKey, so the cast is sound.
          const { value, years: y } = await calculateReturn(ticker, p as PeriodKey, 0)
          if (value != null) {
            returns[p] = value
            years[p] = y
          }
        } catch {
          /* leave this period null — preserves the null-safe contract */
        }
      })
    )
  }

  return { returns, years }
}
