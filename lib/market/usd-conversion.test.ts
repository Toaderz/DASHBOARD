/**
 * GOLDEN TESTS — USD normalisation and the GBX (pence) divisor.
 *
 * Every cross-currency figure in the app goes through two rules:
 *
 *   1. COMPOUNDING, not addition:   usd% = ((1 + local%/100) × (1 + fx%/100) − 1) × 100
 *   2. PENCE:                       a GBX/GBp quote is priced at  GBPUSD=X ÷ 100
 *
 * Neither rule lives in an exported function today — rule 1 is inlined at four call sites and
 * rule 2 lives in two module-private maps in `hooks/useFxData.ts`. So this file does two things:
 * it freezes the NUMBERS the rules must produce (against a reference implementation kept beside
 * the fixtures), and it asserts that each production call site still spells the rule out.
 *
 * The ÷100 is the single most breakable number in the FX path: dropping it inflates every
 * UK-listed price by 100×, and applying it to a *percentage* instead of a *price* would turn a
 * +5% currency move into +0.05%.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { usdReturnPct, EXPECTED_FX_DIVISORS, EXPECTED_FX_TICKERS } from './__fixtures__/series'

const ROOT = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

/** Every place the compounding rule is inlined today. */
const CONVERSION_SITES = [
  'hooks/usePeerComparison.ts',
  'hooks/useTopPerformers.ts',
  'components/dashboard/WatchlistTable.tsx',
  'components/dashboard/AssetDetailModal.tsx',
]

/** `((1 + x / 100) * (1 + y / 100) - 1)`, whitespace-tolerant. */
const COMPOUND_RE = /\(1\s*\+\s*[\w.]+\s*\/\s*100\)\s*\*\s*\(1\s*\+\s*[\w.]+\s*\/\s*100\)\s*-\s*1/

// ══════════════════════════════════════════════════════════════════════════════
// Rule 1 — compounding
// ══════════════════════════════════════════════════════════════════════════════

