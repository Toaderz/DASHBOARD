/**
 * Client-side plumbing of the bulk-returns migration, plus the three point fixes.
 *
 * Everything under test is a PURE function deliberately extracted from the hooks, so it can be
 * exercised in the `node` environment this repo's vitest runs in (there is no DOM renderer here,
 * and adding one to assert "the array wasn't mutated" would be absurd).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

/** Drops `//` and block comments, so a source assertion cannot be satisfied (or broken) by prose. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const marketFetch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/market-fetch', () => ({ marketFetch }))

import {
  MAX_KEYS_PER_REQUEST,
  MAX_WORK_ITEMS_PER_REQUEST,
  cyKey,
  fetchBulkReturns,
  perfKey,
  planReturnRequests,
  runReturnPlan,
  stableTickerKey,
  type ReturnKeySpec,
} from '@/hooks/usePerformanceMetrics'
import { fetchFxSeries, planFxPairs } from '@/hooks/useFxData'
import { WATCHLIST_UPDATABLE_COLUMNS, pickWatchlistUpdates } from '@/hooks/useWatchlistAssets'
import type { MetricKey, Watchlist } from '@/types'

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

beforeEach(() => {
  marketFetch.mockReset()
  marketFetch.mockResolvedValue(jsonOk({}))
})
afterEach(() => vi.restoreAllMocks())

// ══════════════════════════════════════════════════════════════════════════════
// A-6 — `tickers.sort()` mutated the caller's prop
// ══════════════════════════════════════════════════════════════════════════════

describe('A-6: the ticker array is never mutated', () => {
  it('stableTickerKey sorts a COPY', () => {
    const tickers = ['MSFT', 'AAPL', 'NVDA']
    const snapshot = [...tickers]
    expect(stableTickerKey(tickers)).toBe('AAPL,MSFT,NVDA')
    // The old `tickers.sort().join(',')` reordered the array the parent still owns, during render.
    expect(tickers).toEqual(snapshot)
  })

  it('is order-insensitive, which is the whole reason the sort is there', () => {
    expect(stableTickerKey(['B', 'A'])).toBe(stableTickerKey(['A', 'B']))
  })

  it('no hook sorts a ticker array in place any more', () => {
    for (const rel of ['hooks/usePerformanceMetrics.ts', 'hooks/useFxData.ts']) {
      // Comments are stripped first: they legitimately SPELL OUT the bug being forbidden.
      const source = stripComments(read(rel))
      // `x.sort()` is the in-place form. `[...x].sort()` reads as `x].sort(` and cannot match.
      expect(source, `${rel} still sorts in place`).not.toMatch(/\b(tickers|fxTickers|nonUsd)\.sort\(/)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Request planning — input limit ≠ execution limit, on the client too
// ══════════════════════════════════════════════════════════════════════════════

const periods = (...ps: string[]): ReturnKeySpec[] =>
  ps.map((p) => ({ kind: 'period', period: p as MetricKey }))

describe('planReturnRequests', () => {
  it('keeps every POST inside the work-item ceiling', () => {
    const tickers = Array.from({ length: 40 }, (_, i) => `T${i}`)
    const keys = periods('1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX')
    const plans = planReturnRequests(tickers, keys)
    for (const plan of plans) {
      expect(plan.tickers.length * plan.keys.length).toBeLessThanOrEqual(MAX_WORK_ITEMS_PER_REQUEST)
    }
  })

  it('covers every (ticker, key) pair exactly once', () => {
    const tickers = Array.from({ length: 37 }, (_, i) => `T${i}`)
    const keys = periods('1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y')
    const seen = new Set<string>()
    for (const plan of planReturnRequests(tickers, keys)) {
      for (const t of plan.tickers) {
        for (const k of plan.keys) {
          const id = `${t}|${k.kind === 'period' ? k.period : k.year}`
          expect(seen.has(id), `${id} planned twice`).toBe(false)
          seen.add(id)
        }
      }
    }
    expect(seen.size).toBe(tickers.length * keys.length)
  })

  it('collapses a 40×4 grid from 160 requests to a handful', () => {
    const tickers = Array.from({ length: 40 }, (_, i) => `T${i}`)
    const plans = planReturnRequests(tickers, periods('1W', '1M', 'YTD', '1Y'))
    // The old hook issued one GET per ticker per metric.
    expect(plans.length).toBeLessThan(10)
    expect(plans.length).toBeGreaterThan(0)
  })

  it('chunks by TICKER when a single key already exceeds the ceiling', () => {
    const tickers = Array.from({ length: 400 }, (_, i) => `T${i}`)
    const plans = planReturnRequests(tickers, periods('1Y'))
    expect(plans.length).toBeGreaterThan(1)
    for (const plan of plans) {
      expect(plan.keys).toHaveLength(1)
      expect(plan.tickers.length).toBeLessThanOrEqual(MAX_WORK_ITEMS_PER_REQUEST)
    }
    expect(plans.flatMap((p) => p.tickers)).toHaveLength(400)
  })

  it('is empty — not a request for nothing — with no tickers or no keys', () => {
    expect(planReturnRequests([], periods('1Y'))).toEqual([])
    expect(planReturnRequests(['AAPL'], [])).toEqual([])
  })

  it('never asks for more keys than the route accepts (a 1-ticker watchlist)', () => {
    const keys = periods('1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX')
    for (const plan of planReturnRequests(['AAPL'], keys, 10_000)) {
      expect(plan.keys.length).toBeLessThanOrEqual(MAX_KEYS_PER_REQUEST)
    }
  })

  it('never produces a zero-sized chunk, even with an absurd ceiling', () => {
    const plans = planReturnRequests(['A', 'B', 'C'], periods('1W', '1M'), 0)
    for (const plan of plans) {
      expect(plan.tickers.length).toBeGreaterThan(0)
      expect(plan.keys.length).toBeGreaterThan(0)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// The wire contract
// ══════════════════════════════════════════════════════════════════════════════

describe('fetchBulkReturns / runReturnPlan', () => {
  it('POSTs tickers + periods + calendarYears to the bulk endpoint', async () => {
    await fetchBulkReturns(['AAPL'], { periods: ['3Y'], calendarYears: [2024] })
    expect(marketFetch).toHaveBeenCalledTimes(1)
    const [url, init] = marketFetch.mock.calls[0]
    expect(url).toBe('/api/market/returns')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ tickers: ['AAPL'], periods: ['3Y'], calendarYears: [2024] })
  })

  it('reads the `perf:` / `cy:` namespace, never the bare derived keys', () => {
    expect(perfKey('3Y')).toBe('perf:3Y')
    expect(cyKey(2024)).toBe('cy:2024')
    // The trap: a bare '1W' in the response is Beating Peers' DERIVED value, a different number.
    expect(perfKey('1W')).not.toBe('1W')
  })

  it('returns {} on a non-OK response instead of throwing', async () => {
    marketFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response)
    await expect(fetchBulkReturns(['AAPL'], { periods: ['3Y'] })).resolves.toEqual({})
  })

  it('returns {} when the request rejects outright', async () => {
    marketFetch.mockRejectedValue(new Error('offline'))
    await expect(fetchBulkReturns(['AAPL'], { periods: ['3Y'] })).resolves.toEqual({})
  })

  it('merges every chunk into one ticker → bundle map', async () => {
    marketFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const { tickers, periods: ps } = JSON.parse(init.body)
      const out: Record<string, { returns: Record<string, number>; years: Record<string, number> }> = {}
      for (const t of tickers) {
        out[t] = { returns: {}, years: {} }
        for (const p of ps ?? []) {
          out[t].returns[`perf:${p}`] = p.length
          out[t].years[`perf:${p}`] = 1
        }
      }
      return jsonOk(out)
    })

    const tickers = Array.from({ length
      : 40 }, (_, i) => `T${i}`)
    const keys = periods('1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX')
    const merged = await runReturnPlan(planReturnRequests(tickers, keys))

    expect(Object.keys(merged)).toHaveLength(40)
    // Every key from every chunk survives the merge.
    expect(Object.keys(merged.T0.returns).sort()).toEqual(
      keys.map((k) => perfKey((k as { period: string }).period)).sort()
    )
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// A-5 — FX de-duplication by PAIR
// ══════════════════════════════════════════════════════════════════════════════

describe('A-5: FX requests are per PAIR, not per currency', () => {
  it('GBP, GBX and GBp collapse onto a single GBPUSD=X', () => {
    const { fxTickers, pairByCurrency } = planFxPairs(['GBP', 'GBX', 'GBp', 'USD'])
    expect(fxTickers).toEqual(['GBPUSD=X'])
    expect(pairByCurrency).toEqual({ GBP: 'GBPUSD=X', GBX: 'GBPUSD=X', GBp: 'GBPUSD=X' })
  })

  it('drops USD and de-duplicates a repeated currency', () => {
    const { nonUsd, fxTickers } = planFxPairs(['USD', 'EUR', 'EUR', 'USD', 'JPY'])
    expect(nonUsd).toEqual(['EUR', 'JPY'])
    expect(fxTickers).toEqual(['EURUSD=X', 'JPYUSD=X'])
  })

  it('ignores a currency with no Yahoo pair rather than requesting `undefined`', () => {
    const { fxTickers, pairByCurrency } = planFxPairs(['SEK', 'EUR'])
    expect(fxTickers).toEqual(['EURUSD=X'])
    expect(pairByCurrency.SEK).toBeUndefined()
  })

  it('asks Yahoo ONCE per pair per period — three pence/pound currencies, one series', async () => {
    marketFetch.mockResolvedValue(jsonOk({ return: 5 }))
    const { fxTickers } = planFxPairs(['GBP', 'GBX', 'GBp'])
    const byPair = await fetchFxSeries(fxTickers, ['1W', '1Y'] as MetricKey[], ['CY2024'] as MetricKey[])

    // 2 periods + 1 calendar year = 3 requests TOTAL. Before the fix: 9 (3 currencies × 3).
    expect(marketFetch).toHaveBeenCalledTimes(3)
    const urls = marketFetch.mock.calls.map((c) => c[0] as string)
    expect(urls.every((u) => u.includes('GBPUSD%3DX') || u.includes('GBPUSD=X'))).toBe(true)
    expect(Object.keys(byPair)).toEqual(['GBPUSD=X'])
    expect(byPair['GBPUSD=X']['1W']).toBe(5)
    expect(byPair['GBPUSD=X'].CY2024).toBe(5)
  })

  it('the pence divisor stays on the PRICE path and never reaches the return path', () => {
    const source = read('hooks/useFxData.ts')
    // Golden invariant (also pinned by lib/market/usd-conversion.test.ts): ÷100 converts a price.
    expect(source).toMatch(/rate:\s*quote\.price\s*\/\s*divisor/)
    expect(source).not.toMatch(/return[\w.]*\s*\/\s*100/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// A-3 — `updateWatchlist` column allowlist
// ══════════════════════════════════════════════════════════════════════════════

describe('A-3: updateWatchlist writes only allowlisted columns', () => {
  it('passes through the three editable columns', () => {
    expect(pickWatchlistUpdates({ name: 'Core', description: null, selected_metrics: ['1Y'] as never }))
      .toEqual({ name: 'Core', description: null, selected_metrics: ['1Y'] })
  })

  it('DROPS ownership and identity columns', () => {
    const hostile = {
      name: 'Core',
      user_id: 'someone-else',
      id: 'another-watchlist',
      created_at: '1970-01-01',
      updated_at: '1970-01-01',
    } as unknown as Partial<Watchlist>
    const patch = pickWatchlistUpdates(hostile)
    expect(patch).toEqual({ name: 'Core' })
    for (const column of ['user_id', 'id', 'created_at', 'updated_at']) {
      expect(Object.prototype.hasOwnProperty.call(patch, column), `${column} leaked`).toBe(false)
    }
  })

  it('drops an unknown column entirely', () => {
    expect(pickWatchlistUpdates({ totally_made_up: 1 } as unknown as Partial<Watchlist>)).toEqual({})
  })

  it('rejects a value of the wrong shape rather than forwarding it', () => {
    expect(pickWatchlistUpdates({ name: 42 } as unknown as Partial<Watchlist>)).toEqual({})
    expect(pickWatchlistUpdates({ selected_metrics: 'all' } as unknown as Partial<Watchlist>)).toEqual({})
  })

  it('treats an explicit `undefined` as "not provided", not as "set to null"', () => {
    expect(pickWatchlistUpdates({ name: undefined })).toEqual({})
  })

  it('the allowlist is exactly the user-editable set', () => {
    expect([...WATCHLIST_UPDATABLE_COLUMNS]).toEqual(['name', 'description', 'selected_metrics'])
  })

  it('the hook sends the PROJECTION to supabase, not the caller object', () => {
    const source = read('hooks/useWatchlistAssets.ts')
    expect(source).toMatch(/const patch = pickWatchlistUpdates\(updates\)/)
    expect(source).toMatch(/\.update\(patch\)/)
    // The old `.update(updates)` must be gone.
    expect(source).not.toMatch(/\.update\(updates\)/)
  })
})
