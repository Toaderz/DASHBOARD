import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks: ninguna prueba toca red, Supabase ni Yahoo ─────────────────────────
const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  fetchHistoricalData: vi.fn(),
  calculateReturn: vi.fn(),
  fetchCalendarYearReturn: vi.fn(),
  calculateMultiReturns: vi.fn(),
  fetchBatchQuotes: vi.fn(),
  fetchFundamentals: vi.fn(),
  createSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}))
vi.mock('@/lib/market/history', () => ({
  fetchHistoricalData: h.fetchHistoricalData,
  calculateReturn: h.calculateReturn,
  fetchCalendarYearReturn: h.fetchCalendarYearReturn,
  calculateMultiReturns: h.calculateMultiReturns,
}))
vi.mock('@/lib/market/finnhub', () => ({
  fetchBatchQuotes: h.fetchBatchQuotes,
  fetchFundamentals: h.fetchFundamentals,
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createSupabaseClient }))

import { GET as historyGET } from '@/app/api/market/history/route'
import { GET as exportGET } from '@/app/api/market/export/route'
import { POST as returnsPOST } from '@/app/api/market/returns/route'
import { GET as quoteGET } from '@/app/api/market/quote/route'
import { resetRateLimit } from '@/lib/api/rate-limit'

function chain() {
  const q: Record<string, unknown> = {}
  const self = () => q
  q.select = self
  q.in = async () => ({ data: [], error: null })
  q.upsert = async () => ({ error: null })
  return q
}

const get = (path: string) => new NextRequest(`http://localhost${path}`)
const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const ANON_KEY = 'anon-key-FAKE'
const SERVICE_KEY = 'service-key-FAKE'

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimit()
  h.user = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
  h.createSupabaseClient.mockReturnValue({ from: () => chain() })
  h.fetchHistoricalData.mockResolvedValue([])
  h.calculateReturn.mockResolvedValue({ value: 1.5, years: 1 })
  h.fetchCalendarYearReturn.mockResolvedValue({ value: 2.5 })
  h.calculateMultiReturns.mockResolvedValue({ returns: { '1Y': 1 }, years: {} })
  h.fetchBatchQuotes.mockResolvedValue(new Map())
  h.fetchFundamentals.mockResolvedValue({})
})

const externalCalls = () =>
  h.fetchHistoricalData.mock.calls.length +
  h.calculateReturn.mock.calls.length +
  h.fetchCalendarYearReturn.mock.calls.length +
  h.calculateMultiReturns.mock.calls.length +
  h.fetchBatchQuotes.mock.calls.length +
  h.fetchFundamentals.mock.calls.length

// ── SEC-05 history ────────────────────────────────────────────────────────────
describe('SEC-05 GET /api/market/history', () => {
  it('sin sesión → 401 y cero llamadas externas', async () => {
    const res = await historyGET(get('/api/market/history?ticker=AAPL&period=1Y'))
    expect(res.status).toBe(401)
    expect(externalCalls()).toBe(0)
  })
  it('ticker de 300 caracteres → 400', async () => {
    h.user = { id: 'u1' }
    const res = await historyGET(get(`/api/market/history?ticker=${'A'.repeat(300)}&period=1Y`))
    expect(res.status).toBe(400)
    expect(externalCalls()).toBe(0)
  })
  it.each(['99999', '-5', '1800', 'abc'])('year=%s → 400', async (y) => {
    h.user = { id: 'u1' }
    const res = await historyGET(get(`/api/market/history?ticker=AAPL&mode=calYear&year=${y}`))
    expect(res.status).toBe(400)
    expect(externalCalls()).toBe(0)
  })
  it('petición válida → 200 y normaliza el ticker', async () => {
    h.user = { id: 'u1' }
    const res = await historyGET(get('/api/market/history?ticker=aapl&mode=return&period=1Y'))
    expect(res.status).toBe(200)
    expect(h.calculateReturn).toHaveBeenCalledWith('AAPL', '1Y', 0)
  })
})

