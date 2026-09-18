/**
 * GOLDEN TESTS — `lib/market/peer-taxonomy.ts`
 *
 * The peer set is the denominator of "Beating Peers". If it drifts, every won/lost verdict in the
 * app changes meaning without a single line of the comparison logic being touched. These tests pin
 * three things:
 *
 *   1. DETERMINISM — same input ⇒ same output, including ORDER.
 *   2. STATIC_PEERS is authoritative: curated entries are returned verbatim and are never
 *      recomputed, re-scored or reordered, whatever signals or DB rows are supplied.
 *   3. The scoring components, so a "harmless" tweak to one weight surfaces as a diff.
 */

import { describe, it, expect } from 'vitest'
import type { AssetMetadata } from '@/types'
import {
  computeInitialPeers,
  scorePeerSimilarity,
  STATIC_PEERS,
  TAXONOMY,
  MIN_PEER_SCORE,
  MAX_AUTO_PEERS,
} from './peer-taxonomy'

const asset = (ticker: string, over: Partial<AssetMetadata> = {}): AssetMetadata => ({
  ticker,
  name: ticker,
  type: 'etf',
  sector: null,
  region: null,
  industry: null,
  benchmark: null,
  manager: null,
  ...over,
})

const tickersOf = (a: AssetMetadata[]) => a.map((p) => p.ticker)

// ══════════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════════

