'use client'

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MetricKey } from '@/types'

type ReturnMap = Partial<Record<MetricKey, number | null>>
const RETURN_PERIODS: MetricKey[] = ['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX']

async function fetchReturn(
  ticker: string,
  period: string,
): Promise<{ value: number | null; years: number | null }> {
  const res = await fetch(
    `/api/market/history?ticker=${encodeURIComponent(ticker)}&period=${period}&mode=return`
  )
  if (!res.ok) return { value: null, years: null }
  const json = await res.json()
  return { value: json.return ?? null, years: json.years ?? null }
}

export function usePerformanceMetrics(
  tickers: string[],
  prices: Record<string, { price: number }>,
  activeMetrics: MetricKey[]
) {
  const activePeriods = RETURN_PERIODS.filter((p) => activeMetrics.includes(p))

  const [returns, setReturns] = useState<Record<string, ReturnMap>>({})
  const [maxYears, setMaxYears] = useState<Record<string, number | null>>({})

  const fetchAllReturns = useCallback(async () => {
    if (tickers.length === 0 || activePeriods.length === 0) return

    const results: Record<string, ReturnMap> = {}
    const yearsMap: Record<string, number | null> = {}

    await Promise.all(
      tickers.map(async (ticker) => {
        const periodReturns = await Promise.all(
          activePeriods.map((period) => fetchReturn(ticker, period))
        )

        const map: ReturnMap = {}
        activePeriods.forEach((period, i) => {
          map[period] = periodReturns[i].value
          if (period === 'MAX') yearsMap[ticker] = periodReturns[i].years
        })
        results[ticker] = map
      })
    )

    setReturns(results)
    setMaxYears(yearsMap)
  }, [tickers, activePeriods])

  // Fetch returns when tickers or active periods change; refresh every 5 min
  useQuery({
    queryKey: ['returns', tickers.sort().join(','), activePeriods.join(',')],
    queryFn: async () => {
      await fetchAllReturns()
      return null
    },
    enabled: tickers.length > 0 && Object.keys(prices).length > 0,
    staleTime: 60_000,
    refetchInterval: 300_000,
  })

  return { returns, maxYears }
}
