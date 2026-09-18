/**
 * Golden fixtures for the financial-correctness suite.
 *
 * Everything here is DETERMINISTIC and hand-built: no randomness, no network, no `Date.now()`.
 * The point is that the numbers the app shows today are pinned to inputs that can never drift,
 * so a refactor of the fetching layer cannot quietly change a single figure.
 *
 * Dates are pure weekday calendars (Mon–Fri, holidays included as trading days). That is not
 * exactly Yahoo's calendar, but it does not need to be: the fixtures are the contract, and a
 * holiday-free calendar keeps every expectation reproducible by hand.
 */

import type { HistoricalDataPoint } from '@/types'

// ── Date plumbing ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function iso(ms: number): string {
  return new Date(ms).toISOString().split('T')[0]
}

/** Every Mon–Fri date (inclusive) between two ISO days, as `YYYY-MM-DD`. */
export function weekdays(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const end = Date.parse(`${endIso}T00:00:00Z`)
  for (let ms = Date.parse(`${startIso}T00:00:00Z`); ms <= end; ms += DAY_MS) {
    const dow = new Date(ms).getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(iso(ms))
  }
  return out
}

/**
 * Builds a daily series pinned to exact year-end closes.
 *
 * `anchors[0]` is the seed point (a single trading day, the prior year-end close). Each later
 * anchor is the close of the LAST trading day of its year; within a year the path is linear in
 * trading-day index, so `close(last day of Y) === anchors[Y]` EXACTLY. That is what makes
 * calendar-year returns exact round numbers instead of float soup.
 */
function anchoredSeries(
  seed: { date: string; close: number },
  anchors: Array<{ year: number; close: number }>
): HistoricalDataPoint[] {
  const points: HistoricalDataPoint[] = [{ date: seed.date, close: seed.close }]
  let prev = seed.close
  for (const { year, close } of anchors) {
    const days = weekdays(`${year}-01-01`, `${year}-12-31`)
    const n = days.length
    for (let j = 0; j < n; j++) {
      points.push({ date: days[j], close: prev + ((close - prev) * (j + 1)) / n })
    }
    prev = close
  }
  return points
}

// ── Fixture 1: a healthy 5-year daily series ──────────────────────────────────
/**
 * SCENARIO: the common case. A `range=5y&interval=1d` response for a liquid ETF with a full
 * history: one seed point at the prior year-end (2020-12-31, exactly what Yahoo returns as the
 * first point of a 5Y window) followed by five complete calendar years.
 *
 * Calendar-year returns are exact by construction:
 *   2021 +20%  ·  2022 −20%  ·  2023 +30%  ·  2024 +10%  ·  2025 +25%
 * (100 → 120 → 96 → 124.8 → 137.28 → 171.6)
 *
 * This is the series that drives the `calculateReturn` vs `deriveTrailing` divergence test.
 */
export const FIVE_YEAR_SERIES: HistoricalDataPoint[] = anchoredSeries(
  { date: '2020-12-31', close: 100 },
  [
    { year: 2021, close: 120 },
    { year: 2022, close: 96 },
    { year: 2023, close: 124.8 },
    { year: 2024, close: 137.28 },
    { year: 2025, close: 171.6 },
  ]
)

/** Year-end anchor closes of `FIVE_YEAR_SERIES`, for readable expectations. */
export const FIVE_YEAR_ANCHORS = {
  2020: 100,
  2021: 120,
  2022: 96,
  2023: 124.8,
  2024: 137.28,
  2025: 171.6,
} as const

/**
 * SCENARIO: the `range=1y&interval=1d` response for the SAME instrument as `FIVE_YEAR_SERIES` —
 * literally the tail of it, starting at the 2024 year-end close (137.28) and ending at 171.6.
 * This is what `calculateMultiReturns` fetches on its fast path, so the two fixtures let the
 * tests compare the watchlist's window against the comparator's window on identical prices.
 */
export const ONE_YEAR_SERIES: HistoricalDataPoint[] = FIVE_YEAR_SERIES.filter(
  (p) => p.date >= '2024-12-31'
)

// ── Fixture 2: a series shorter than the window asked for ─────────────────────
/**
 * SCENARIO: a fund that launched recently. The caller asks for 3Y/5Y but Yahoo only has ~2 months
 * of history. Every long window must resolve to `null` — NEVER 0, and never a return measured
 * against whatever happens to be the first point.
 */
