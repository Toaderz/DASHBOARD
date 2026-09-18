'use client'

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MetricKey } from '@/types'
import { marketFetch } from '@/lib/auth/market-fetch'
import { mapWithConcurrency } from '@/lib/utils/concurrency'

type ReturnMap = Partial<Record<MetricKey, number | null>>

const RETURN_PERIODS: MetricKey[] = ['1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX']
const CY_KEYS: MetricKey[] = ['CY2025', 'CY2024', 'CY2023', 'CY2022', 'CY2021', 'CY2020', 'CY2019']
const CY_YEAR: Record<string, number> = {
  CY2025: 2025, CY2024: 2024, CY2023: 2023, CY2022: 2022, CY2021: 2021, CY2020: 2020, CY2019: 2019,
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk returns client
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THESE HELPERS LIVE HERE. They are shared with `useTopPerformers`, which already imports from
// this folder (`FxSpotRate` from `useFxData`), and this change set may not create new modules. The
// two key prefixes are duplicated from `app/api/market/returns/route.ts` on purpose — a client
// bundle must not import the server module that pulls in `yahoo-finance2`.
//
// ⚠️ `perf:` is NOT interchangeable with the bare period keys that Beating Peers reads. Those are
// derived from a single 1Y series and are DIFFERENT NUMBERS (see the table in the route, and
// `lib/market/returns-parity.test.ts`). Reading a bare key here would silently restate every
// figure in the watchlist.

export const PERF_PREFIX = 'perf:'
export const CY_PREFIX = 'cy:'

export const perfKey = (period: string): string => `${PERF_PREFIX}${period}`
export const cyKey = (year: number): string => `${CY_PREFIX}${year}`

export interface ReturnsBundle {
  returns: Record<string, number | null>
  years: Record<string, number | null>
}

/** One thing to ask about: a trailing period, or a calendar year. */
export type ReturnKeySpec =
  | { kind: 'period'; period: MetricKey }
  | { kind: 'year'; metric: MetricKey; year: number }

/**
 * Ceiling on (ticker × key) pairs per POST.
 *
 * INPUT LIMIT ≠ EXECUTION LIMIT, on this side of the wire too. The endpoint accepts 1500 tickers,
 * but one invocation gets ~7 s of Yahoo time before Netlify's synchronous ceiling. The server runs
 * a pool of 8, so a request is answerable in full only while `items / 8 × per-fetch-latency` stays
 * under that: 64 items is 8 waves, ≈3–5 s at Yahoo's usual 400–600 ms. Above that the server would
 * still answer 200, but with the overflow served from last-good — correct, and needlessly slow to
 * warm. Splitting here is what keeps a cold load complete rather than partial.
 */
export const MAX_WORK_ITEMS_PER_REQUEST = 64

/**
 * Ceiling on distinct keys per POST.
 *
 * The route rejects more than 24 (9 periods + 7 calendar years is 16 today). Clamping here means a
 * one-ticker watchlist can never accidentally build a request the server would 400.
 */
export const MAX_KEYS_PER_REQUEST = 16

/** At most this many bulk POSTs in flight. Browsers cap ~6 per host; 4 leaves room for prices. */
const REQUEST_CONCURRENCY = 4

export interface ReturnRequestPlan {
  tickers: string[]
  keys: ReturnKeySpec[]
}

/**
 * Splits `tickers × keys` into POSTs of at most `maxItems` work items each.
 *
 * Chunks along BOTH axes: keys first (so a small watchlist asks for several periods at once), then
 * tickers when a single key already exceeds the ceiling. Order is preserved, so the plan is
 * deterministic and the first request always covers the first tickers/keys.
 */
export function planReturnRequests(
  tickers: string[],
  keys: ReturnKeySpec[],
  maxItems: number = MAX_WORK_ITEMS_PER_REQUEST
): ReturnRequestPlan[] {
  if (tickers.length === 0 || keys.length === 0) return []
  const cap = Math.max(1, Math.floor(maxItems))

  const keysPerRequest = Math.min(
    MAX_KEYS_PER_REQUEST,
    Math.max(1, Math.floor(cap / Math.min(tickers.length, cap)))
  )
  const tickersPerRequest = Math.max(1, Math.min(tickers.length, Math.floor(cap / keysPerRequest)))

  const plans: ReturnRequestPlan[] = []
  for (let k = 0; k < keys.length; k += keysPerRequest) {
    const keyChunk = keys.slice(k, k + keysPerRequest)
    for (let t = 0; t < tickers.length; t += tickersPerRequest) {
      plans.push({ tickers: tickers.slice(t, t + tickersPerRequest), keys: keyChunk })
    }
  }
  return plans
}

/**
 * One POST to `/api/market/returns` asking for explicit per-period values.
 *
 * Returns `{}` on any failure: the caller then leaves those cells as they were, exactly like the
 * old per-cell `fetch` did when a single request failed. `marketFetch` still handles a revoked
 * session (401 → signOut → /login).
 */
export async function fetchBulkReturns(
  tickers: string[],
  spec: { periods?: string[]; calendarYears?: number[] }
): Promise<Record<string, ReturnsBundle>> {
  try {
    const res = await marketFetch('/api/market/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, ...spec }),
    })
    if (!res.ok) return {}
    return (await res.json()) as Record<string, ReturnsBundle>
  } catch {
    return {}
  }
}