describe('local → USD compounding', () => {
  it('is multiplicative: the cross term is NOT optional', () => {
    // +10% local on a +10% currency is +21%, not +20%. The naive sum is wrong by the product,
    // and the error grows exactly where it is most visible (big moves, long windows).
    expect(usdReturnPct(10, 10)).toBeCloseTo(21, 10)
    expect(usdReturnPct(10, 10)).not.toBeCloseTo(20, 2)
  })

  it.each([
    // [local %, fx %, usd %]
    [0, 0, 0],
    [10, 0, 10], // FX flat → local return passes through untouched
    [0, 10, 10], // local flat → pure currency move
    [10, -10, -1.0000000000000009], // +10% wiped out and then some by a −10% currency
    [-10, 10, -1.0000000000000009], // symmetric in its arguments
    [25, 8.5, 35.625],
    [-33.33, -12.5, -41.66375],
    [100, 100, 300], // a doubling in a doubled currency is 4× → +300%
    [-100, 50, -100], // a total wipeout stays a total wipeout in any currency
  ])('local %s%% with fx %s%% → %s%% USD', (local, fx, usd) => {
    expect(usdReturnPct(local, fx)).toBeCloseTo(usd, 10)
  })

  it('is commutative in its two factors', () => {
    expect(usdReturnPct(17.5, -4.25)).toBeCloseTo(usdReturnPct(-4.25, 17.5), 12)
  })

  it('every production call site still spells the rule out', () => {
    for (const rel of CONVERSION_SITES) {
      expect(read(rel), `${rel} no longer compounds local × fx`).toMatch(COMPOUND_RE)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Rule 2 — GBX / GBp pence
// ══════════════════════════════════════════════════════════════════════════════

describe('GBX / GBp pence handling', () => {
  const fxSource = read('hooks/useFxData.ts')

  it('maps every supported currency to its Yahoo pair, with GBX and GBp on GBPUSD=X', () => {
    for (const [ccy, pair] of Object.entries(EXPECTED_FX_TICKERS)) {
      expect(fxSource, `FX_TICKER is missing ${ccy}`).toMatch(
        new RegExp(`\\b${ccy}\\b\\s*:\\s*'${pair.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`)
      )
    }
  })

  it('keeps the ÷100 divisor for BOTH spellings of pence', () => {
    const divisorLine = fxSource.match(/FX_DIVISOR[^\n]*\n?/)?.[0] ?? ''
    expect(divisorLine, 'FX_DIVISOR not found').not.toBe('')
    for (const [ccy, divisor] of Object.entries(EXPECTED_FX_DIVISORS)) {
      expect(divisorLine, `${ccy} lost its ÷${divisor}`).toMatch(new RegExp(`\\b${ccy}\\b\\s*:\\s*${divisor}\\b`))
    }
    // Yahoo emits both `GBX` and `GBp` depending on the instrument (PSH.L is `GBp`). Handling one
    // and not the other is a 100× error on whichever spelling was forgotten.
    expect(Object.keys(EXPECTED_FX_DIVISORS).sort()).toEqual(['GBX', 'GBp'])
  })

  it('applies the divisor to the SPOT RATE only', () => {
    // `rate: quote.price / divisor` — the divisor converts a price, never a percentage.
    expect(fxSource).toMatch(/rate:\s*quote\.price\s*\/\s*divisor/)
    // Non-pence currencies must go through the same expression with divisor 1.
    expect(fxSource).toMatch(/FX_DIVISOR\[[\w]+\]\s*\?\?\s*1/)
  })

  it('prices a pence quote correctly (4250 GBX at GBPUSD 1.27 → $53.975)', () => {
    const gbpUsdSpot = 1.27
    const rateGBX = gbpUsdSpot / EXPECTED_FX_DIVISORS.GBX
    expect(rateGBX).toBeCloseTo(0.0127, 12)
    expect(4250 * rateGBX).toBeCloseTo(53.975, 10)
    // The two classic failure modes, pinned as explicitly wrong:
    expect(4250 * gbpUsdSpot).toBeCloseTo(5397.5, 6) // divisor dropped → 100× too big
    expect(4250 * (gbpUsdSpot / 10_000)).toBeCloseTo(0.53975, 10) // divisor applied twice
  })

  it('does NOT divide the FX PERIOD RETURN by 100 — a ratio is scale-invariant', () => {
    // GBPUSD=X moving +5% moves a pence-quoted asset by +5%, not +0.05%. The pence divisor is a
    // unit conversion on the price level and must never leak into the return path.
    const localPct = 12
    const fxPct = 5
    expect(usdReturnPct(localPct, fxPct)).toBeCloseTo(17.6, 10)
    expect(usdReturnPct(localPct, fxPct / 100)).toBeCloseTo(12.056, 10) // the bug, for contrast
    // `fetchFxReturn` asks for the pair's return and stores it unscaled.
    expect(fxSource).toMatch(/json\.return\s*\?\?\s*null/)
    expect(fxSource).not.toMatch(/return[\w.]*\s*\/\s*100/)
  })

  it('treats a USD asset as a pass-through with no FX leg at all', () => {
    expect(usdReturnPct(13.37, 0)).toBeCloseTo(13.37, 10)
    // Both the peer comparison and the watchlist short-circuit on USD before touching FX.
    expect(read('hooks/usePeerComparison.ts')).toMatch(/currency\s*===\s*'USD'/)
    expect(read('components/dashboard/WatchlistTable.tsx')).toMatch(/===\s*'USD'/)
  })

  it('refuses to compare a non-USD return with no FX data (null, not the local number)', () => {
    // Documented invariant: "Sin FX → NO comparable (null). Nunca comparamos un retorno local
    // como si fuera USD."
    const src = read('hooks/usePeerComparison.ts')
    expect(src).toMatch(/if\s*\(fx\s*==\s*null\)\s*return\s+null/)
  })
})