export const SHORT_SERIES: HistoricalDataPoint[] = anchoredSeries(
  { date: '2025-10-31', close: 50 },
  []
).concat(
  weekdays('2025-11-03', '2025-12-31').map((date, j, all) => ({
    date,
    close: 50 + (5 * (j + 1)) / all.length, // 50 → 55 (+10% over the whole life of the fund)
  }))
)

// ── Fixture 3: a single point and an empty series ─────────────────────────────
/** SCENARIO: Yahoo returned exactly one bar (IPO day, or a half-degraded response). */
export const SINGLE_POINT_SERIES: HistoricalDataPoint[] = [{ date: '2025-12-31', close: 42 }]

/** SCENARIO: Yahoo returned a structurally valid response with no usable bars at all. */
export const EMPTY_SERIES: HistoricalDataPoint[] = []

// ── Fixture 4: a series that straddles a year boundary ────────────────────────
/**
 * SCENARIO: the YTD / calendar-year edge. Three weeks around New Year, with 2024-12-31 pinned at
 * 200 so the 2025 slice is a clean +10%. Used to prove the calendar-year split lands on the
 * natural year, not on a rolling 365-day window.
 */
export const YEAR_BOUNDARY_SERIES: HistoricalDataPoint[] = [
  ...weekdays('2024-12-16', '2024-12-31').map((date, j, all) => ({
    date,
    close: 190 + (10 * (j + 1)) / all.length, // ends exactly at 200 on 2024-12-31
  })),
  ...weekdays('2025-01-01', '2025-01-17').map((date, j, all) => ({
    date,
    close: 200 + (20 * (j + 1)) / all.length, // ends exactly at 220 on 2025-01-17
  })),
]

// ── Yahoo v8 chart payloads ───────────────────────────────────────────────────

export interface ChartPayload {
  chart?: {
    result?: Array<Record<string, unknown>>
    error?: unknown
  }
}

function epochOf(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000
}

/** Wraps a point series into the exact shape `https://query1.finance.yahoo.com/v8/...` returns. */
export function toChartPayload(points: HistoricalDataPoint[]): ChartPayload {
  return {
    chart: {
      result: [
        {
          timestamp: points.map((p) => epochOf(p.date)),
          indicators: {
            adjclose: [{ adjclose: points.map((p) => p.close) }],
            quote: [
              {
                close: points.map((p) => p.close),
                open: points.map((p) => p.close),
                high: points.map((p) => p.close),
                low: points.map((p) => p.close),
                volume: points.map(() => 1_000_000),
              },
            ],
          },
        },
      ],
    },
  }
}

// ── Fixture 5: gappy / degraded payloads ──────────────────────────────────────

/**
 * SCENARIO: Yahoo emits `null` inside `adjclose` on non-trading or stale days (very common on
 * funds). `parseChart` must fall back to `quote.close`, and drop the bar only when BOTH are
 * missing or non-positive. Five bars in, three usable out.
 *
 *   2025-12-01  adjclose 100     → 100   (kept, adjclose wins)
 *   2025-12-02  adjclose null    → 101   (kept, falls back to quote.close)
 *   2025-12-03  adjclose null    → drop  (quote.close is null too)
 *   2025-12-04  adjclose 0       → drop  (non-positive is not a price)
 *   2025-12-05  adjclose 104     → 104   (kept)
 */
export const GAPPY_PAYLOAD: ChartPayload = {
  chart: {
    result: [
      {
        timestamp: ['2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04', '2025-12-05'].map(epochOf),
        indicators: {
          adjclose: [{ adjclose: [100, null, null, 0, 104] }],
          quote: [{ close: [100, 101, null, 103, 104], volume: [1, 2, 3, 4, 5] }],
        },
      },
    ],
  },
}

/** The three bars `GAPPY_PAYLOAD` must survive as. */
export const GAPPY_EXPECTED = [
  { date: '2025-12-01', close: 100 },
  { date: '2025-12-02', close: 101 },
  { date: '2025-12-05', close: 104 },
]

/**
 * SCENARIO catalogue for structurally broken responses. PR2 hardened `parseChart` so each of
 * these yields `[]` instead of throwing; this table freezes that. A throw here would escape the
 * retry loop and turn a degraded response into a 500.
 */