// ── SEC-04 export ─────────────────────────────────────────────────────────────
describe('SEC-04 GET /api/market/export', () => {
  it('sin sesión → 401 y cero llamadas externas', async () => {
    const res = await exportGET(get('/api/market/export?tickers=AAPL&period=1Y'))
    expect(res.status).toBe(401)
    expect(externalCalls()).toBe(0)
  })
  it('más de 50 tickers → 400, ya no se lanzan 200 a la vez', async () => {
    h.user = { id: 'u1' }
    const tickers = Array.from({ length: 200 }, (_, i) => `T${i}`).join(',')
    const res = await exportGET(get(`/api/market/export?tickers=${tickers}&period=1Y`))
    expect(res.status).toBe(400)
    expect(externalCalls()).toBe(0)
  })
  it('respeta la concurrencia con 50 tickers', async () => {
    h.user = { id: 'u1' }
    let active = 0
    let peak = 0
    h.fetchHistoricalData.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return []
    })
    const tickers = Array.from({ length: 50 }, (_, i) => `T${i}`).join(',')
    const res = await exportGET(get(`/api/market/export?tickers=${tickers}&period=1Y&format=json`))
    expect(res.status).toBe(200)
    expect(h.fetchHistoricalData).toHaveBeenCalledTimes(50)
    expect(peak).toBeLessThanOrEqual(6)
  })
})

// ── SEC-02 returns ────────────────────────────────────────────────────────────
describe('SEC-02 POST /api/market/returns', () => {
  it('sin sesión → 401, sin Supabase ni Yahoo', async () => {
    const res = await returnsPOST(post('/api/market/returns', { tickers: ['AAPL'] }))
    expect(res.status).toBe(401)
    expect(externalCalls()).toBe(0)
    expect(h.createSupabaseClient).not.toHaveBeenCalled()
  })
  it('todos los tickers inválidos → 400', async () => {
    h.user = { id: 'u1' }
    const res = await returnsPOST(post('/api/market/returns', { tickers: ['A'.repeat(300)] }))
    expect(res.status).toBe(400)
    expect(externalCalls()).toBe(0)
  })
  it('más de 1500 tickers → 400', async () => {
    h.user = { id: 'u1' }
    const tickers = Array.from({ length: 1501 }, (_, i) => `T${i}`)
    const res = await returnsPOST(post('/api/market/returns', { tickers }))
    expect(res.status).toBe(400)
    expect(externalCalls()).toBe(0)
  })
  it('sin SUPABASE_SERVICE_ROLE_KEY NO cae a la clave anon', async () => {
    h.user = { id: 'u1' }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const res = await returnsPOST(post('/api/market/returns', { tickers: ['AAPL'] }))
    expect(res.status).toBe(500)
    for (const call of h.createSupabaseClient.mock.calls) expect(call[1]).not.toBe(ANON_KEY)
  })
  it('petición válida → 200 con la clave de servicio', async () => {
    h.user = { id: 'u1' }
    const res = await returnsPOST(post('/api/market/returns', { tickers: ['aapl', 'AAPL', 'spy'] }))
    expect(res.status).toBe(200)
    expect(h.createSupabaseClient.mock.calls[0][1]).toBe(SERVICE_KEY)
    expect(h.calculateMultiReturns).toHaveBeenCalledTimes(2)
  })
})

// ── SEC-03 quote ──────────────────────────────────────────────────────────────
describe('SEC-03 GET /api/market/quote', () => {
  it('sin sesión → 401, sin Supabase ni Yahoo', async () => {
    const res = await quoteGET(get('/api/market/quote?tickers=AAPL'))
    expect(res.status).toBe(401)
    expect(externalCalls()).toBe(0)
    expect(h.createSupabaseClient).not.toHaveBeenCalled()
  })
  it('más de 1000 tickers → 400', async () => {
    h.user = { id: 'u1' }
    const tickers = Array.from({ length: 1001 }, (_, i) => `T${i}`).join(',')
    const res = await quoteGET(get(`/api/market/quote?tickers=${tickers}`))
    expect(res.status).toBe(400)
    expect(externalCalls()).toBe(0)
  })
  it('todos inválidos → 400', async () => {
    h.user = { id: 'u1' }
    const res = await quoteGET(get(`/api/market/quote?tickers=${'A'.repeat(300)}`))
    expect(res.status).toBe(400)
  })
  it('sin SUPABASE_SERVICE_ROLE_KEY NO cae a la clave anon', async () => {
    h.user = { id: 'u1' }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const res = await quoteGET(get('/api/market/quote?tickers=AAPL'))
    expect(res.status).toBe(500)
    for (const call of h.createSupabaseClient.mock.calls) expect(call[1]).not.toBe(ANON_KEY)
  })
  it('arranque en frío con 200 tickers respeta la concurrencia de fundamentals', async () => {
    h.user = { id: 'u1' }
    let active = 0
    let peak = 0
    h.fetchFundamentals.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return {}
    })
    const tickers = Array.from({ length: 200 }, (_, i) => `T${i}`).join(',')
    const res = await quoteGET(get(`/api/market/quote?tickers=${tickers}`))
    expect(res.status).toBe(200)
    expect(h.fetchFundamentals).toHaveBeenCalledTimes(200)
    expect(peak).toBeLessThanOrEqual(8)
  })
})
