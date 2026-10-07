import { describe, it, expect } from 'vitest'
import { normalizeTicker, parseTickerList, parseYear } from '@/lib/market/validation'
import { rateLimit, resetRateLimit } from '@/lib/api/rate-limit'
import { mapWithConcurrency } from '@/lib/utils/concurrency'

describe('normalizeTicker', () => {
  it.each(['AAPL', 'aapl', '^GSPC', 'GBPUSD=X', '0P00000R12.L', 'BRK-B', 'BTC-USD'])('acepta %s', (t) => {
    expect(normalizeTicker(t)).toBe(t.toUpperCase())
  })
  it.each(['', ' ', 'A'.repeat(21), 'AAPL;DROP', 'a b', '../etc', 'AAPL/../x', 'ÑU'])('rechaza %j', (t) => {
    expect(normalizeTicker(t)).toBeNull()
  })
  it('rechaza lo que no es string', () => {
    expect(normalizeTicker(123)).toBeNull()
    expect(normalizeTicker(null)).toBeNull()
    expect(normalizeTicker({})).toBeNull()
  })
})

describe('parseTickerList', () => {
  it('acepta CSV, normaliza y deduplica', () => {
    const r = parseTickerList('aapl, AAPL ,msft', 50)
    expect(r).toEqual({ tickers: ['AAPL', 'MSFT'], invalid: 0, tooMany: false })
  })
  it('acepta arrays', () => {
    expect(parseTickerList(['spy', 'SPY', '^GSPC'], 50).tickers).toEqual(['SPY', '^GSPC'])
  })
  it('descarta inválidos y los cuenta', () => {
    const r = parseTickerList(['AAPL', 'X'.repeat(300), 5, 'bad ticker'], 50)
    expect(r.tickers).toEqual(['AAPL'])
    expect(r.invalid).toBe(3)
  })
  it('marca tooMany al pasar el tope, sin truncar en silencio', () => {
    const many = Array.from({ length: 51 }, (_, i) => `T${i}`)
    const r = parseTickerList(many, 50)
    expect(r.tooMany).toBe(true)
    expect(r.tickers).toHaveLength(0)
  })
  it('entrada vacía o de tipo raro no revienta', () => {
    expect(parseTickerList(undefined, 50).tickers).toEqual([])
    expect(parseTickerList({}, 50).tickers).toEqual([])
  })
})

describe('parseYear', () => {
  const now = new Date().getUTCFullYear()
  it('acepta años razonables', () => {
    expect(parseYear('2019')).toBe(2019)
    expect(parseYear(String(now))).toBe(now)
  })
  it.each(['99999', '-5', '1800', 'abc', '', '2020.5', String(now + 1)])('rechaza %j', (y) => {
    expect(parseYear(y)).toBeNull()
  })
  it('rechaza null', () => expect(parseYear(null)).toBeNull())
})

describe('rateLimit', () => {
  it('permite hasta el límite y luego bloquea con retryAfter', () => {
    resetRateLimit()
    for (let i = 0; i < 3; i++) expect(rateLimit('u1:x', 3, 60_000).ok).toBe(true)
    const blocked = rateLimit('u1:x', 3, 60_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })
  it('separa por clave', () => {
    resetRateLimit()
    expect(rateLimit('a', 1, 60_000).ok).toBe(true)
    expect(rateLimit('b', 1, 60_000).ok).toBe(true)
    expect(rateLimit('a', 1, 60_000).ok).toBe(false)
  })
  it('libera la ventana al pasar el tiempo', () => {
    resetRateLimit()
    expect(rateLimit('c', 1, 1000, 0).ok).toBe(true)
    expect(rateLimit('c', 1, 1000, 500).ok).toBe(false)
    expect(rateLimit('c', 1, 1000, 1500).ok).toBe(true)
  })
})

describe('mapWithConcurrency', () => {
  it('nunca excede el límite y conserva el orden', async () => {
    let active = 0
    let peak = 0
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
  })
})