describe('tuning constants', () => {
  it('freezes the candidate gate and the peer cap', () => {
    expect(MIN_PEER_SCORE).toBe(60)
    expect(MAX_AUTO_PEERS).toBe(8)
  })

  it('every STATIC_PEERS entry is non-empty, deduplicated and excludes its own ticker', () => {
    for (const [ticker, peers] of Object.entries(STATIC_PEERS)) {
      expect(peers.length, ticker).toBeGreaterThan(0)
      expect(new Set(peers).size, `${ticker} has duplicate peers`).toBe(peers.length)
      expect(peers, `${ticker} lists itself`).not.toContain(ticker)
      expect(peers.length, `${ticker} exceeds MAX_AUTO_PEERS`).toBeLessThanOrEqual(MAX_AUTO_PEERS)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// STATIC_PEERS is authoritative
// ══════════════════════════════════════════════════════════════════════════════

describe('STATIC_PEERS is never recomputed', () => {
  it('returns the curated list verbatim, in the curated order', () => {
    expect(tickersOf(computeInitialPeers(asset('RDVY'), []))).toEqual(['VIG', 'JQUA', 'RSP', 'QUAL', 'SPHQ'])
    expect(tickersOf(computeInitialPeers(asset('FDL'), []))).toEqual(['SCHD', 'HDV', 'WBIY', 'VYM', 'RDIV'])
  })

  it('looks the ticker up case-insensitively', () => {
    expect(tickersOf(computeInitialPeers(asset('rdvy'), []))).toEqual(STATIC_PEERS.RDVY)
  })

  it('holds for EVERY curated ticker, even with a full DB + Morningstar signals on everything', () => {
    // The strongest form of the invariant: hand the engine every reason to re-score, and it must
    // still not touch a curated entry. `signals` alone would push several candidates over the gate.
    const richDb = Object.keys(TAXONOMY).map((t) => asset(t))
    const signals = Object.fromEntries(
      Object.keys(TAXONOMY).map((t) => [t, { morningstar: 'Large Blend', global: 'US Equity Large Cap Blend' }])
    )
    const curatedAndInTaxonomy = Object.keys(STATIC_PEERS).filter((t) => TAXONOMY[t])
    // Sanity: these are precisely the tickers where the algorithmic path COULD have fired.
    expect(curatedAndInTaxonomy.length).toBe(80)

    for (const ticker of curatedAndInTaxonomy) {
      const got = tickersOf(computeInitialPeers(asset(ticker), richDb, { signals }))
      expect(got, `${ticker} drifted off its curated set`).toEqual(STATIC_PEERS[ticker])
    }
  })

  it('prefers the DB row (real name) but keeps the curated ticker and order', () => {
    const out = computeInitialPeers(asset('RDVY'), [
      asset('VIG', { name: 'Vanguard Dividend Appreciation ETF' }),
    ])
    expect(tickersOf(out)).toEqual(STATIC_PEERS.RDVY)
    expect(out[0].name).toBe('Vanguard Dividend Appreciation ETF')
    // Peers with no DB row are synthesised with the ticker as the name.
    expect(out[1]).toMatchObject({ ticker: 'JQUA', name: 'JQUA', type: 'etf' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Determinism
// ══════════════════════════════════════════════════════════════════════════════

describe('determinism', () => {
  it('gives byte-identical results across repeated calls for every taxonomy ticker', () => {
    for (const ticker of Object.keys(TAXONOMY)) {
      const a = computeInitialPeers(asset(ticker), [])
      const b = computeInitialPeers(asset(ticker), [])
      expect(JSON.stringify(b), ticker).toBe(JSON.stringify(a))
    }
  })

  it('does not depend on the order of `allAssets`', () => {
    const all = ['VIG', 'DGRO', 'NOBL', 'SDY', 'FDVV'].map((t) => asset(t))
    const forward = tickersOf(computeInitialPeers(asset('SCHD'), all))
    const reversed = tickersOf(computeInitialPeers(asset('SCHD'), [...all].reverse()))
    const shuffled = tickersOf(computeInitialPeers(asset('SCHD'), [all[3], all[0], all[4], all[2], all[1]]))
    expect(reversed).toEqual(forward)
    expect(shuffled).toEqual(forward)
  })

  it('freezes the algorithmic result AND the score-desc / ticker-asc tie-break that produced it', () => {
    // SCHD has no STATIC entry, so the scorer runs. Scores, in the order returned:
    //   FDVV 85 · SDY 85 · DGRW 82 · DGRO 80 · FTDS 80 · NOBL 80 · VIG 80
    // Both tie groups are alphabetical — that is the `b.score - a.score || ticker asc` rule.
    const out = tickersOf(computeInitialPeers(asset('SCHD'), []))
    expect(out).toEqual(['FDVV', 'SDY', 'DGRW', 'DGRO', 'FTDS', 'NOBL', 'VIG'])

    const scores = out.map((t) => scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY[t]))
    expect(scores).toEqual([85, 85, 82, 80, 80, 80, 80])
    // Non-increasing scores, alphabetical within each tie.
    for (let i = 1; i < out.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
      if (scores[i] === scores[i - 1]) expect(out[i] > out[i - 1]).toBe(true)
    }
  })

  it('keeps at most one peer per manager (highest score wins the slot)', () => {
    // VYM (Vanguard, 52) is not merely below the gate — VIG already took the Vanguard slot.
    const out = computeInitialPeers(asset('SCHD'), [])
    const managers = out.map((p) => TAXONOMY[p.ticker]?.manager).filter(Boolean)
    expect(new Set(managers).size).toBe(managers.length)
    expect(tickersOf(out)).not.toContain('VYM')
  })

  it('never returns more than MAX_AUTO_PEERS, and never the asset itself', () => {
    for (const ticker of Object.keys(TAXONOMY)) {
      const out = tickersOf(computeInitialPeers(asset(ticker), []))
      expect(out.length, ticker).toBeLessThanOrEqual(MAX_AUTO_PEERS)
      expect(out, ticker).not.toContain(ticker)
    }
  })

  it('freezes the fallback for tickers outside the taxonomy', () => {
    // A plain ETF with no metadata at all still classifies (broad blend) and gets peers…
    expect(tickersOf(computeInitialPeers(asset('ZZZZ'), []))).toEqual(['FEX', 'IVV', 'SPY', 'VOO', 'SCHB', 'RPV'])
    // …and a stock classifies off its sector.
    expect(tickersOf(computeInitialPeers(asset('ZZZZ', { type: 'stock', sector: 'Technology' }), []))).toEqual([
      'FTEC', 'VGT', 'XLK', 'BNGE', 'AVGO', 'CRM', 'IWF', 'NVDA',
    ])
    // A stock with no sector has too little signal → no peers, rather than wrong peers.
    expect(computeInitialPeers(asset('ZZZZ', { type: 'stock' }), [])).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// scorePeerSimilarity — component weights
// ══════════════════════════════════════════════════════════════════════════════

describe('scorePeerSimilarity', () => {
  it('freezes representative pairwise scores', () => {
    expect(scorePeerSimilarity(TAXONOMY.VIG, TAXONOMY.DGRO)).toBe(85)
    expect(scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY.FDVV)).toBe(85)
    expect(scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY.DGRW)).toBe(82)
    expect(scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY.VIG)).toBe(80)
    // dividend-growth vs high-yield is adjacent, not equal → below the gate on its own.
    expect(scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY.VYM)).toBe(52)
    expect(scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY.VYM)).toBeLessThan(MIN_PEER_SCORE)
  })

  it('hard-excludes a pair tracking the same benchmark (including an asset against itself)', () => {
    expect(scorePeerSimilarity(TAXONOMY.VIG, TAXONOMY.VIG)).toBe(0)
    expect(scorePeerSimilarity({ ...TAXONOMY.VIG }, { ...TAXONOMY.DGRO, benchmark: TAXONOMY.VIG.benchmark })).toBe(0)
  })

  it('hard-excludes same manager + same strategy (two share classes of one idea)', () => {
    expect(scorePeerSimilarity(TAXONOMY.QUAL, TAXONOMY.MTUM)).toBe(0) // both iShares quality-blend
  })

  it('returns 0 for strategies that are neither equal nor adjacent', () => {
    expect(scorePeerSimilarity(TAXONOMY.VIG, TAXONOMY.QQQ)).toBe(0)
  })

  it('freezes each optional-signal boost, measured against the SCHD/VYM baseline of 52', () => {
    const base = scorePeerSimilarity(TAXONOMY.SCHD, TAXONOMY.VYM)
    expect(base).toBe(52)
    const withSig = (a: object, b: object) =>
      scorePeerSimilarity({ ...TAXONOMY.SCHD, ...a }, { ...TAXONOMY.VYM, ...b })

    // Same Morningstar category: +25 — the single strongest dynamic signal, and the only one
    // large enough to pull a pair over the gate on its own (52 → 77).
    expect(withSig({ morningstarCategory: 'Large Value' }, { morningstarCategory: 'Large Value' })).toBe(77)
    // Same global category only: +12.
    expect(withSig({ globalCategory: 'US Eq Large Value' }, { globalCategory: 'US Eq Large Value' })).toBe(64)
    // Sector overlap Σmin(w): 0.25 + 0.20 = 0.45 → round(20 × 0.45) = +9.
    expect(withSig({ sectorWeights: { tech: 0.3, fin: 0.2 } }, { sectorWeights: { tech: 0.25, fin: 0.25 } })).toBe(61)
    // Holdings Jaccard 2/4 = 0.5 → round(15 × 0.5) = +8.
    expect(withSig({ holdings: ['A', 'B', 'C'] }, { holdings: ['A', 'B', 'D'] })).toBe(60)
    // Expense ratio within 10 bps: +3; within 25 bps: +1. Values are DECIMALS (0.0006 = 6 bps).
    expect(withSig({ expenseRatio: 0.0006 }, { expenseRatio: 0.001 })).toBe(55)
    expect(withSig({ expenseRatio: 0.0006 }, { expenseRatio: 0.0026 })).toBe(53)
    // Same AUM log-band: +2.
    expect(withSig({ aum: 5e9 }, { aum: 7e9 })).toBe(54)
    // Same country, trimmed and case-folded: +10.
    expect(withSig({ country: ' united states ' }, { country: 'United States' })).toBe(62)
    // Same market-cap band: +8.
    expect(withSig({ marketCap: 3e11 }, { marketCap: 9e11 })).toBe(60)
  })

  it('caps the total at 200 even with every signal aligned', () => {
    const rich = {
      morningstarCategory: 'X',
      globalCategory: 'Y',
      sectorWeights: { a: 1 },
      holdings: ['A', 'B', 'C'],
      expenseRatio: 0.0001,
      aum: 1e10,
      country: 'US',
      marketCap: 1e12,
    }
    const score = scorePeerSimilarity(
      { ...TAXONOMY.SCHD, ...rich },
      { ...TAXONOMY.SCHD, ...rich, benchmark: 'other-index', manager: 'other-manager' }
    )
    expect(score).toBe(183)
    expect(score).toBeLessThanOrEqual(200)
  })

  it('is symmetric for the pairs the engine actually ranks', () => {
    for (const [a, b] of [['SCHD', 'FDVV'], ['VIG', 'DGRO'], ['SCHD', 'VYM'], ['VIG', 'QQQ']] as const) {
      expect(scorePeerSimilarity(TAXONOMY[a], TAXONOMY[b]), `${a}/${b}`).toBe(
        scorePeerSimilarity(TAXONOMY[b], TAXONOMY[a])
      )
    }
  })
})
