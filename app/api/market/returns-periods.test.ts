/**
 * `POST /api/market/returns` — the variable-period mode.
 *
 * What has to hold:
 *   · An unknown period or a junk year is a 400, never a silent substitution.
 *   · Per-period values live under `perf:` / `cy:`, NEVER under the bare derived keys — the two
 *     are different numbers (see `lib/market/returns-parity.test.ts`).
 *   · Freshness is decided PER KEY by its own timestamp, so a variable period set cannot be
 *     declared healthy by the `1Y` anchor alone.
 *   · The derived bundle's own TTL clock (`fetched_at`) is never advanced by this mode.
 *   · Accepting many tickers never means fetching all of them: the budget defers, last-good fills.
 *   · A provider failure is not cached; a genuine empty is.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { getUser, calculateReturnDetailed, fetchCalendarYearReturnDetailed, calculateMultiReturns } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    calculateReturnDetailed: vi.fn(),
    fetchCalendarYearReturnDetailed: vi.fn(),
    calculateMultiReturns: vi.fn(),
  }))

/** Rows the fake cache serves, and the upserts it recorded. */
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createCacheClient: () => ({
    client: {
      from: () => ({
        select: () => ({ in: async () => ({ data: db.rows, error: null }) }),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          db.upserts.push(...rows)
          return { error: null }
        },
      }),
    },
    canWrite: true,
  }),
  createServiceRoleClient: () => ({}),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))

