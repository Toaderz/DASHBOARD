'use client'

import { useRef, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { QuoteData, FlashState } from '@/types'

async function fetchPrices(tickers: string[]): Promise<Record<string, QuoteData>> {
  if (tickers.length === 0) return {}
  const res = await fetch(`/api/market/quote?tickers=${tickers.join(',')}`)
  if (!res.ok) throw new Error('Failed to fetch prices')
  return res.json()
}

export function useRealtimePrices(tickers: string[]) {
  const previousPrices = useRef<Record<string, number>>({})
  const [flashStates, setFlashStates] = useState<Record<string, FlashState>>({})

  const { data: prices, ...query } = useQuery({
    queryKey: ['prices', tickers.sort().join(',')],
    queryFn: () => fetchPrices(tickers),
    refetchInterval: 5_000,
    enabled: tickers.length > 0,
    staleTime: 4_000,
  })

  useEffect(() => {
    if (!prices) return

    const newFlash: Record<string, FlashState> = {}

    for (const ticker of tickers) {
      const prev = previousPrices.current[ticker]
      const curr = prices[ticker]?.price

      if (prev !== undefined && curr !== undefined && prev !== curr) {
        newFlash[ticker] = curr > prev ? 'up' : 'down'
      }

      if (curr !== undefined) {
        previousPrices.current[ticker] = curr
      }
    }

    if (Object.keys(newFlash).length > 0) {
      setFlashStates((prev) => ({ ...prev, ...newFlash }))

      const timer = setTimeout(() => {
        setFlashStates((prev) => {
          const cleared = { ...prev }
          Object.keys(newFlash).forEach((t) => { cleared[t] = null })
          return cleared
        })
      }, 1_500)

      return () => clearTimeout(timer)
    }
  }, [prices, tickers])

  return { prices: prices ?? {}, flashStates, ...query }
}
