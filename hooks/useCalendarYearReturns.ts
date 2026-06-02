'use client'

import { useQuery } from '@tanstack/react-query'

export interface CalendarYearReturn {
  year: number
  return: number | null
}

const SIX_HOURS = 6 * 60 * 60 * 1000

async function fetchCalendarYear(ticker: string, year: number): Promise<number | null> {
  const res = await fetch(
    `/api/market/history?ticker=${encodeURIComponent(ticker)}&year=${year}&mode=calYear`
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.return ?? null
}

export function useCalendarYearReturns(
  ticker: string | null,
  fromYear = 2019
): { data: CalendarYearReturn[]; loading: boolean } {
  // Lista de años desde fromYear hasta el año actual (reloj del navegador).
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = fromYear; y <= currentYear; y++) years.push(y)

  const { data, isLoading } = useQuery<CalendarYearReturn[]>({
    queryKey: ['calYearReturns', ticker, fromYear],
    queryFn: async () => {
      const settled = await Promise.allSettled(
        years.map((year) => fetchCalendarYear(ticker!, year))
      )
      const results: CalendarYearReturn[] = years.map((year, i) => {
        const r = settled[i]
        return {
          year,
          return: r.status === 'fulfilled' ? r.value : null,
        }
      })
      return results.sort((a, b) => a.year - b.year)
    },
    enabled: !!ticker,
    staleTime: SIX_HOURS,
  })

  return { data: data ?? [], loading: isLoading }
}