/** Runs a plan and merges every bundle into one `ticker → bundle` map. */
export async function runReturnPlan(plans: ReturnRequestPlan[]): Promise<Record<string, ReturnsBundle>> {
  const responses = await mapWithConcurrency(plans, REQUEST_CONCURRENCY, (plan) =>
    fetchBulkReturns(plan.tickers, {
      periods: plan.keys.filter((k) => k.kind === 'period').map((k) => k.period),
      calendarYears: plan.keys.filter((k) => k.kind === 'year').map((k) => k.year),
    })
  )

  const merged: Record<string, ReturnsBundle> = {}
  for (const response of responses) {
    for (const [ticker, bundle] of Object.entries(response)) {
      const target = merged[ticker] ?? (merged[ticker] = { returns: {}, years: {} })
      Object.assign(target.returns, bundle?.returns ?? {})
      Object.assign(target.years, bundle?.years ?? {})
    }
  }
  return merged
}

/**
 * A stable cache key for a ticker list.
 *
 * `tickers.sort()` sorts IN PLACE — it mutated the array the caller passed as a prop, which is a
 * side effect during render on data the parent still owns. The copy is the whole fix.
 */
export function stableTickerKey(tickers: string[]): string {
  return [...tickers].sort().join(',')
}

// ─────────────────────────────────────────────────────────────────────────────

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

    // ONE request per (bounded) chunk instead of one per ticker per metric. A 40-ticker watchlist
    // with the default columns went from 160 HTTP requests — each its own serverless invocation,
    // each its own Yahoo fetch — to a handful, with the server cache absorbing the repeats.
    const keys: ReturnKeySpec[] = [
      ...activePeriods.map((period): ReturnKeySpec => ({ kind: 'period', period })),
      ...activeCY.map((metric): ReturnKeySpec => ({ kind: 'year', metric, year: CY_YEAR[metric] })),
    ]

    const bundles = await runReturnPlan(planReturnRequests(tickers, keys))

    const results: Record<string, ReturnMap> = {}
    const yearsMap: Record<string, number | null> = {}

    for (const ticker of tickers) {
      // Pre-seed every requested cell to null so the rendered shape is identical to the old
      // per-cell path (which wrote null for a failed or empty fetch), never `undefined`.
      const map: ReturnMap = {}
      for (const period of activePeriods) map[period] = null
      for (const metric of activeCY) map[metric] = null

      const bundle = bundles[ticker]
      if (bundle) {
        for (const period of activePeriods) {
          const key = perfKey(period)
          if (key in bundle.returns) map[period] = bundle.returns[key]
          if (period === 'MAX') yearsMap[ticker] = bundle.years[key] ?? null
        }
        for (const metric of activeCY) {
          const key = cyKey(CY_YEAR[metric])
          if (key in bundle.returns) map[metric] = bundle.returns[key]
        }
      }

      results[ticker] = map
    }

    setReturns(results)
    setMaxYears(yearsMap)
  }, [tickers, activePeriods, activeCY])

  useQuery({
    queryKey: ['returns', stableTickerKey(tickers), activePeriods.join(','), activeCY.join(',')],
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
