'use client'

import { useQuery } from '@tanstack/react-query'
import type { MetricKey, QuoteData } from '@/types'
import { marketFetch } from '@/lib/auth/market-fetch'

const FX_TICKER: Record<string, string> = {
  GBP: 'GBPUSD=X',
  GBX: 'GBPUSD=X',  // pence (Yahoo uppercase)
  GBp: 'GBPUSD=X',  // pence (Yahoo mixed-case, e.g. PSH.L)
  EUR: 'EURUSD=X',
  JPY: 'JPYUSD=X',
  CHF: 'CHFUSD=X',
  CAD: 'CADUSD=X',
  AUD: 'AUDUSD=X',
  HKD: 'HKDUSD=X',
}

const FX_DIVISOR: Record<string, number> = { GBX: 100, GBp: 100 }

const CY_YEAR: Record<string, number> = {
  CY2025: 2025, CY2024: 2024, CY2023: 2023, CY2022: 2022, CY2021: 2021, CY2020: 2020, CY2019: 2019,
}

export interface FxSpotRate {
  rate: number
  change1d: number
}

async function fetchFxReturn(ticker: string, period: string): Promise<number | null> {
  const res = await marketFetch(`/api/market/history?ticker=${encodeURIComponent(ticker)}&period=${period}&mode=return`)
  if (!res.ok) return null
  const json = await res.json()
  return json.return ?? null
}

async function fetchFxCalendarYear(ticker: string, year: number): Promise<number | null> {
  const res = await marketFetch(`/api/market/history?ticker=${encodeURIComponent(ticker)}&year=${year}&mode=calYear`)
  if (!res.ok) return null
  const json = await res.json()
  return json.return ?? null
}

/**
 * Fetches each FX PAIR once for every requested period/calendar year.
 *
 * Exported so the de-duplication is testable without a DOM: `planFxPairs(["GBP","GBX","GBp"])`
 * must resolve to a single `GBPUSD=X`, not three.
 */
export async function fetchFxSeries(
  fxTickers: string[],
  returnPeriods: MetricKey[],
  cyPeriods: MetricKey[]
): Promise<Record<string, Partial<Record<MetricKey, number | null>>>> {
  const byPair: Record<string, Partial<Record<MetricKey, number | null>>> = {}
  await Promise.all(
    fxTickers.map(async (fxTicker) => {
      const map: Partial<Record<MetricKey, number | null>> = {}

      // Standard period returns
      if (returnPeriods.length > 0) {
        const periodReturns = await Promise.all(
          returnPeriods.map((p) => fetchFxReturn(fxTicker, p))
        )
        returnPeriods.forEach((p, i) => { map[p] = periodReturns[i] })
      }

      // Calendar year FX returns
      if (cyPeriods.length > 0) {
        const cyReturns = await Promise.all(
          cyPeriods.map((key) => fetchFxCalendarYear(fxTicker, CY_YEAR[key]))
        )
        cyPeriods.forEach((key, i) => { map[key] = cyReturns[i] })
      }

      byPair[fxTicker] = map
    })
  )
  return byPair
}

/**
 * Currency list → the DISTINCT Yahoo pairs needed for it, plus the pair each currency reads.
 *
 * One place where "GBP, GBX and GBp are the same series" is expressed, so the request count is a
 * function of PAIRS and never of currencies.
 */
export function planFxPairs(currencies: string[]): {
  nonUsd: string[]
  fxTickers: string[]
  pairByCurrency: Record<string, string>
} {
  const nonUsd = [...new Set(currencies.filter((c) => c !== 'USD'))]
  const pairByCurrency: Record<string, string> = {}
  const fxTickers: string[] = []
  for (const currency of nonUsd) {
    const pair = FX_TICKER[currency]
    if (!pair) continue
    pairByCurrency[currency] = pair
    if (!fxTickers.includes(pair)) fxTickers.push(pair)
  }
  return { nonUsd, fxTickers, pairByCurrency }
}

export function useFxData(
  currencies: string[],
  activePeriods: MetricKey[]
): {
  fxRates: Record<string, FxSpotRate>
  fxPeriodReturns: Record<string, Partial<Record<MetricKey, number | null>>>
  loading: boolean
} {
  const { nonUsd, fxTickers } = planFxPairs(currencies)

  const cyPeriods = activePeriods.filter((p) => p in CY_YEAR)
  const returnPeriods = activePeriods.filter((p) => p !== '1D' && !(p in CY_YEAR))

  const { data: spotQuotes, isLoading: spotLoading } = useQuery<Record<string, QuoteData>>({
    // `[...x].sort()`, never `x.sort()`: sorting in place inside a render is a side effect.
    queryKey: ['fxSpot', [...fxTickers].sort().join(',')],
    queryFn: async () => {
      const res = await marketFetch(`/api/market/quote?tickers=${fxTickers.join(',')}`)
      if (!res.ok) return {}
      return res.json()
    },
    enabled: fxTickers.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: periodData, isLoading: periodLoading } = useQuery<Record<string, Partial<Record<MetricKey, number | null>>>>({
    queryKey: ['fxPeriodReturns', [...nonUsd].sort().join(','), returnPeriods.join(','), cyPeriods.join(',')],
    queryFn: async () => {
      // DEDUPLICATED BY PAIR (A-5). `GBP`, `GBX` and `GBp` all map to `GBPUSD=X`, and the old loop
      // iterated CURRENCIES — so a portfolio holding one GBP-quoted and one GBp-quoted asset (both
      // are common on .L listings) asked Yahoo for the identical `GBPUSD=X` series twice for every
      // active period, and again for every calendar year. Fetch per PAIR, then fan back out.
      const byPair = await fetchFxSeries(fxTickers, returnPeriods, cyPeriods)

      // Fan out to currencies. The percentages are shared untouched: a ratio is scale-invariant,
      // so a +5% move of the pair is +5% for a pence-quoted asset too. The ÷100 pence divisor is a
      // PRICE unit conversion (applied to the spot rate below) and must never reach this path.
      const result: Record<string, Partial<Record<MetricKey, number | null>>> = {}
      for (const currency of nonUsd) {
        const fxTicker = FX_TICKER[currency]
        if (!fxTicker) continue
        const map = byPair[fxTicker]
        if (map) result[currency] = { ...map }
      }
      return result
    },
    enabled: nonUsd.length > 0 && (returnPeriods.length > 0 || cyPeriods.length > 0),
    staleTime: 300_000,
    refetchInterval: 300_000,
  })

  const fxRates: Record<string, FxSpotRate> = { USD: { rate: 1, change1d: 0 } }
  for (const currency of nonUsd) {
    const fxTicker = FX_TICKER[currency]
    if (!fxTicker) continue
    const quote = spotQuotes?.[fxTicker]
    if (!quote) continue
    const divisor = FX_DIVISOR[currency] ?? 1
    fxRates[currency] = { rate: quote.price / divisor, change1d: quote.change_percent }
  }

  // "loading" = primera carga en curso de cualquiera de las queries habilitadas (no en refetch de fondo).
  const loading = spotLoading || periodLoading

  return { fxRates, fxPeriodReturns: periodData ?? {}, loading }
}