export const DEGRADED_PAYLOADS: Array<{ name: string; payload: unknown }> = [
  { name: 'empty object', payload: {} },
  { name: 'null body', payload: null },
  { name: 'chart with no result', payload: { chart: {} } },
  { name: 'result is an empty array', payload: { chart: { result: [] } } },
  { name: 'result[0] is null', payload: { chart: { result: [null] } } },
  { name: 'no timestamp key', payload: { chart: { result: [{ indicators: {} }] } } },
  {
    name: 'timestamp is not an array',
    payload: { chart: { result: [{ timestamp: 'nope', indicators: {} }] } },
  },
  { name: 'timestamp is empty', payload: { chart: { result: [{ timestamp: [], indicators: {} }] } } },
  {
    name: 'indicators absent entirely',
    payload: { chart: { result: [{ timestamp: [epochOf('2025-12-01')] }] } },
  },
  {
    name: 'indicators present but quote[0] absent',
    payload: { chart: { result: [{ timestamp: [epochOf('2025-12-01')], indicators: { quote: [] } }] } },
  },
  {
    name: 'quote[0] present but has no close array',
    payload: {
      chart: { result: [{ timestamp: [epochOf('2025-12-01')], indicators: { quote: [{}] } }] },
    },
  },
  {
    name: 'non-finite timestamps (NaN / Infinity / null / string)',
    payload: {
      chart: {
        result: [
          {
            timestamp: [Number.NaN, Number.POSITIVE_INFINITY, null, 'x'],
            indicators: { adjclose: [{ adjclose: [1, 2, 3, 4] }] },
          },
        ],
      },
    },
  },
  {
    name: 'every close is null or non-positive',
    payload: {
      chart: {
        result: [
          {
            timestamp: ['2025-12-01', '2025-12-02', '2025-12-03'].map(epochOf),
            indicators: { adjclose: [{ adjclose: [null, 0, -5] }], quote: [{ close: [null, null, null] }] },
          },
        ],
      },
    },
  },
]

/**
 * SCENARIO: a mixed-validity timestamp array. Only the finite timestamps survive, and the
 * surviving bars keep their ORIGINAL index alignment with the close array — an off-by-one here
 * would silently mis-date every price in the app.
 */
export const MIXED_TIMESTAMP_PAYLOAD: ChartPayload = {
  chart: {
    result: [
      {
        timestamp: [epochOf('2025-12-01'), Number.NaN, epochOf('2025-12-03'), Number.POSITIVE_INFINITY],
        indicators: { adjclose: [{ adjclose: [10, 11, 12, 13] }] },
      },
    ],
  },
}

export const MIXED_TIMESTAMP_EXPECTED = [
  { date: '2025-12-01', close: 10 },
  { date: '2025-12-03', close: 12 }, // index 2 → 12, NOT 11: indices must not shift
]

// ── USD conversion reference ──────────────────────────────────────────────────

/**
 * The documented USD conversion, written out once so the expected numbers in the tests are
 * derived from the formula rather than from whatever the code currently does:
 *
 *     usd% = ((1 + local%/100) × (1 + fx%/100) − 1) × 100
 *
 * It is NOT `local% + fx%`. The cross term matters: +10% local on a +10% currency is +21%, not
 * +20%, and the error grows with the size of the moves (which is exactly when it is noticed).
 */
export function usdReturnPct(localPct: number, fxPct: number): number {
  return ((1 + localPct / 100) * (1 + fxPct / 100) - 1) * 100
}

/**
 * Quoted-currency divisors. GBX / GBp are PENCE: a London quote of 2450 GBX is £24.50, so the
 * USD rate must be `GBPUSD=X ÷ 100`. This single ÷100 is the most fragile number in the FX path —
 * dropping it inflates every UK-listed price by 100×, and adding a second one deflates it.
 */
export const EXPECTED_FX_DIVISORS: Record<string, number> = { GBX: 100, GBp: 100 }

/** Every currency the app maps to a Yahoo FX pair, frozen. */
export const EXPECTED_FX_TICKERS: Record<string, string> = {
  GBP: 'GBPUSD=X',
  GBX: 'GBPUSD=X',
  GBp: 'GBPUSD=X',
  EUR: 'EURUSD=X',
  JPY: 'JPYUSD=X',
  CHF: 'CHFUSD=X',
  CAD: 'CADUSD=X',
  AUD: 'AUDUSD=X',
  HKD: 'HKDUSD=X',
}
