'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

// Hard ceiling: CHART_SERIES has 8 distinct hues, and a transposed matrix past ~8
// columns stops being legible. The cap is VISIBLE (the search disables at the top),
// never a silent truncation.
export const MAX_COMPARE_TICKERS = 8

function parse(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const t = part.trim().toUpperCase()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_COMPARE_TICKERS) break
  }
  return out
}

/**
 * Compare tickers live in the URL (`?tickers=DDIV,SDVY,RDVY`) so a comparison is
 * shareable and survives reload. Normalizes to uppercase, dedups, and caps at
 * MAX_COMPARE_TICKERS. Writing uses `router.replace` (no history spam) and keeps
 * any other query params intact.
 */
export function useCompareTickers() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tickers = useMemo(() => parse(searchParams.get('tickers')), [searchParams])

  const write = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next.length === 0) params.delete('tickers')
      else params.set('tickers', next.join(','))
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  const add = useCallback(
    (ticker: string) => {
      const t = ticker.trim().toUpperCase()
      if (!t) return
      if (tickers.includes(t)) return
      if (tickers.length >= MAX_COMPARE_TICKERS) return
      write([...tickers, t])
    },
    [tickers, write]
  )

  const remove = useCallback(
    (ticker: string) => {
      write(tickers.filter((t) => t !== ticker.toUpperCase()))
    },
    [tickers, write]
  )

  const reset = useCallback(() => write([]), [write])

  const atCap = tickers.length >= MAX_COMPARE_TICKERS

  return { tickers, add, remove, reset, atCap }
}
