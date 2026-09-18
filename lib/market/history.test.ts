/**
 * GOLDEN TESTS — `lib/market/history.ts`
 *
 * These pin the exact numbers the watchlist shows. The next PR replaces the fetching layer with a
 * bulk endpoint; the figures on screen must come out byte-identical afterwards. Every expectation
 * below is a measured value of the CURRENT implementation over a frozen fixture, not a guess.
 *
 * Nothing here touches the network: `fetch` is stubbed and `yahoo-finance2` is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FIVE_YEAR_SERIES,
  ONE_YEAR_SERIES,
  SHORT_SERIES,
  SINGLE_POINT_SERIES,
  EMPTY_SERIES,
  YEAR_BOUNDARY_SERIES,
  GAPPY_PAYLOAD,
  GAPPY_EXPECTED,
  MIXED_TIMESTAMP_PAYLOAD,
  MIXED_TIMESTAMP_EXPECTED,
  DEGRADED_PAYLOADS,
  toChartPayload,
} from './__fixtures__/series'

// ── yahoo-finance2 mock ───────────────────────────────────────────────────────
// `history.ts` builds the client at module scope, so the mock must exist before the import.
const quoteSummaryMock = vi.fn()
vi.mock('yahoo-finance2', () => ({
  default: class {
    quoteSummary = quoteSummaryMock
  },
}))

const { fetchHistoricalData, calculateReturn, calculateMultiReturns, fetchCalendarYearReturn, MULTI_RETURN_PERIODS } =
  await import('./history')

// ── fetch stub ────────────────────────────────────────────────────────────────

type Responder = (url: string) => { status?: number; body?: unknown } | undefined

let fetchMock: ReturnType<typeof vi.fn>
let calls: string[]

/** Installs a fetch stub that routes on the request URL. Unmatched URLs 404. */
function stubFetch(responder: Responder) {
  calls = []
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    const hit = responder(url) ?? { status: 404 }
    const status = hit.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => hit.body,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
}

/** Serves one payload for every range. */
const always = (body: unknown): Responder => () => ({ body })

/** Serves a different payload per Yahoo `range=` value. */
function byRange(map: Record<string, unknown>, fallback?: unknown): Responder {
  return (url) => {
    const range = new URL(url).searchParams.get('range') ?? ''
    if (range in map) return { body: map[range] }
    return fallback === undefined ? undefined : { body: fallback }
  }
}

