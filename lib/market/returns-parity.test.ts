/**
 * THE VERDICT THIS PR WAS ASKED TO REACH, FROZEN.
 *
 * The plan said: "migrate `usePerformanceMetrics` and `useTopPerformers` to the POST bulk".
 * The bulk endpoint's existing product is `calculateMultiReturns`, which DERIVES 1W/1M/6M/YTD/1Y
 * from ONE `range=1y` series. The watchlist's product is `calculateReturn`, which asks Yahoo for a
 * DIFFERENT `range=` per period. If the two agree, one cache entry can serve both consumers. If
 * they disagree, reusing the derived values silently restates every figure on the watchlist.
 *
 * They disagree. This file measures it on the golden fixtures and pins the result, so the shortcut
 * can never be taken by accident later. The second half pins the explicit result state (REL-08)
 * that lets the caching layer tell "Yahoo has nothing" apart from "Yahoo failed".
 *
 * Nothing here touches the network: `fetch` is stubbed and `yahoo-finance2` is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FIVE_YEAR_SERIES, ONE_YEAR_SERIES, SHORT_SERIES, toChartPayload } from './__fixtures__/series'

const quoteSummaryMock = vi.fn()
vi.mock('yahoo-finance2', () => ({
  default: class {
    quoteSummary = quoteSummaryMock
  },
}))

const {
  calculateReturn,
  calculateReturnDetailed,
  calculateMultiReturns,
  fetchCalendarYearReturnDetailed,
  fetchHistorySeries,
} = await import('./history')

// ── A realistic per-range Yahoo server ───────────────────────────────────────
//
// Each `range=` gets the window Yahoo would actually return for it, sliced out of the SAME price
// history. That is the whole point: identical prices, different windows.

const from = (iso: string) => FIVE_YEAR_SERIES.filter((p) => p.date >= iso)
const lastN = (n: number) => FIVE_YEAR_SERIES.slice(-n)

/** `range=1y` is literally `ONE_YEAR_SERIES` (the fixture is built as that tail). */
const RANGE_BODY: Record<string, unknown> = {
  '1y': toChartPayload(ONE_YEAR_SERIES),
  '5d': toChartPayload(lastN(5)),            // one trading week
  '1mo': toChartPayload(from('2025-12-01')), // one calendar month
  '6mo': toChartPayload(from('2025-07-01')), // six calendar months
  // Yahoo's `range=ytd` opens on the PRIOR year-end close, which is why YTD is the biggest gap.
  ytd: toChartPayload(from('2024-12-31')),
}

let calls: string[]

function stubRanges(bodies: Record<string, unknown> = RANGE_BODY) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      const range = new URL(url).searchParams.get('range') ?? ''
      const body = bodies[range]
      const ok = body !== undefined
      return { ok, status: ok ? 200 : 404, json: async () => body } as unknown as Response
    })
  )
}

