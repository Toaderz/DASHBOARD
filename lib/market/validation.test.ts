import { describe, expect, it } from 'vitest'
import {
  MAX_TICKERS,
  MAX_TICKER_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  VALID_PERIODS,
  parseCalendarYear,
  parsePeriod,
  parseSearchQuery,
  parseTickerList,
} from '@/lib/market/validation'

describe('parsePeriod', () => {
  it('accepts every documented period', () => {
    for (const p of VALID_PERIODS) expect(parsePeriod(p)).toBe(p)
  })

  it('rejects unknown, wrong-cased and non-string input', () => {
    expect(parsePeriod('2Y')).toBeNull()
    expect(parsePeriod('ytd')).toBeNull() // Yahoo range map is keyed by 'YTD'
    expect(parsePeriod(null)).toBeNull()
    expect(parsePeriod(undefined)).toBeNull()
    expect(parsePeriod(1)).toBeNull()
    expect(parsePeriod(['1Y'])).toBeNull()
  })
})

describe('parseCalendarYear', () => {
  const now = new Date('2026-09-17T00:00:00Z')

  it('accepts plain years as string or number', () => {
    expect(parseCalendarYear('2024', now)).toBe(2024)
    expect(parseCalendarYear(2024, now)).toBe(2024)
    expect(parseCalendarYear(' 2024 ', now)).toBe(2024)
  })

  it("rejects '2024junk' — the parseInt bug this replaces", () => {
    // parseInt('2024junk', 10) returns 2024; Number('2024junk') is NaN.
    expect(parseCalendarYear('2024junk', now)).toBeNull()
    expect(parseCalendarYear('2024.5', now)).toBeNull()
    expect(parseCalendarYear('2e3', now)).toBe(2000) // still an exact integer, so allowed
  })

  it('rejects 999999999 and other out-of-range years', () => {
    expect(parseCalendarYear('999999999', now)).toBeNull()
    expect(parseCalendarYear(999999999, now)).toBeNull()
    expect(parseCalendarYear('-2024', now)).toBeNull()
    expect(parseCalendarYear('1899', now)).toBeNull()
    expect(parseCalendarYear('1900', now)).toBe(1900)
  })

  it('allows next year but not the one after', () => {
    expect(parseCalendarYear('2027', now)).toBe(2027)
    expect(parseCalendarYear('2028', now)).toBeNull()
  })

  it('rejects empty, null and non-scalar input', () => {
    expect(parseCalendarYear('', now)).toBeNull()
    expect(parseCalendarYear('   ', now)).toBeNull()
    expect(parseCalendarYear(null, now)).toBeNull()
    expect(parseCalendarYear(undefined, now)).toBeNull()
    expect(parseCalendarYear({}, now)).toBeNull()
    expect(parseCalendarYear([2024], now)).toBeNull()
  })
})

describe('parseTickerList', () => {
  it('parses a comma-separated query string, trimming and de-duplicating', () => {
    const r = parseTickerList(' SPY , QQQ ,SPY, ')
    expect(r.tickers).toEqual(['SPY', 'QQQ'])
    expect(r.truncated).toBe(false)
    expect(r.rejected).toBe(0)
  })

  it('parses a JSON array body', () => {
    expect(parseTickerList(['SPY', 'QQQ']).tickers).toEqual(['SPY', 'QQQ'])
    expect(parseTickerList([]).tickers).toEqual([])
    expect(parseTickerList(null).tickers).toEqual([])
    expect(parseTickerList(undefined).tickers).toEqual([])
  })

  it('PRESERVES CASING by default — upper-casing would blank prices app-wide', () => {
    // /api/market/quote keys its response with the exact client string and PostgREST `.in()` is
    // case-sensitive. This assertion is the regression guard for that.
    expect(parseTickerList('spy,Qqq').tickers).toEqual(['spy', 'Qqq'])
    expect(parseTickerList('spy,Qqq', { uppercase: true }).tickers).toEqual(['SPY', 'QQQ'])
  })

  it('keeps every exotic Yahoo symbol the catalogue actually uses', () => {
    const exotic = ['^GSPC', '^RUT', 'CL=F', 'GBPUSD=X', 'DX-Y.NYB', 'BRK-B', '0P0001CZXM.L', 'BTC-USD']
    expect(parseTickerList(exotic.join(',')).tickers).toEqual(exotic)
  })

  it('rejects malformed entries without throwing', () => {
    const r = parseTickerList(['SPY', 'has space', 'semi;colon', 42, null, '', 'A'.repeat(MAX_TICKER_LENGTH + 1)])
    expect(r.tickers).toEqual(['SPY'])
    expect(r.rejected).toBe(5) // empty string is not counted as a client error
  })

  it('caps the list and reports truncation', () => {
    const many = Array.from({ length: 20 }, (_, i) => `T${i}`)
    const r = parseTickerList(many, { max: 5 })
    expect(r.tickers).toHaveLength(5)
    expect(r.truncated).toBe(true)
  })

  it('defaults to the shared MAX_TICKERS cap (1500 — must NOT be lowered)', () => {
    expect(MAX_TICKERS).toBe(1500)
    const many = Array.from({ length: 600 }, (_, i) => `T${i}`)
    const r = parseTickerList(many)
    expect(r.tickers).toHaveLength(600) // a real ~475 peer union must pass untouched
    expect(r.truncated).toBe(false)
  })
})

describe('parseSearchQuery', () => {
  it('trims and length-caps', () => {
    expect(parseSearchQuery('  apple  ')).toBe('apple')
    expect(parseSearchQuery('x'.repeat(500))).toHaveLength(MAX_SEARCH_QUERY_LENGTH)
  })

  it('returns null for empty or non-string input', () => {
    expect(parseSearchQuery('')).toBeNull()
    expect(parseSearchQuery('   ')).toBeNull()
    expect(parseSearchQuery(null)).toBeNull()
    expect(parseSearchQuery(7)).toBeNull()
  })
})
