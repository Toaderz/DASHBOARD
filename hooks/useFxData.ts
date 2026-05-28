'use client'

import { useQuery } from '@tanstack/react-query'
import type { MetricKey, QuoteData } from '@/types'

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
  CY2025: 2025, CY2024: 2024, CY2023: 2023, CY2022: 2022, CY2021: 2021,
}

export interface FxSpotRate {
  rate: number
  change1d: number
}

async function fetchFxReturn(ticker: string, period: string): Promise<number | null> {
  const res = await fetch(
    `/api/market/history?ticker=${encodeURIComponent(ticker)}&period=${period}&mode=return`
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.return ?? null
}

async function fetchFxCalendarYear(ticker: string, year: number): Promise<number | null> {
  const res = await fetch(
    `/api/market/history?ticker=${encodeURIComponent(ticker)}&year=${year}&mode=calYear`
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.return ?? null
}

export function useFxData(
  currencies: string[],
  activePeriods: MetricKey[]
): {
  fxRates: Record<string, FxSpotRate>
  fxPeriodReturns: Record<string, Partial<Record<MetricKey, number | null>>>
} {
  const nonUsd = [...new Set(currencies.filter((c) => c !== 'USD'))]
  const fxTickers = [...new Set(nonUsd.map((c) => FX_TICKER[c]).filter(Boolean))]

  const cyPeriods = activePeriods.filter((p) => p in CY_YEAR)
  const returnPeriods = activePeriods.filter((p) => p !== '1D' && !(p in CY_YEAR))

  const { data: spotQuotes } = useQuery<Record<string, QuoteData>>({
    queryKey: ['fxSpot', fxTickers.sort().join(',')],
    queryFn: async () => {
      const res = await fetch(`/api/market/quote?tickers=${fxTickers.join(',')}`)
      if (!res.ok) return {}
      return res.json()
    },
    enabled: fxTickers.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: periodData } = useQuery<Record<string, Partial<Record<MetricKey, number | null>>>>({
    queryKey: ['fxPeriodReturns', nonUsd.sort().join(','), returnPeriods.join(','), cyPeriods.join(',')],
    queryFn: async () => {
      const result: Record<string, Partial<Record<MetricKey, number | null>>> = {}
      await Promise.all(
        nonUsd.map(async (currency) => {
          const fxTicker = FX_TICKER[currency]
          if (!fxTicker) return
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

          result[currency] = map
        })
      )
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

  return { fxRates, fxPeriodReturns: periodData ?? {} }
}
