import { describe, it, expect, vi } from 'vitest'

vi.mock('yahoo-finance2', () => ({ default: class { } }))

import { fetchBatchQuotes } from '@/lib/market/finnhub'

describe('SEC-03 fetchBatchQuotes', () => {
  it('con 200 tickers nunca hay más de 12 peticiones a Yahoo en vuelo', async () => {
    let active = 0
    let peak = 0
    vi.stubGlobal('fetch', async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return { ok: false }
    })
    const tickers = Array.from({ length: 200 }, (_, i) => `T${i}`)
    await fetchBatchQuotes(tickers)
    expect(peak).toBeLessThanOrEqual(12)
    vi.unstubAllGlobals()
  })
})