vi.mock('@/lib/market/history', () => ({
  calculateReturnDetailed,
  fetchCalendarYearReturnDetailed,
  calculateMultiReturns,
  // Present so the module shape matches; unused by this suite.
  calculateReturn: vi.fn(),
  fetchHistoricalData: vi.fn(),
  fetchCalendarYearReturn: vi.fn(),
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/market/returns/route'

const post = (body: unknown) =>
  new NextRequest('https://example.test/api/market/returns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

let savedSecret: string | undefined

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  db.rows = []
  db.upserts = []
  getUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
  calculateReturnDetailed.mockImplementation(async (ticker: string, period: string) => ({
    value: 10, years: 1, status: 'ok', provider: 'yahoo', attempts: 1, ticker, period,
  }))
  fetchCalendarYearReturnDetailed.mockResolvedValue({ value: 7.5, status: 'ok', provider: 'yahoo' })
  calculateMultiReturns.mockResolvedValue({
    returns: { '1W': 1, '1M': 2, '6M': 3, YTD: 4, '1Y': 5 },
    years: { '1W': 0.02, '1M': 0.08, '6M': 0.5, YTD: 1, '1Y': 1 },
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  vi.restoreAllMocks()
})

// ══════════════════════════════════════════════════════════════════════════════
// Validation
// ══════════════════════════════════════════════════════════════════════════════

describe('period validation', () => {
  it('400s an unknown period and reaches NOTHING upstream', async () => {
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y', 'BOGUS'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid period' })
    expect(calculateReturnDetailed).not.toHaveBeenCalled()
    expect(calculateMultiReturns).not.toHaveBeenCalled()
  })

  it('400s a junk calendar year instead of parseInt-ing it', async () => {
    const res = await POST(post({ tickers: ['AAPL'], calendarYears: ['2024junk'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid calendar year' })
    expect(fetchCalendarYearReturnDetailed).not.toHaveBeenCalled()
  })

  it('400s an unbounded calendar year', async () => {
    const res = await POST(post({ tickers: ['AAPL'], calendarYears: [999999999] }))
    expect(res.status).toBe(400)
  })

  it('400s a non-array `periods`', async () => {
    const res = await POST(post({ tickers: ['AAPL'], periods: '3Y' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/array/)
  })

  it('400s more keys than any real client would ask for', async () => {
    const res = await POST(
      post({ tickers: ['AAPL'], periods: ['1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'], calendarYears: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Too many/)
  })

  it('accepts all 9 periods + 7 calendar years — the real worst case', async () => {
    const res = await POST(post({
      tickers: ['AAPL'],
      periods: ['1W', '1M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'],
      calendarYears: [2025, 2024, 2023, 2022, 2021, 2020, 2019],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body.AAPL.returns).sort()).toEqual(
      [
        'cy:2019', 'cy:2020', 'cy:2021', 'cy:2022', 'cy:2023', 'cy:2024', 'cy:2025',
        'perf:10Y', 'perf:1M', 'perf:1W', 'perf:1Y', 'perf:3Y', 'perf:5Y', 'perf:6M', 'perf:MAX', 'perf:YTD',
      ].sort()
    )
  })

  it('de-duplicates a repeated period instead of fetching it twice', async () => {
    await POST(post({ tickers: ['AAPL'], periods: ['3Y', '3Y', '3Y'] }))
    expect(calculateReturnDetailed).toHaveBeenCalledTimes(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Namespacing: no cross-contamination between the two consumers
// ══════════════════════════════════════════════════════════════════════════════

describe('the two consumers never read each other', () => {
  it('per-period values come back under `perf:`, computed by calculateReturnDetailed', async () => {
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    const body = await res.json()
    expect(body.AAPL.returns['perf:3Y']).toBe(10)
    expect(body.AAPL.returns['3Y']).toBeUndefined()
    expect(calculateReturnDetailed).toHaveBeenCalledWith('AAPL', '3Y', expect.objectContaining({ cid: expect.any(String) }))
    // The derived path must not be involved at all.
    expect(calculateMultiReturns).not.toHaveBeenCalled()
  })

  it('a derived cache entry does NOT satisfy a `perf:` request for the same period', async () => {
    // The trap this whole PR exists to avoid: `1W` is cached and fresh, but it is the DERIVED 1W.
    db.rows = [{
      ticker: 'AAPL',
      returns: { '1W': 0.38461538461538336, '1M': 2, '6M': 3, YTD: 4, '1Y': 5 },
      years: { '1W': 0.019 },
      fetched_at: new Date().toISOString(),
    }]
    const res = await POST(post({ tickers: ['AAPL'], periods: ['1W'] }))
    const body = await res.json()
    expect(calculateReturnDetailed).toHaveBeenCalledTimes(1)
    expect(body.AAPL.returns['perf:1W']).toBe(10)
    expect(body.AAPL.returns['perf:1W']).not.toBe(0.38461538461538336)
  })

  it('the derived mode projects ONLY the five derived keys — `perf:`/`ts:` never leak out', async () => {
    db.rows = [{
      ticker: 'AAPL',
      returns: { '1W': 1, '1M': 2, '6M': 3, YTD: 4, '1Y': 5, 'perf:3Y': 99, 'ts:perf:3Y': Date.now() },
      years: { '1Y': 1, 'perf:3Y': 3 },
      fetched_at: new Date().toISOString(),
    }]
    const res = await POST(post({ tickers: ['AAPL'] }))
    const body = await res.json()
    expect(body.AAPL.returns).toEqual({ '1W': 1, '1M': 2, '6M': 3, YTD: 4, '1Y': 5 })
    expect(body.AAPL.years).toEqual({ '1Y': 1 })
  })

  it('a derived refresh MERGES, so it cannot wipe the watchlist keys in the same row', async () => {
    db.rows = [{
      ticker: 'AAPL',
      returns: { '1Y': null, 'perf:3Y': 99, 'ts:perf:3Y': 1234 },
      years: { 'perf:3Y': 3 },
      fetched_at: new Date(0).toISOString(),
    }]
    await POST(post({ tickers: ['AAPL'] }))
    expect(db.upserts).toHaveLength(1)
    const written = db.upserts[0].returns as Record<string, number | null>
    expect(written['perf:3Y']).toBe(99)
    expect(written['ts:perf:3Y']).toBe(1234)
    expect(written['1Y']).toBe(5) // the fresh derived value
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Per-key freshness (what the `1Y` anchor could not do)
// ══════════════════════════════════════════════════════════════════════════════

describe('freshness is decided per key, by its own timestamp', () => {
  it('serves a `perf:` key from cache when its own timestamp is fresh', async () => {
    db.rows = [{
      ticker: 'AAPL',
      returns: { 'perf:3Y': 42, 'ts:perf:3Y': Date.now() - 60_000 },
      years: { 'perf:3Y': 3 },
      fetched_at: new Date(0).toISOString(),
    }]
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect(calculateReturnDetailed).not.toHaveBeenCalled()
    expect((await res.json()).AAPL.returns['perf:3Y']).toBe(42)
  })

  it('refetches a `perf:` key whose timestamp is past its 1 h TTL', async () => {
    db.rows = [{
      ticker: 'AAPL',
      returns: { 'perf:3Y': 42, 'ts:perf:3Y': Date.now() - 2 * 60 * 60_000 },
      years: {},
      fetched_at: new Date().toISOString(),
    }]
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect(calculateReturnDetailed).toHaveBeenCalledTimes(1)
    expect((await res.json()).AAPL.returns['perf:3Y']).toBe(10)
  })

  it('refetches a key with a value but NO timestamp (a row written before this feature)', async () => {
    db.rows = [{ ticker: 'AAPL', returns: { 'perf:3Y': 42 }, years: {}, fetched_at: new Date().toISOString() }]
    await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect(calculateReturnDetailed).toHaveBeenCalledTimes(1)
  })

  it('a fresh null is authoritative: a KNOWN empty is not re-asked (no amplifier)', async () => {
    // A fund younger than 10Y legitimately has no value. Re-asking every request is the bug.
    db.rows = [{
      ticker: 'AAPL',
      returns: { 'perf:10Y': null, 'ts:perf:10Y': Date.now() - 1000 },
      years: {},
      fetched_at: new Date(0).toISOString(),
    }]
    const res = await POST(post({ tickers: ['AAPL'], periods: ['10Y'] }))
    expect(calculateReturnDetailed).not.toHaveBeenCalled()
    expect((await res.json()).AAPL.returns['perf:10Y']).toBeNull()
  })

  it('a CLOSED calendar year keeps its long TTL; the CURRENT year does not', async () => {
    const currentYear = new Date().getUTCFullYear()
    const sevenHoursAgo = Date.now() - 7 * 60 * 60_000
    db.rows = [{
      ticker: 'AAPL',
      returns: {
        [`cy:${currentYear - 1}`]: 11, [`ts:cy:${currentYear - 1}`]: sevenHoursAgo,
        [`cy:${currentYear}`]: 22, [`ts:cy:${currentYear}`]: sevenHoursAgo,
      },
      years: {},
      fetched_at: new Date(0).toISOString(),
    }]
    const res = await POST(post({ tickers: ['AAPL'], calendarYears: [currentYear - 1, currentYear] }))
    // Only the current year was refetched.
    expect(fetchCalendarYearReturnDetailed).toHaveBeenCalledTimes(1)
    expect(fetchCalendarYearReturnDetailed).toHaveBeenCalledWith('AAPL', currentYear, expect.anything())
    const body = await res.json()
    expect(body.AAPL.returns[`cy:${currentYear - 1}`]).toBe(11) // untouched
    expect(body.AAPL.returns[`cy:${currentYear}`]).toBe(7.5) // refreshed
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// The derived bundle's TTL clock is not collateral damage
// ══════════════════════════════════════════════════════════════════════════════

describe('`fetched_at` belongs to the derived bundle alone', () => {
  it('a per-period write never advances it', async () => {
    const original = new Date(Date.now() - 5 * 60 * 60_000).toISOString()
    db.rows = [{ ticker: 'AAPL', returns: { '1Y': 5 }, years: { '1Y': 1 }, fetched_at: original }]
    await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect(db.upserts).toHaveLength(1)
    // Bumping this would have made a 5-hour-old PEER bundle look fresh for another 6 h.
    expect(db.upserts[0].fetched_at).toBe(original)
  })

  it('a brand-new row gets epoch 0, so its (absent) derived bundle reads as stale', async () => {
    await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect(db.upserts[0].fetched_at).toBe(new Date(0).toISOString())
  })

  it('writes the value AND its timestamp together', async () => {
    await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    const written = db.upserts[0].returns as Record<string, number | null>
    expect(written['perf:3Y']).toBe(10)
    expect(typeof written['ts:perf:3Y']).toBe('number')
    expect((db.upserts[0].years as Record<string, number>)['perf:3Y']).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Input limit ≠ execution limit
// ══════════════════════════════════════════════════════════════════════════════

describe('fan-out is budgeted, not proportional to the input', () => {
  it('still accepts 1500 tickers but never launches 1500 × keys fetches', async () => {
    const tickers = Array.from({ length: 1500 }, (_, i) => `TCK${i}`)
    const res = await POST(post({ tickers, periods: ['3Y', '5Y'] }))
    expect(res.status).toBe(200)
    // 3000 work items in; at most the 600-item budget goes out.
    expect(calculateReturnDetailed.mock.calls.length).toBeLessThanOrEqual(600)
    expect(calculateReturnDetailed.mock.calls.length).toBeGreaterThan(0)
    // Every ticker still gets an answer (last-good / null), so nothing is missing from the map.
    expect(Object.keys(await res.json())).toHaveLength(1500)
  })

  it('a deferred key falls back to its last-good value rather than blanking', async () => {
    const tickers = Array.from({ length: 1500 }, (_, i) => `TCK${i}`)
    // Give the LAST ticker (sorted to the back of the work queue by its timestamp) a cached value.
    db.rows = [{
      ticker: 'TCK1499',
      returns: { 'perf:3Y': 77, 'ts:perf:3Y': Date.now() - 2 * 60 * 60_000 },
      years: { 'perf:3Y': 3 },
      fetched_at: new Date(0).toISOString(),
    }]
    const res = await POST(post({ tickers, periods: ['3Y'] }))
    const body = await res.json()
    expect(body.TCK1499.returns['perf:3Y']).toBe(77)
  })

  it('a deferred key with no history at all is null, not absent', async () => {
    const tickers = Array.from({ length: 1500 }, (_, i) => `TCK${i}`)
    const res = await POST(post({ tickers, periods: ['3Y'] }))
    const body = await res.json()
    for (const ticker of ['TCK0', 'TCK1499']) {
      expect(Object.prototype.hasOwnProperty.call(body[ticker].returns, 'perf:3Y')).toBe(true)
    }
  })

  it('never-fetched keys are worked before merely-stale ones', async () => {
    db.rows = [{
      ticker: 'STALE',
      returns: { 'perf:3Y': 1, 'ts:perf:3Y': Date.now() - 2 * 60 * 60_000 },
      years: {},
      fetched_at: new Date(0).toISOString(),
    }]
    await POST(post({ tickers: ['STALE', 'FRESHLY_UNKNOWN'], periods: ['3Y'] }))
    const order = calculateReturnDetailed.mock.calls.map((c) => c[0])
    expect(order[0]).toBe('FRESHLY_UNKNOWN')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// provider_error vs no_data — the whole point of the explicit state
// ══════════════════════════════════════════════════════════════════════════════

describe('a provider failure is not cached; a genuine empty is', () => {
  it('provider_error serves last-good and writes NOTHING', async () => {
    db.rows = [{
      ticker: 'AAPL',
      returns: { 'perf:3Y': 55, 'ts:perf:3Y': Date.now() - 2 * 60 * 60_000 },
      years: { 'perf:3Y': 3 },
      fetched_at: new Date(0).toISOString(),
    }]
    calculateReturnDetailed.mockResolvedValue({ value: null, years: null, status: 'provider_error', provider: 'yahoo', attempts: 3 })
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect((await res.json()).AAPL.returns['perf:3Y']).toBe(55)
    // No timestamp bump → the next request retries instead of pinning a null for an hour.
    expect(db.upserts).toHaveLength(0)
  })

  it('provider_error with no history at all is null (there is nothing better to say)', async () => {
    calculateReturnDetailed.mockResolvedValue({ value: null, years: null, status: 'provider_error', provider: 'yahoo', attempts: 3 })
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect((await res.json()).AAPL.returns['perf:3Y']).toBeNull()
    expect(db.upserts).toHaveLength(0)
  })

  it('no_data on a NEW key caches the null, so we stop asking for an hour', async () => {
    calculateReturnDetailed.mockResolvedValue({ value: null, years: null, status: 'no_data', provider: 'yahoo', attempts: 1 })
    const res = await POST(post({ tickers: ['AAPL'], periods: ['10Y'] }))
    expect((await res.json()).AAPL.returns['perf:10Y']).toBeNull()
    const written = db.upserts[0].returns as Record<string, number | null>
    expect(written['perf:10Y']).toBeNull()
    expect(typeof written['ts:perf:10Y']).toBe('number')
  })

  it('no_data does NOT overwrite a known-good figure, but does refresh its timestamp', async () => {
    // An HTTP-200-with-empty-result is a documented Yahoo degradation, so it may not blank a
    // figure that was previously good — while still suppressing the retry storm.
    db.rows = [{
      ticker: 'AAPL',
      returns: { 'perf:3Y': 55, 'ts:perf:3Y': Date.now() - 2 * 60 * 60_000 },
      years: { 'perf:3Y': 3 },
      fetched_at: new Date(0).toISOString(),
    }]
    calculateReturnDetailed.mockResolvedValue({ value: null, years: null, status: 'no_data', provider: 'yahoo', attempts: 1 })
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect((await res.json()).AAPL.returns['perf:3Y']).toBe(55)
    const written = db.upserts[0].returns as Record<string, number | null>
    expect(written['perf:3Y']).toBe(55)
    expect(written['ts:perf:3Y']).not.toBe(Date.now() - 2 * 60 * 60_000)
  })

  it('a thrown calculator degrades to last-good and is not cached', async () => {
    db.rows = [{
      ticker: 'AAPL',
      returns: { 'perf:3Y': 55, 'ts:perf:3Y': 0 },
      years: {},
      fetched_at: new Date(0).toISOString(),
    }]
    calculateReturnDetailed.mockRejectedValue(new Error('boom'))
    const res = await POST(post({ tickers: ['AAPL'], periods: ['3Y'] }))
    expect(res.status).toBe(200)
    expect((await res.json()).AAPL.returns['perf:3Y']).toBe(55)
    expect(db.upserts).toHaveLength(0)
  })
})