beforeEach(() => {
  quoteSummaryMock.mockReset()
  // Silence the structured `[evolve]` warn lines the degraded paths emit on purpose.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ══════════════════════════════════════════════════════════════════════════════
// parseChart — exercised through `fetchHistoricalData` (it is module-private).
// `maxAttempts: 1` skips the retry backoff; these cases are about the parse, not the retry.
// ══════════════════════════════════════════════════════════════════════════════

describe('parseChart (via fetchHistoricalData)', () => {
  it('parses a healthy payload into every bar, preserving dates and closes', async () => {
    stubFetch(always(toChartPayload(YEAR_BOUNDARY_SERIES)))
    const out = await fetchHistoricalData('TEST', '1Y')
    expect(out).toHaveLength(YEAR_BOUNDARY_SERIES.length)
    expect(out[0].date).toBe('2024-12-16')
    expect(out[out.length - 1].date).toBe('2025-01-17')
    expect(out[out.length - 1].close).toBeCloseTo(220, 10)
  })

  it('falls back from a null adjclose to quote.close and drops non-positive bars', async () => {
    stubFetch(always(GAPPY_PAYLOAD))
    const out = await fetchHistoricalData('TEST', '1M')
    expect(out.map((p) => ({ date: p.date, close: p.close }))).toEqual(GAPPY_EXPECTED)
  })

  it('drops non-finite timestamps WITHOUT shifting the close indices', async () => {
    // An off-by-one here would re-date every price in the app, silently.
    stubFetch(always(MIXED_TIMESTAMP_PAYLOAD))
    const out = await fetchHistoricalData('TEST', '1M')
    expect(out.map((p) => ({ date: p.date, close: p.close }))).toEqual(MIXED_TIMESTAMP_EXPECTED)
  })

  it.each(DEGRADED_PAYLOADS)('returns [] and never throws for: $name', async ({ payload }) => {
    // PR2 hardened this. A throw escapes the retry loop and becomes a 500 on /api/market/history.
    stubFetch(always(payload))
    await expect(fetchHistoricalData('TEST', '1Y', { maxAttempts: 1 })).resolves.toEqual([])
  })

  it('returns [] when the body is not JSON at all', async () => {
    calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') } }) as unknown as Response)
    )
    await expect(fetchHistoricalData('TEST', '1Y', { maxAttempts: 1 })).resolves.toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Range / interval mapping — a fetching refactor that changes these changes the numbers.
// ══════════════════════════════════════════════════════════════════════════════

describe('Yahoo range/interval mapping', () => {
  const EXPECTED: Array<[string, string, string]> = [
    ['1W', '5d', '1d'],
    ['1M', '1mo', '1d'],
    ['6M', '6mo', '1d'],
    ['1Y', '1y', '1d'],
    ['3Y', '3y', '1d'],
    ['5Y', '5y', '1d'],
    ['YTD', 'ytd', '1d'],
    ['10Y', '10y', '1d'],
    // MAX is the ONLY period on a quarterly interval. Switching it to 1d would change both the
    // datapoint count and the MAX return's endpoints.
    ['MAX', 'max', '3mo'],
  ]

  it.each(EXPECTED)('%s → range=%s & interval=%s', async (period, range, interval) => {
    stubFetch(always(toChartPayload(FIVE_YEAR_SERIES)))
    await fetchHistoricalData('TEST', period as never)
    expect(calls).toHaveLength(1)
    const q = new URL(calls[0]).searchParams
    expect(q.get('range')).toBe(range)
    expect(q.get('interval')).toBe(interval)
    expect(q.get('includePrePost')).toBe('false')
  })

  it('percent-encodes exotic tickers instead of splicing them raw into the URL', async () => {
    stubFetch(always(toChartPayload(FIVE_YEAR_SERIES)))
    await fetchHistoricalData('^GSPC', '1Y')
    expect(calls[0]).toContain('/chart/%5EGSPC?')
  })

  it('returns [] without any request for an unknown period', async () => {
    stubFetch(always(toChartPayload(FIVE_YEAR_SERIES)))
    await expect(fetchHistoricalData('TEST', 'NOPE' as never)).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// calculateReturn — cumulative %, plus the REAL elapsed years of the fetched window.
// ══════════════════════════════════════════════════════════════════════════════

describe('calculateReturn', () => {
  it('measures first→last close of whatever Yahoo returned for that range', async () => {
    stubFetch(always(toChartPayload(FIVE_YEAR_SERIES)))
    const r = await calculateReturn('TEST', '5Y', 999)
    // 100 → 171.6 over the whole fixture.
    expect(r.value).toBeCloseTo(71.6, 10)
    // Real elapsed years — 2020-12-31 → 2025-12-31 measured against 365.25-day years.
    expect(r.years).toBeCloseTo(4.999315537303217, 12)
  })

  it('ignores the live price argument entirely (adjclose on both ends)', async () => {
    // Mixing an adjclose base with an unadjusted live price inflates dividend payers.
    stubFetch(always(toChartPayload(ONE_YEAR_SERIES)))
    const a = await calculateReturn('TEST', '1Y', 1)
    stubFetch(always(toChartPayload(ONE_YEAR_SERIES)))
    const b = await calculateReturn('TEST', '1Y', 1_000_000)
    expect(a.value).toBeCloseTo(25, 10)
    expect(b.value).toBe(a.value)
  })

  it('reports a young fund as its life-to-date return, with its real (sub-period) years', async () => {
    stubFetch(always(toChartPayload(SHORT_SERIES)))
    const r = await calculateReturn('TEST', '6M', 55)
    expect(r.value).toBeCloseTo(10, 10) // 50 → 55
    expect(r.years).toBeCloseTo(0.1670089, 6) // ~2 months, NOT 0.5
  })

  it.each([
    ['a single bar', SINGLE_POINT_SERIES],
    ['an empty series', EMPTY_SERIES],
  ])('returns null (not 0) for %s', async (_label, series) => {
    stubFetch(always(toChartPayload(series)))
    const r = await calculateReturn('TEST', '1Y', 100, { maxAttempts: 1 })
    expect(r.value).toBeNull()
    expect(r.years).toBeNull()
    expect(r.value).not.toBe(0)
  })

  it('returns null on an HTTP error and does NOT retry a 404', async () => {
    stubFetch(() => ({ status: 404 }))
    const r = await calculateReturn('TEST', '1Y', 100)
    expect(r.value).toBeNull()
    expect(calls).toHaveLength(1) // 4xx that is not 429 will not fix itself
  })

  it('retries a 429 up to MAX_ATTEMPTS and succeeds on the last one', async () => {
    let n = 0
    stubFetch(() => {
      n++
      return n < 3 ? { status: 429 } : { body: toChartPayload(ONE_YEAR_SERIES) }
    })
    const r = await calculateReturn('TEST', '1Y', 100)
    expect(calls).toHaveLength(3)
    expect(r.value).toBeCloseTo(25, 10)
  })

  it('honours maxAttempts as a hard cap', async () => {
    stubFetch(() => ({ status: 503 }))
    await calculateReturn('TEST', '1Y', 100, { maxAttempts: 1 })
    expect(calls).toHaveLength(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// calculateMultiReturns — 5 periods off ONE 1Y series, with a per-period fallback.
// ══════════════════════════════════════════════════════════════════════════════

describe('calculateMultiReturns', () => {
  it('exposes exactly the documented period set', () => {
    expect([...MULTI_RETURN_PERIODS]).toEqual(['1W', '1M', '6M', 'YTD', '1Y'])
  })

  it('derives all five periods from a single request on a healthy 1Y series', async () => {
    stubFetch(byRange({ '1y': toChartPayload(ONE_YEAR_SERIES) }))
    const { returns, years } = await calculateMultiReturns('TEST')

    // ONE request: the whole point of the fast path.
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]).searchParams.get('range')).toBe('1y')

    // Frozen figures. Bases are the first bar on/after each target date:
    //   1W  → 2025-12-24 (170.94252873563218)
    //   1M  → 2025-12-01 (168.70712643678160)
    //   6M  → 2025-07-02 (154.50574712643677)
    //   YTD → 2025-01-01 (137.41149425287355)  ← first bar OF the year, not the prior year-end
    //   1Y  → 2024-12-31 (137.28), the first bar of the window
    expect(returns['1W']).toBeCloseTo(0.38461538461538336, 10)
    expect(returns['1M']).toBeCloseTo(1.714731098986748, 10)
    expect(returns['6M']).toBeCloseTo(11.063829787234045, 10)
    expect(returns.YTD).toBeCloseTo(24.88038277511962, 10)
    expect(returns['1Y']).toBeCloseTo(25, 10)

    expect(years['1W']).toBeCloseTo(0.019164955509924708, 12)
    expect(years['1M']).toBeCloseTo(0.08213552361396304, 12)
    expect(years['6M']).toBeCloseTo(0.49828884325804246, 12)
    expect(years.YTD).toBeCloseTo(0.9965776865160849, 12)
    expect(years['1Y']).toBeCloseTo(0.9993155373032170, 12)
  })

  it('YTD anchors on the first bar of the calendar year, not on 365 rolling days', async () => {
    stubFetch(byRange({ '1y': toChartPayload(ONE_YEAR_SERIES) }))
    const { returns } = await calculateMultiReturns('TEST')
    // 1Y (from 2024-12-31 = 137.28) and YTD (from 2025-01-01 = 137.4114…) are DIFFERENT windows.
    expect(returns.YTD).not.toBeCloseTo(returns['1Y'] as number, 6)
  })

  it('leaves a period null — never 0 — when neither the 1Y series nor its own range covers it', async () => {
    // A two-month-old fund: the 1Y response only has its short life, and the per-period fallback
    // ranges come back structurally empty.
    stubFetch(byRange({ '1y': toChartPayload(SHORT_SERIES) }, { chart: { result: [] } }))
    const { returns } = await calculateMultiReturns('TEST')

    expect(returns['1W']).toBeCloseTo(1.0683760683760737, 10)
    expect(returns['1M']).toBeCloseTo(4.878048780487807, 10)
    for (const p of ['6M', 'YTD'] as const) {
      expect(returns[p], `${p} must be null`).toBeNull()
      expect(returns[p]).not.toBe(0)
    }
    // 1Y is NOT null here — see the asymmetry test below.
    expect(returns['1Y']).toBeCloseTo(10, 10)
  })

  it('ASYMMETRY: the same range=1y body is null on the fast path but life-to-date on the fallback', async () => {
    // Freezing a real quirk, not endorsing it.
    //
    // The fast path refuses to call a 2-month series a "1Y return": its first bar is far past the
    // target date, so `returnFrom` yields null. The fallback then re-requests THE SAME
    // `range=1y` URL and hands it to `calculateReturn`, which has no window check at all — it just
    // takes first→last — so the period comes back as +10% (the fund's whole life) labelled 1Y.
    //
    // Two rules for one number, decided by whether the fast path happened to fail. If the bulk
    // endpoint picks either rule for both paths, this figure moves on screen.
    stubFetch(byRange({ '1y': toChartPayload(SHORT_SERIES) }, { chart: { result: [] } }))
    const { returns, years } = await calculateMultiReturns('TEST')
    expect(returns['1Y']).toBeCloseTo(10, 10)
    // And the years it reports are the fund's real ~2 months, not 1.
    expect(years['1Y']).toBeCloseTo(0.1670089, 6)
    expect(years['1Y']).toBeLessThan(1)
  })

  it('back-fills a null period from its OWN range when the 1Y series is degraded', async () => {
    // This is the documented self-healing behaviour: a degraded `range=1y` must not blank the
    // whole bundle, because each period has its own URL.
    stubFetch(
      byRange({
        '1y': { chart: { result: [] } },
        '5d': toChartPayload(YEAR_BOUNDARY_SERIES),
        '1mo': toChartPayload(YEAR_BOUNDARY_SERIES),
        '6mo': toChartPayload(YEAR_BOUNDARY_SERIES),
        ytd: toChartPayload(YEAR_BOUNDARY_SERIES),
      })
    )
    const { returns } = await calculateMultiReturns('TEST')
    // Each backfilled period is the first→last of ITS OWN range response: 190.8333… → 220.
    const lifeToDate = ((220 - YEAR_BOUNDARY_SERIES[0].close) / YEAR_BOUNDARY_SERIES[0].close) * 100
    for (const p of ['1W', '1M', '6M', 'YTD'] as const) {
      expect(returns[p]).toBeCloseTo(lifeToDate, 8)
    }
    expect(returns['1Y']).toBeNull() // range=1y stayed empty on every attempt
  })

  it('returns an all-null map, and never throws, when every request fails', async () => {
    stubFetch(() => ({ status: 500 }))
    const { returns, years } = await calculateMultiReturns('TEST')
    expect(returns).toEqual({ '1W': null, '1M': null, '6M': null, YTD: null, '1Y': null })
    expect(years).toEqual({ '1W': null, '1M': null, '6M': null, YTD: null, '1Y': null })
  })

  it('caps total network attempts even when everything is failing', async () => {
    // Worst case used to be 18 fetches for ONE ticker. The budget trims it; each period still
    // gets at least one attempt.
    stubFetch(() => ({ status: 500 }))
    await calculateMultiReturns('TEST')
    expect(calls.length).toBeLessThanOrEqual(12)
    expect(calls.length).toBeGreaterThanOrEqual(8) // 3 on the 1Y series + 1 per missing period
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// fetchCalendarYearReturn — Morningstar NAV total return first, price history second.
// ══════════════════════════════════════════════════════════════════════════════

describe('fetchCalendarYearReturn', () => {
  it('scales annualTotalReturns from a DECIMAL to a percent (×100 belongs HERE)', async () => {
    quoteSummaryMock.mockResolvedValue({
      fundPerformance: {
        annualTotalReturns: {
          returns: [
            { year: '2024', annualValue: 0.1234 },
            { year: '2023', annualValue: -0.0567 },
          ],
        },
      },
    })
    stubFetch(always(undefined))
    await expect(fetchCalendarYearReturn('RDVY', 2024)).resolves.toEqual({ value: 12.34 })
    await expect(fetchCalendarYearReturn('RDVY', 2023)).resolves.toEqual({ value: -5.67 })
    expect(calls).toHaveLength(0) // the fund path never touches the chart endpoint
  })

  it('matches the year loosely (number vs string) the way Yahoo emits it', async () => {
    quoteSummaryMock.mockResolvedValue({
      fundPerformance: { annualTotalReturns: { returns: [{ year: 2022, annualValue: 0.05 }] } },
    })
    stubFetch(always(undefined))
    const r = await fetchCalendarYearReturn('RDVY', 2022)
    expect(r.value).toBeCloseTo(5, 10)
  })

  it('falls back to adjusted-close price history when the fund module has no such year', async () => {
    quoteSummaryMock.mockResolvedValue({
      fundPerformance: { annualTotalReturns: { returns: [{ year: '2019', annualValue: 0.01 }] } },
    })
    stubFetch(
      always({
        chart: {
          result: [
            {
              timestamp: [0, 1, 2],
              indicators: { adjclose: [{ adjclose: [100, 110, 125] }] },
            },
          ],
        },
      })
    )
    const r = await fetchCalendarYearReturn('AAPL', 2023)
    expect(r.value).toBeCloseTo(25, 10) // first valid → last valid
    expect(calls).toHaveLength(1)
  })

  it('uses an exact UTC calendar window: Jan 1 00:00:00 → Dec 31 23:59:59', async () => {
    quoteSummaryMock.mockRejectedValue(new Error('no fund data'))
    stubFetch(always({ chart: { result: [] } }))
    await fetchCalendarYearReturn('AAPL', 2023)
    const q = new URL(calls[0]).searchParams
    expect(q.get('period1')).toBe(String(Date.UTC(2023, 0, 1) / 1000))
    expect(q.get('period2')).toBe(String(Date.UTC(2024, 0, 1) / 1000 - 1))
    expect(q.get('interval')).toBe('1d')
    expect(q.get('range')).toBeNull() // period1/period2 window, never a range
  })

  it('skips null / non-positive closes before taking the endpoints', async () => {
    quoteSummaryMock.mockRejectedValue(new Error('nope'))
    stubFetch(
      always({
        chart: {
          result: [
            {
              timestamp: [0, 1, 2, 3, 4],
              indicators: { adjclose: [{ adjclose: [null, 0, 200, -1, 240] }] },
            },
          ],
        },
      })
    )
    const r = await fetchCalendarYearReturn('AAPL', 2023)
    expect(r.value).toBeCloseTo(20, 10) // 200 → 240
  })

  it('returns null when fewer than two usable closes survive', async () => {
    quoteSummaryMock.mockRejectedValue(new Error('nope'))
    stubFetch(always({ chart: { result: [{ timestamp: [0, 1], indicators: { adjclose: [{ adjclose: [null, 100] }] } }] } }))
    await expect(fetchCalendarYearReturn('AAPL', 2023)).resolves.toEqual({ value: null })
  })

  it.each([999_999_999, 1899, 1800, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the out-of-range year %s without any network call',
    async (year) => {
      stubFetch(always(undefined))
      await expect(fetchCalendarYearReturn('AAPL', year)).resolves.toEqual({ value: null })
      expect(calls).toHaveLength(0)
      expect(quoteSummaryMock).not.toHaveBeenCalled()
    }
  )
})
