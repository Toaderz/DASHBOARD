/**
 * GOLDEN TESTS — `hooks/useEtfComparison.ts` (`deriveTrailing` / `deriveAnnual`)
 *
 * ⚠️ THE POINT OF THIS FILE
 *
 * The comparator (`/etf-compare`) and the watchlist compute returns with DIFFERENT, deliberate
 * semantics. They look interchangeable and they are not:
 *
 *   · `deriveTrailing(series)['3Y']` slices a target date out of a longer series and reports a
 *     CUMULATIVE return ("Retornos acumulados"). It is NOT annualized, unlike Yahoo's CAGR.
 *   · `calculateReturn(ticker,'3Y')` asks Yahoo for `range=3y` and reports first→last of whatever
 *     came back, plus the REAL elapsed years of that window.
 *   · `useTopPerformers` then annualizes with NOMINAL years (3Y ⇒ exactly 3), never with the real
 *     elapsed years, because a constant exponent keeps the CAGR monotonic in R and therefore keeps
 *     the ranking order stable.
 *
 * The next PR moves the watchlist onto a bulk endpoint. The obvious shortcut is "we already have a
 * 5Y series, just call deriveTrailing". That would silently restate every figure in the watchlist.
 * The tests below are built so that shortcut fails loudly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HistoricalDataPoint } from '@/types'
import { deriveTrailing, deriveAnnual, COMPARE_TRAILING_PERIODS } from './useEtfComparison'
import { annualizeReturn } from '@/lib/utils/formatters'
import {
  FIVE_YEAR_SERIES,
  FIVE_YEAR_ANCHORS,
  SHORT_SERIES,
  SINGLE_POINT_SERIES,
  EMPTY_SERIES,
  YEAR_BOUNDARY_SERIES,
  toChartPayload,
} from '@/lib/market/__fixtures__/series'

vi.mock('yahoo-finance2', () => ({ default: class { quoteSummary = vi.fn() } }))
const { calculateReturn } = await import('@/lib/market/history')

// ══════════════════════════════════════════════════════════════════════════════
// 🚩 THE GUARD: the comparator's 3Y and the watchlist's 3Y are different numbers.
// ══════════════════════════════════════════════════════════════════════════════

describe('🚩 deriveTrailing is NOT a drop-in for calculateReturn', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Serve the IDENTICAL 5Y series to every Yahoo range — exactly what a "we already fetched the
    // series once, reuse it everywhere" refactor does.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => toChartPayload(FIVE_YEAR_SERIES),
      }) as unknown as Response)
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('produces DIFFERENT 3Y numbers from the same series (78.54% vs 71.60%)', async () => {
    const watchlist3Y = await calculateReturn('TEST', '3Y', 171.6)
    const comparator3Y = deriveTrailing(FIVE_YEAR_SERIES)['3Y']

    // Watchlist: first→last of the response it was handed (100 → 171.6).
    expect(watchlist3Y.value).toBeCloseTo(71.6, 10)
    // Comparator: the bar on/after endMs − 3×365 days (2023-01-02, 96.11076923076924) → 171.6.
    expect(comparator3Y).toBeCloseTo(78.54398770649249, 10)

    // The whole reason this file exists. If someone unifies the two, this line falls over.
    expect(comparator3Y).not.toBeCloseTo(watchlist3Y.value as number, 2)
    expect(Math.abs((comparator3Y as number) - (watchlist3Y.value as number))).toBeGreaterThan(6)
  })

  it('also disagrees on 5Y, where they look most alike (71.47% vs 71.60%)', async () => {
    const watchlist5Y = await calculateReturn('TEST', '5Y', 171.6)
    const comparator5Y = deriveTrailing(FIVE_YEAR_SERIES)['5Y']
    expect(watchlist5Y.value).toBeCloseTo(71.6, 10) // base = the 2020-12-31 seed bar, 100
    expect(comparator5Y).toBeCloseTo(71.46860643185299, 10) // base = 2021-01-01, 100.07662835249042
    expect(comparator5Y).not.toBe(watchlist5Y.value)
  })

  it('agrees on 1Y ONLY by coincidence of this fixture, and not on the reported years', async () => {
    const watchlist1Y = await calculateReturn('TEST', '1Y', 171.6)
    // The 1Y numbers differ too: the comparator anchors 365 days back, the watchlist on the first
    // bar of whatever `range=1y` returned — here the full 5Y body, so it reports the 5Y figure.
    expect(watchlist1Y.value).toBeCloseTo(71.6, 10)
    expect(deriveTrailing(FIVE_YEAR_SERIES)['1Y']).toBeCloseTo(24.999999999999993, 10)
    // `years` is a watchlist-only concept; the comparator never reports one.
    expect(watchlist1Y.years).toBeCloseTo(4.999315537303217, 12)
  })

  it('deriveTrailing 3Y/5Y are CUMULATIVE, not the CAGR Yahoo publishes', async () => {
    const t = deriveTrailing(FIVE_YEAR_SERIES)
    const cum3Y = t['3Y'] as number
    expect(cum3Y).toBeCloseTo(78.54398770649249, 10)
    // What Yahoo would show for the same window (annualized over 3 nominal years):
    const cagr3Y = annualizeReturn(cum3Y, 3) as number
    expect(cagr3Y).toBeCloseTo(21.315160403303658, 10)
    // They are wildly different figures, and the UI labels the section "Retornos acumulados".
    expect(cum3Y).toBeGreaterThan(cagr3Y * 3)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 🚩 NOMINAL vs REAL years — why useTopPerformers refuses to use `entry.years`.
// ══════════════════════════════════════════════════════════════════════════════

describe('🚩 annualizing with NOMINAL years is what keeps the ranking stable', () => {
  // Two assets over the "3Y" window. A has the bigger cumulative return but a slightly longer
  // real history; B is shorter-lived (a late-listing share class, a fund that IPO'd mid-window…).
  const A = { cumulative: 60, realYears: 3.02 }
  const B = { cumulative: 55, realYears: 2.55 }

  it('nominal 3 preserves the cumulative ordering (A ahead of B)', () => {
    const a = annualizeReturn(A.cumulative, 3) as number
    const b = annualizeReturn(B.cumulative, 3) as number
    expect(a).toBeCloseTo(16.96070952851465, 10)
    expect(b).toBeCloseTo(15.729452726293779, 10)
    expect(a).toBeGreaterThan(b) // same order as 60% > 55%
  })

  it('real per-asset years FLIP the ordering — the bug NOMINAL_YEARS exists to prevent', () => {
    const a = annualizeReturn(A.cumulative, A.realYears) as number
    const b = annualizeReturn(B.cumulative, B.realYears) as number
    expect(a).toBeCloseTo(16.839421559119792, 10)
    expect(b).toBeCloseTo(18.751712609396808, 10)
    // B now outranks A despite the smaller cumulative return: a different exponent per asset
    // destroys the monotonicity the leaderboard depends on.
    expect(b).toBeGreaterThan(a)
  })

  it('sub-annual windows are never annualized (CAGR under 1 year is explosive)', () => {
    expect(annualizeReturn(20, 0.1)).toBeNull()
    expect(annualizeReturn(20, 0.9999)).toBeNull()
    expect(annualizeReturn(20, 1)).toBeCloseTo(20, 10)
    expect(annualizeReturn(null, 3)).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// deriveTrailing — frozen values and degraded inputs.
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveTrailing', () => {
  it('exposes exactly the documented period set, in order', () => {
    expect([...COMPARE_TRAILING_PERIODS]).toEqual(['1M', '6M', 'YTD', '1Y', '3Y', '5Y'])
  })

  it('freezes every trailing figure for the healthy 5Y fixture', () => {
    const t = deriveTrailing(FIVE_YEAR_SERIES)
    expect(t['1M']).toBeCloseTo(1.714731098986748, 10) // base 2025-12-01
    expect(t['6M']).toBeCloseTo(11.063829787234045, 10) // base 2025-07-02
    expect(t.YTD).toBeCloseTo(24.88038277511962, 10) // base 2025-01-01
    expect(t['1Y']).toBeCloseTo(24.999999999999993, 10) // base 2024-12-31 = 137.28
    expect(t['3Y']).toBeCloseTo(78.54398770649249, 10) // base 2023-01-02
    expect(t['5Y']).toBeCloseTo(71.46860643185299, 10) // base 2021-01-01
  })

  it('YTD anchors on the first bar OF the year, not on the prior year-end close', () => {
    const t = deriveTrailing(FIVE_YEAR_SERIES)
    const a = deriveAnnual(FIVE_YEAR_SERIES)
    // Same calendar year, two different bases → two different "2025" numbers in the same UI.
    expect(t.YTD).toBeCloseTo(24.88038277511962, 10)
    expect(a[2025]).toBeCloseTo(25, 10)
    expect(t.YTD).not.toBeCloseTo(a[2025] as number, 3)
  })

  it('returns null — never 0 — for windows longer than the available history', () => {
    const t = deriveTrailing(SHORT_SERIES)
    expect(t['1M']).toBeCloseTo(4.878048780487807, 10)
    for (const p of ['6M', 'YTD', '1Y', '3Y', '5Y'] as const) {
      expect(t[p], `${p} must be null`).toBeNull()
      expect(t[p]).not.toBe(0)
    }
  })

  it('tolerates a window that starts slightly before the first bar, within its slack', () => {
    // 1M slack is 7 days: a series starting 3 days after the 1M target still reports a figure.
    const s: HistoricalDataPoint[] = [
      { date: '2025-12-04', close: 100 },
      { date: '2025-12-31', close: 110 },
    ]
    expect(deriveTrailing(s)['1M']).toBeCloseTo(10, 10) // target 2025-12-01, gap 3 days → allowed
    const s2: HistoricalDataPoint[] = [
      { date: '2025-12-20', close: 100 },
      { date: '2025-12-31', close: 110 },
    ]
    expect(deriveTrailing(s2)['1M']).toBeNull() // gap 19 days → outside the 7-day slack
  })

  it.each([
    ['an empty series', EMPTY_SERIES],
    ['a single bar', SINGLE_POINT_SERIES],
  ])('returns the all-null map for %s', (_label, series) => {
    expect(deriveTrailing(series)).toEqual({ '1M': null, '6M': null, YTD: null, '1Y': null, '3Y': null, '5Y': null })
  })

  it('returns the all-null map when the last close is 0 (no dividing by it)', () => {
    const s: HistoricalDataPoint[] = [
      { date: '2025-01-02', close: 100 },
      { date: '2025-12-31', close: 0 },
    ]
    expect(deriveTrailing(s)).toEqual({ '1M': null, '6M': null, YTD: null, '1Y': null, '3Y': null, '5Y': null })
  })

  it('is pure: same input, same output, and the input is not mutated', () => {
    const before = JSON.stringify(FIVE_YEAR_SERIES)
    expect(deriveTrailing(FIVE_YEAR_SERIES)).toEqual(deriveTrailing(FIVE_YEAR_SERIES))
    expect(JSON.stringify(FIVE_YEAR_SERIES)).toBe(before)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// deriveAnnual — calendar years. These DO match Yahoo's annualTotalReturns (≤0.02pp).
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveAnnual', () => {
  it('freezes every calendar year of the 5Y fixture, keyed by the natural year', () => {
    const a = deriveAnnual(FIVE_YEAR_SERIES)
    expect(Object.keys(a).map(Number).sort()).toEqual([2021, 2022, 2023, 2024, 2025])
    expect(a[2021]).toBeCloseTo(20, 10) // 100    → 120
    expect(a[2022]).toBeCloseTo(-20, 10) // 120    → 96
    expect(a[2023]).toBeCloseTo(30, 10) // 96     → 124.8
    expect(a[2024]).toBeCloseTo(10, 10) // 124.8  → 137.28
    expect(a[2025]).toBeCloseTo(25, 10) // 137.28 → 171.6
  })

  it('anchors each year on the previous YEAR-END close, exactly as the fixture defines it', () => {
    const a = deriveAnnual(FIVE_YEAR_SERIES)
    for (const y of [2021, 2022, 2023, 2024, 2025] as const) {
      const prev = FIVE_YEAR_ANCHORS[(y - 1) as keyof typeof FIVE_YEAR_ANCHORS]
      const cur = FIVE_YEAR_ANCHORS[y]
      expect(a[y]).toBeCloseTo(((cur - prev) / prev) * 100, 8)
    }
  })

  it('omits the first year — it has no prior year-end anchor', () => {
    // 2020 contributes only the seed bar, so it is an anchor, never a reported year.
    expect(deriveAnnual(FIVE_YEAR_SERIES)[2020]).toBeUndefined()
  })

  it('splits on the natural year, not on a rolling window', () => {
    // Fixture straddles New Year: 2024 ends at exactly 200, 2025 ends at 220 → +10%.
    const a = deriveAnnual(YEAR_BOUNDARY_SERIES)
    expect(Object.keys(a).map(Number)).toEqual([2025])
    expect(a[2025]).toBeCloseTo(10, 10)
  })

  it('returns {} for series too short to have two year-ends', () => {
    expect(deriveAnnual(EMPTY_SERIES)).toEqual({})
    expect(deriveAnnual(SINGLE_POINT_SERIES)).toEqual({})
    expect(deriveAnnual(SHORT_SERIES)).toEqual({}) // 2025 only, no 2024 anchor
  })

  it('ignores zero/falsy closes when picking each year-end anchor', () => {
    const s: HistoricalDataPoint[] = [
      { date: '2024-12-30', close: 100 },
      { date: '2024-12-31', close: 0 }, // a bad bar must not become the 2024 anchor
      { date: '2025-12-31', close: 150 },
    ]
    expect(deriveAnnual(s)[2025]).toBeCloseTo(50, 10)
  })

  it('is pure: same input, same output, and the input is not mutated', () => {
    const before = JSON.stringify(FIVE_YEAR_SERIES)
    expect(deriveAnnual(FIVE_YEAR_SERIES)).toEqual(deriveAnnual(FIVE_YEAR_SERIES))
    expect(JSON.stringify(FIVE_YEAR_SERIES)).toBe(before)
  })
})
