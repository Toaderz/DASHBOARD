import type { HistoricalDataPoint } from '@/types'
import YahooFinanceLib from 'yahoo-finance2'

const yf = new YahooFinanceLib({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false, allowAdditionalProps: true },
})

export type PeriodKey = '1W' | '1M' | '1Y' | '3Y' | '5Y' | 'YTD' | '10Y' | 'MAX'

const YAHOO_RANGE_MAP: Record<PeriodKey, string> = {
  '1W': '5d',
  '1M': '1mo',
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

export async function fetchHistoricalData(
  ticker: string,
  period: PeriodKey
): Promise<HistoricalDataPoint[]> {
  const range = YAHOO_RANGE_MAP[period]
  const interval = YAHOO_INTERVAL_MAP[period]

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
    })

    if (!res.ok) return []

    const data = (await res.json()) as YahooChartResult
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
  } catch {
    return []
  }
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
