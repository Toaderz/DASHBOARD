'use client'

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MetricKey } from '@/types'

type ReturnMap = Partial<Record<MetricKey, number | null>>

const RETURN_PERIODS: MetricKey[] = ['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX']
const CY_KEYS: MetricKey[] = ['CY2025', 'CY2024', 'CY2023', 'CY2022', 'CY2021', 'CY2020', 'CY2019']
const CY_YEAR: Record<string, number> = {
  CY2025: 2025, CY2024: 2024, CY2023: 2023, CY2022: 2022, CY2021: 2021, CY2020: 2020, CY2019: 2019,
}

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

async function fetchCalendarYear(ticker: string, year: number): Promise<number | null> {
  const res = await fetch(
    `/api/market/history?ticker=${encodeURIComponent(ticker)}&year=${year}&mode=calYear`
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.return ?? null
}

export function usePerformanceMetrics(
  tickers: string[],
  prices: Record<string, { price: number }>,
  activeMetrics: MetricKey[]
) {
  const activePeriods = RETURN_PERIODS.filter((p) => activeMetrics.includes(p))
  const activeCY = CY_KEYS.filter((p) => activeMetrics.includes(p))

  const [returns, setReturns] = useState<Record<string, ReturnMap>>({})
  const [maxYears, setMaxYears] = useState<Record<string, number | null>>({})

  const fetchAllReturns = useCallback(async () => {
    if (tickers.length === 0 || (activePeriods.length === 0 && activeCY.length === 0)) return

    const results: Record<string, ReturnMap> = {}
    const yearsMap: Record<string, number | null> = {}

    await Promise.all(
      tickers.map(async (ticker) => {
        const map: ReturnMap = {}

        // Standard period returns
        if (activePeriods.length > 0) {
          const periodReturns = await Promise.all(
            activePeriods.map((period) => fetchReturn(ticker, period))
          )
          activePeriods.forEach((period, i) => {
            map[period] = periodReturns[i].value
            if (period === 'MAX') yearsMap[ticker] = periodReturns[i].years
          })
        }

        // Calendar year returns
        if (activeCY.length > 0) {
          const cyReturns = await Promise.all(
            activeCY.map((key) => fetchCalendarYear(ticker, CY_YEAR[key]))
          )
          activeCY.forEach((key, i) => {
            map[key] = cyReturns[i]
          })
        }

        results[ticker] = map
      })
    )

    setReturns(results)
    setMaxYears(yearsMap)
  }, [tickers, activePeriods, activeCY])

  useQuery({
    queryKey: ['returns', tickers.sort().join(','), activePeriods.join(','), activeCY.join(',')],
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