beforeEach(() => {
  quoteSummaryMock.mockReset()
  quoteSummaryMock.mockResolvedValue({})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ══════════════════════════════════════════════════════════════════════════════
// 🚩 THE VERDICT
// ══════════════════════════════════════════════════════════════════════════════

/** Measured on the current implementation, over the fixtures above. NOT guesses. */
const DERIVED = {
  '1W': 0.38461538461538336,
  '1M': 1.714731098986748,
  '6M': 11.063829787234045,
  YTD: 24.88038277511962,
  '1Y': 24.999999999999993,
} as const

const PER_PERIOD = {
  '1W': 0.30745580322829164,
  '1M': 1.714731098986748,
  '6M': 11.158432708688238,
  YTD: 24.999999999999993,
  '1Y': 24.999999999999993,
} as const

describe('🚩 derived (one 1Y series) vs per-period (one range= each)', () => {
  it('produces the frozen derived bundle from a single request', async () => {
    stubRanges()
    const { returns } = await calculateMultiReturns('TEST')
    expect(calls).toHaveLength(1)
    for (const period of ['1W', '1M', '6M', 'YTD', '1Y'] as const) {
      expect(returns[period], `derived ${period}`).toBeCloseTo(DERIVED[period], 12)
    }
  })

  it('produces the frozen per-period figures from one request per period', async () => {
    for (const period of ['1W', '1M', '6M', 'YTD', '1Y'] as const) {
      stubRanges()
      const r = await calculateReturn('TEST', period, 0)
      expect(calls).toHaveLength(1)
      expect(r.value, `per-period ${period}`).toBeCloseTo(PER_PERIOD[period], 12)
    }
  })

  it('DISAGREES on 1W, 6M and YTD — so the two must never share a cache key', () => {
    // These are the numbers the two semantics produce for the SAME prices. The gap is small in
    // absolute terms and permanent in nature: different date anchors, not rounding.
    const gaps = {
      '1W': DERIVED['1W'] - PER_PERIOD['1W'], //  +0.0772 pp
      '6M': DERIVED['6M'] - PER_PERIOD['6M'], //  -0.0946 pp
      YTD: DERIVED.YTD - PER_PERIOD.YTD, //       -0.1196 pp
    }
    expect(gaps['1W']).toBeCloseTo(0.07715958138709172, 12)
    expect(gaps['6M']).toBeCloseTo(-0.09460292145419329, 12)
    expect(gaps.YTD).toBeCloseTo(-0.11961722488037303, 12)
    for (const [period, gap] of Object.entries(gaps)) {
      expect(Math.abs(gap), `${period} must differ`).toBeGreaterThan(1e-9)
    }
  })

  it('agrees on 1Y, and on 1M only by coincidence of this fixture', () => {
    // 1Y: the derived window IS `range=1y`, so agreement is structural.
    expect(DERIVED['1Y']).toBeCloseTo(PER_PERIOD['1Y'], 12)
    // 1M: the derived target (endMs − 30 days) happens to land on the same bar `range=1mo` opens
    // on. That is a property of THIS calendar, not a rule. It must not be read as "1M is safe".
    expect(DERIVED['1M']).toBeCloseTo(PER_PERIOD['1M'], 12)
  })

  it('YTD is the largest gap because the two anchors are different DAYS', async () => {
    // Derived YTD anchors on the first bar OF the year; Yahoo's `range=ytd` opens on the prior
    // year-end close. One extra bar, ~0.12 pp, on every non-USD and USD asset alike.
    stubRanges()
    const { returns } = await calculateMultiReturns('TEST')
    stubRanges()
    const own = await calculateReturn('TEST', 'YTD', 0)
    expect(returns.YTD).not.toBeCloseTo(own.value as number, 6)
  })
})

describe('the consumers therefore read different keys', () => {
  it('the bulk route namespaces per-period values under `perf:` and years under `cy:`', async () => {
    // A source-level guard: the prefixes are the contract between the route and the two hooks.
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const root = resolve(__dirname, '../..')
    const route = readFileSync(resolve(root, 'app/api/market/returns/route.ts'), 'utf8')
    expect(route).toMatch(/PERF_PREFIX\s*=\s*'perf:'/)
    expect(route).toMatch(/CY_PREFIX\s*=\s*'cy:'/)

    const hook = readFileSync(resolve(root, 'hooks/usePerformanceMetrics.ts'), 'utf8')
    expect(hook).toMatch(/PERF_PREFIX\s*=\s*'perf:'/)
    expect(hook).toMatch(/CY_PREFIX\s*=\s*'cy:'/)
    // The watchlist must never read a bare derived key.
    expect(hook).toMatch(/perfKey\(/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Explicit result state (REL-08) — "no data" is not "the provider failed"
// ══════════════════════════════════════════════════════════════════════════════

describe('fetchHistorySeries reports WHY it is empty', () => {
  it('ok, with the bars, on a healthy response', async () => {
    stubRanges()
    const r = await fetchHistorySeries('TEST', '1Y')
    expect(r.status).toBe('ok')
    expect(r.provider).toBe('yahoo')
    expect(r.data).toHaveLength(ONE_YEAR_SERIES.length)
  })

  it('no_data for a structurally valid response with nothing usable in it', async () => {
    stubRanges({ '1y': { chart: { result: [] } } })
    const r = await fetchHistorySeries('TEST', '1Y', { maxAttempts: 1 })
    expect(r.status).toBe('no_data')
    expect(r.data).toEqual([])
  })

  it('provider_error for an HTTP failure', async () => {
    stubRanges({}) // every range 404s
    const r = await fetchHistorySeries('TEST', '1Y', { maxAttempts: 1 })
    expect(r.status).toBe('provider_error')
  })

  it('provider_error for a timeout / abort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('aborted')
      err.name = 'TimeoutError'
      throw err
    }))
    const r = await fetchHistorySeries('TEST', '1Y', { maxAttempts: 1 })
    expect(r.status).toBe('provider_error')
  })

  it('provider_error, with ZERO attempts, when the deadline has already passed', async () => {
    stubRanges()
    const r = await fetchHistorySeries('TEST', '1Y', { deadlineMs: Date.now() - 1 })
    expect(r.status).toBe('provider_error')
    expect(r.attempts).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('no_data — never provider_error — for an unknown period, and asks nobody', async () => {
    stubRanges()
    const r = await fetchHistorySeries('TEST', 'BOGUS' as never)
    expect(r.status).toBe('no_data')
    expect(r.provider).toBe('none')
    expect(calls).toHaveLength(0)
  })

  it('never leaks the state into the back-compatible view', async () => {
    // `fetchHistoricalData` must still be exactly "the bars", so the chart route is untouched.
    const { fetchHistoricalData } = await import('./history')
    stubRanges()
    const bars = await fetchHistoricalData('TEST', '1Y')
    expect(Array.isArray(bars)).toBe(true)
    expect(bars).toHaveLength(ONE_YEAR_SERIES.length)
  })
})

describe('calculateReturnDetailed carries the state onto the figure', () => {
  it('ok + the same value `calculateReturn` returns', async () => {
    stubRanges()
    const detailed = await calculateReturnDetailed('TEST', '6M')
    stubRanges()
    const plain = await calculateReturn('TEST', '6M', 0)
    expect(detailed.status).toBe('ok')
    expect(detailed.value).toBe(plain.value)
    expect(detailed.years).toBe(plain.years)
  })

  it('no_data when the series is too short to measure, not provider_error', async () => {
    // A single bar: Yahoo answered fine, there is just nothing to measure.
    stubRanges({ '6mo': toChartPayload([SHORT_SERIES[0]]) })
    const r = await calculateReturnDetailed('TEST', '6M', { maxAttempts: 1 })
    expect(r.value).toBeNull()
    expect(r.status).toBe('no_data')
  })

  it('provider_error survives to the caller — this is what may NOT be cached', async () => {
    stubRanges({})
    const r = await calculateReturnDetailed('TEST', '6M', { maxAttempts: 1 })
    expect(r.value).toBeNull()
    expect(r.status).toBe('provider_error')
  })
})

describe('fetchCalendarYearReturnDetailed', () => {
  it('ok from the fund module, scaled from a decimal', async () => {
    quoteSummaryMock.mockResolvedValue({
      fundPerformance: { annualTotalReturns: { returns: [{ year: '2024', annualValue: 0.1234 }] } },
    })
    const r = await fetchCalendarYearReturnDetailed('TEST', 2024)
    expect(r.status).toBe('ok')
    expect(r.provider).toBe('yahoo-finance2')
    expect(r.value).toBeCloseTo(12.34, 10)
  })

  it('provider_error when the price fallback gets an HTTP failure', async () => {
    quoteSummaryMock.mockResolvedValue({})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response))
    const r = await fetchCalendarYearReturnDetailed('TEST', 2024)
    expect(r.value).toBeNull()
    expect(r.status).toBe('provider_error')
  })

  it('no_data when the year genuinely has fewer than two usable closes', async () => {
    quoteSummaryMock.mockResolvedValue({})
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ chart: { result: [{ indicators: { quote: [{ close: [100, null] }] } }] } }),
    }) as unknown as Response))
    const r = await fetchCalendarYearReturnDetailed('TEST', 2024)
    expect(r.value).toBeNull()
    expect(r.status).toBe('no_data')
  })

  it('no_data, and asks nobody, for an out-of-range year', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await fetchCalendarYearReturnDetailed('TEST', 999_999_999)
    expect(r.status).toBe('no_data')
    expect(r.provider).toBe('none')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(quoteSummaryMock).not.toHaveBeenCalled()
  })
})
