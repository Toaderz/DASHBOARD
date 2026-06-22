'use client'

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import type { HistoricalDataPoint } from '@/types'

// Trailing windows shown in the Performance matrix (ETF.com-style, mapped to what we
// can derive from a single 5Y daily series). 1M/6M/YTD/1Y/3Y/5Y.
export const COMPARE_TRAILING_PERIODS = ['1M', '6M', 'YTD', '1Y', '3Y', '5Y'] as const
export type CompareTrailingPeriod = (typeof COMPARE_TRAILING_PERIODS)[number]

const SIX_HOURS = 6 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

// ── Client-side concurrency gate ───────────────────────────────────────────────
// useQueries fires all N series fetches at once; cap in-flight to 4 so the first
// render doesn't open 8 sockets to Yahoo (via our /api/market/history route) at once.
const MAX_IN_FLIGHT = 4
let active = 0
const waiters: Array<() => void> = []
async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_IN_FLIGHT) await new Promise<void>((res) => waiters.push(res))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

async function fetchSeries(ticker: string): Promise<HistoricalDataPoint[]> {
  return withLimit(async () => {
    const res = await fetch(`/api/market/history?ticker=${encodeURIComponent(ticker)}&period=5Y`)
    if (!res.ok) throw new Error(`history ${res.status}`)
    const json = (await res.json()) as { data?: HistoricalDataPoint[] }
    return json.data ?? []
  })
}

// Return (%) from the close nearest `targetMs` to the last close. Null when the
// series doesn't reach far enough back (younger than the window) beyond `slackMs`.
function returnFromSeries(
  series: HistoricalDataPoint[],
  ms: number[],
  endClose: number,
  targetMs: number,
  slackMs: number
): number | null {
  let idx = -1
  for (let i = 0; i < ms.length; i++) {
    if (ms[i] >= targetMs) { idx = i; break }
  }
  if (idx === -1) return null
  if (idx === 0 && ms[0] - targetMs > slackMs) return null
  const base = series[idx].close
  if (!base) return null
  return ((endClose - base) / base) * 100
}

export function deriveTrailing(
  series: HistoricalDataPoint[]
): Record<CompareTrailingPeriod, number | null> {
  const empty = { '1M': null, '6M': null, YTD: null, '1Y': null, '3Y': null, '5Y': null } as Record<CompareTrailingPeriod, number | null>
  if (series.length < 2) return empty
  const ms = series.map((p) => new Date(p.date).getTime())
  const endMs = ms[ms.length - 1]
  const endClose = series[series.length - 1].close
  if (!endClose) return empty
  const ytdMs = Date.UTC(new Date(endMs).getUTCFullYear(), 0, 1)
  const targets: Record<CompareTrailingPeriod, number> = {
    '1M': endMs - 30 * DAY,
    '6M': endMs - 182 * DAY,
    YTD: ytdMs,
    '1Y': endMs - 365 * DAY,
    '3Y': endMs - 3 * 365 * DAY,
    '5Y': endMs - 5 * 365 * DAY,
  }
  const slack: Record<CompareTrailingPeriod, number> = {
    '1M': 7 * DAY, '6M': 12 * DAY, YTD: 12 * DAY, '1Y': 12 * DAY, '3Y': 35 * DAY, '5Y': 45 * DAY,
  }
  const out = { ...empty }
  for (const p of COMPARE_TRAILING_PERIODS) {
    out[p] = returnFromSeries(series, ms, endClose, targets[p], slack[p])
  }
  return out
}

// Calendar-year total returns derived from the daily series:
// CY(Y) = lastClose(Y) / lastClose(Y-1) − 1. Only years with a prior year-end
// anchor are returned (a full/standard CY figure); the current incomplete year
// is included as a YTD-style bar.
export function deriveAnnual(series: HistoricalDataPoint[]): Record<number, number | null> {
  if (series.length < 2) return {}
  const yearEnd: Record<number, number> = {}
  for (const p of series) {
    const y = new Date(p.date).getUTCFullYear()
    if (p.close) yearEnd[y] = p.close // series is chronological → last write wins = year-end
  }
  const years = Object.keys(yearEnd).map(Number).sort((a, b) => a - b)
  const out: Record<number, number | null> = {}
  for (let i = 1; i < years.length; i++) {
    const y = years[i]
    const prev = yearEnd[years[i - 1]]
    if (prev) out[y] = ((yearEnd[y] - prev) / prev) * 100
  }
  return out
}

export interface EtfComparison {
  quotes: ReturnType<typeof useRealtimePrices>['prices']
  flashStates: ReturnType<typeof useRealtimePrices>['flashStates']
  pricesLoading: boolean
  seriesByTicker: Record<string, HistoricalDataPoint[]>
  trailingByTicker: Record<string, Record<CompareTrailingPeriod, number | null>>
  annualByTicker: Record<string, Record<number, number | null>>
  historyLoading: Record<string, boolean>
  historyError: Record<string, boolean>
}

export function useEtfComparison(tickers: string[]): EtfComparison {
  const { prices, flashStates, isLoading: pricesLoading } = useRealtimePrices(tickers)

  const histResults = useQueries({
    queries: tickers.map((t) => ({
      queryKey: ['etf-cmp-history', t],
      queryFn: () => fetchSeries(t),
      enabled: tickers.length > 0,
      staleTime: SIX_HOURS,
      gcTime: SIX_HOURS,
      retry: 2,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
    })),
  })

  return useMemo(() => {
    const seriesByTicker: Record<string, HistoricalDataPoint[]> = {}
    const trailingByTicker: EtfComparison['trailingByTicker'] = {}
    const annualByTicker: EtfComparison['annualByTicker'] = {}
    const historyLoading: Record<string, boolean> = {}
    const historyError: Record<string, boolean> = {}

    tickers.forEach((t, i) => {
      const q = histResults[i]
      const series = (q?.data as HistoricalDataPoint[] | undefined) ?? []
      seriesByTicker[t] = series
      trailingByTicker[t] = deriveTrailing(series)
      annualByTicker[t] = deriveAnnual(series)
      historyLoading[t] = !!q?.isLoading
      historyError[t] = !!q?.isError
    })

    return {
      quotes: prices,
      flashStates,
      pricesLoading,
      seriesByTicker,
      trailingByTicker,
      annualByTicker,
      historyLoading,
      historyError,
    }
  }, [tickers, histResults, prices, flashStates, pricesLoading])
}
