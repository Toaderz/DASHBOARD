import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Authorization gate for `/api/market/*`.
 *
 * The claim this suite has to prove is not merely "anonymous gets a 401" — it is that the 401
 * costs NOTHING: no Yahoo request, no provider request, no database read and no database write.
 * Every upstream is therefore a spy, and the assertions are on the spies, not only on the status.
 *
 * `lib/supabase/middleware.ts` exempts `/api` from the route gate, so these handlers are the only
 * thing enforcing this. If someone moves `requireUser()` below the parsing or the cache read, the
 * `no upstream work` tests below fail.
 */

vi.mock('server-only', () => ({}))

const {
  getUser,
  createCacheClient,
  fetchBatchQuotes,
  fetchFundamentals,
  hasFundamentalsSignal,
  searchTickers,
  fetchHistoricalData,
  calculateReturn,
  calculateMultiReturns,
  fetchCalendarYearReturn,
  cacheFrom,
  cacheUpsert,
} = vi.hoisted(() => {
  return {
    getUser: vi.fn(),
    // Pure call recorders: the fake cache client is assembled in the `vi.mock` factory below, which
    // is where the per-test rows live. What matters here is only WHETHER they were called.
    createCacheClient: vi.fn(),
    cacheFrom: vi.fn(),
    cacheUpsert: vi.fn(async () => ({ error: null })),
    fetchBatchQuotes: vi.fn(async () => []),
    fetchFundamentals: vi.fn(async () => ({})),
    hasFundamentalsSignal: vi.fn(() => false),
    searchTickers: vi.fn(async () => [{ ticker: 'AAPL', name: 'Apple Inc.', type: 'stock' }]),
    fetchHistoricalData: vi.fn(async () => [{ date: '2024-01-02', close: 100 }]),
    calculateReturn: vi.fn(async () => ({ value: 12.5, years: 1 })),
    calculateMultiReturns: vi.fn(async () => ({ returns: { '1Y': 10 }, years: { '1Y': 1 } })),
    fetchCalendarYearReturn: vi.fn(async () => ({ value: 7.5 })),
  }
})

// The cache rows live on the hoisted object so tests can mutate them.
const cacheState = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }))
vi.mock('@/lib/supabase/service-role', () => ({
  createCacheClient: (...args: unknown[]) => {
    void args
    createCacheClient()
    return {
      client: {
        from: (table: string) => {
          cacheFrom(table)
          return {
            select: () => ({ in: async () => ({ data: cacheState.rows[table] ?? [], error: null }) }),
            upsert: cacheUpsert,
          }
        },
      },
      canWrite: true,
    }
  },
  createServiceRoleClient: () => ({}),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

vi.mock('@/lib/market/finnhub', () => ({
  fetchBatchQuotes,
  fetchFundamentals,
  hasFundamentalsSignal,
  searchTickers,
}))

vi.mock('@/lib/market/history', () => ({
  fetchHistoricalData,
  calculateReturn,
  calculateMultiReturns,
  fetchCalendarYearReturn,
}))

import { NextRequest } from 'next/server'
import { GET as quoteGET } from '@/app/api/market/quote/route'
import { POST as returnsPOST } from '@/app/api/market/returns/route'
import { GET as historyGET } from '@/app/api/market/history/route'
import { GET as searchGET } from '@/app/api/market/search/route'

const BASE = 'https://example.test'
const get = (path: string, headers?: Record<string, string>) =>
  new NextRequest(`${BASE}${path}`, headers ? { headers } : undefined)
const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  new NextRequest(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })

/** Every upstream + DB spy. A 401 must leave ALL of them untouched. */
const upstreamSpies = () => [
  fetchBatchQuotes,
  fetchFundamentals,
  searchTickers,
  fetchHistoricalData,
  calculateReturn,
  calculateMultiReturns,
  fetchCalendarYearReturn,
]
const dbSpies = () => [createCacheClient, cacheFrom, cacheUpsert]

const expectNoUpstreamWork = () => {
  for (const spy of upstreamSpies()) expect(spy).not.toHaveBeenCalled()
  for (const spy of dbSpies()) expect(spy).not.toHaveBeenCalled()
  // Belt and braces: even a path we forgot to mock cannot reach the network.
  expect(globalThis.fetch).not.toHaveBeenCalled()
}

const anonymous = () => getUser.mockResolvedValue({ data: { user: null }, error: null })
const signedIn = () =>
  getUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'a@b.test' } }, error: null })

/**
 * Every request an anonymous caller could make, one per handler.
 * `call(headers)` so the same table can be replayed with an Authorization header.
 */
type Headers = Record<string, string> | undefined
const ALL_ROUTES: Array<{ name: string; call: (h?: Headers) => Promise<Response> }> = [
  { name: 'quote', call: (h) => quoteGET(get('/api/market/quote?tickers=AAPL,MSFT', h)) },
  { name: 'returns', call: (h) => returnsPOST(post('/api/market/returns', { tickers: ['AAPL'] }, h)) },
  { name: 'history (chart)', call: (h) => historyGET(get('/api/market/history?ticker=AAPL&period=5Y', h)) },
  { name: 'history (return)', call: (h) => historyGET(get('/api/market/history?ticker=AAPL&period=1Y&mode=return', h)) },
  { name: 'history (calYear)', call: (h) => historyGET(get('/api/market/history?ticker=AAPL&year=2024&mode=calYear', h)) },
  { name: 'search', call: (h) => searchGET(get('/api/market/search?q=apple', h)) },
]

let savedSecret: string | undefined

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  cacheState.rows = {}
  for (const spy of [...upstreamSpies(), ...dbSpies(), getUser]) spy.mockClear()
  // A real network call inside a unit test is itself a failure; this makes it assertable.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network access is blocked in tests'))))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('anonymous callers are rejected', () => {
  it.each(ALL_ROUTES)('401s $name', async ({ call }) => {
    anonymous()
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it.each(ALL_ROUTES)('$name: a 401 performs NO upstream fetch and NO database access', async ({ call }) => {
    anonymous()
    const res = await call()
    expect(res.status).toBe(401)
    expectNoUpstreamWork()
  })

  it('401s BEFORE reading the request body (returns never parses an anonymous POST)', async () => {
    anonymous()
    // A body that would blow up `parseTickerList` if it ever got that far.
    const res = await returnsPOST(post('/api/market/returns', { tickers: Array(5000).fill('AAA') }))
    expect(res.status).toBe(401)
    expectNoUpstreamWork()
  })

  it('401s BEFORE input validation — a malformed request is still just 401, never 400', async () => {
    anonymous()
    // Missing tickers / invalid year / invalid period would each be a 400 for a signed-in caller.
    for (const res of await Promise.all([
      quoteGET(get('/api/market/quote')),
      historyGET(get('/api/market/history?ticker=AAPL&year=2024junk&mode=calYear')),
      historyGET(get('/api/market/history?ticker=AAPL&period=NOPE&mode=return')),
    ])) {
      expect(res.status).toBe(401)
    }
    expectNoUpstreamWork()
  })

  it('a thrown Supabase client still fails closed on every route', async () => {
    getUser.mockRejectedValue(new Error('cookie store exploded'))
    for (const { call } of ALL_ROUTES) {
      expect((await call()).status).toBe(401)
    }
    expectNoUpstreamWork()
  })
})

describe('the cron bearer branch is unreachable with CRON_SECRET unset', () => {
  // `Bearer undefined` is the literal string the old cron check authenticated when the secret was
  // missing (`Bearer ${process.env.CRON_SECRET}` with the var unset). It must reach nothing here.
  it.each(ALL_ROUTES)('$name still 401s for "Bearer undefined"', async ({ call }) => {
    delete process.env.CRON_SECRET
    anonymous()
    const res = await call({ Authorization: 'Bearer undefined' })
    expect(res.status).toBe(401)
    expectNoUpstreamWork()
  })

  it.each(ALL_ROUTES)('$name still 401s for an empty CRON_SECRET', async ({ call }) => {
    process.env.CRON_SECRET = ''
    anonymous()
    const res = await call({ Authorization: 'Bearer ' })
    expect(res.status).toBe(401)
    expectNoUpstreamWork()
  })
})

describe('authenticated callers get real data', () => {
  it('quote returns a populated body (served from cache, so no Yahoo call)', async () => {
    signedIn()
    const nowIso = new Date().toISOString()
    cacheState.rows = {
      price_cache: [{ ticker: 'AAPL', price: 190.5, change_percent: 1.2, last_updated: nowIso, fundamentals_fetched_at: nowIso }],
    }
    const res = await quoteGET(get('/api/market/quote?tickers=AAPL'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.AAPL).toMatchObject({ ticker: 'AAPL', price: 190.5 })
    expect(fetchBatchQuotes).not.toHaveBeenCalled()
  })

  it('quote preserves the EXACT ticker casing the client sent (response keys must match)', async () => {
    signedIn()
    const nowIso = new Date().toISOString()
    cacheState.rows = {
      price_cache: [{ ticker: '0P00000R12.L', price: 12.3, last_updated: nowIso, fundamentals_fetched_at: nowIso }],
    }
    const res = await quoteGET(get('/api/market/quote?tickers=0P00000R12.L'))
    const body = await res.json()
    // Upper-casing here would key the response '0P00000R12.L' → prices render blank app-wide.
    expect(Object.keys(body)).toEqual(['0P00000R12.L'])
  })

  it('returns serves the cached bundle for a signed-in caller', async () => {
    signedIn()
    cacheState.rows = {
      returns_cache: [{ ticker: 'AAPL', returns: { '1Y': 10 }, years: { '1Y': 1 }, fetched_at: new Date().toISOString() }],
    }
    const res = await returnsPOST(post('/api/market/returns', { tickers: ['AAPL'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ AAPL: { returns: { '1Y': 10 }, years: { '1Y': 1 } } })
  })

  it('history (return / calYear / chart) answers 200 with the upstream value', async () => {
    signedIn()
    const ret = await historyGET(get('/api/market/history?ticker=AAPL&period=1Y&mode=return'))
    expect(ret.status).toBe(200)
    expect(await ret.json()).toEqual({ ticker: 'AAPL', period: '1Y', return: 12.5, years: 1 })

    const cal = await historyGET(get('/api/market/history?ticker=AAPL&year=2024&mode=calYear'))
    expect(await cal.json()).toEqual({ ticker: 'AAPL', year: 2024, return: 7.5 })

    const chart = await historyGET(get('/api/market/history?ticker=AAPL&period=5Y'))
    const chartBody = await chart.json()
    expect(chartBody.period).toBe('5Y')
    expect(chartBody.data).toHaveLength(1)
  })

  it('search answers 200 with results', async () => {
    signedIn()
    const res = await searchGET(get('/api/market/search?q=apple'))
    expect(res.status).toBe(200)
    expect((await res.json()).results).toHaveLength(1)
  })

  it('the cron bearer reaches the data path when CRON_SECRET IS set', async () => {
    process.env.CRON_SECRET = 'a-real-cron-secret'
    anonymous() // no session at all — the bearer is what gets it through
    const res = await searchGET(
      new NextRequest(`${BASE}/api/market/search?q=apple`, {
        headers: { Authorization: 'Bearer a-real-cron-secret' },
      })
    )
    expect(res.status).toBe(200)
    expect(searchTickers).toHaveBeenCalled()
  })
})

describe('input validation (signed in) — the debt PR2 left for this PR', () => {
  beforeEach(() => signedIn())

  it('rejects a junk year instead of parseInt-ing it to 2024', async () => {
    const res = await historyGET(get('/api/market/history?ticker=AAPL&year=2024junk&mode=calYear'))
    expect(res.status).toBe(400)
    expect(fetchCalendarYearReturn).not.toHaveBeenCalled()
  })

  it('rejects an unbounded year', async () => {
    const res = await historyGET(get('/api/market/history?ticker=AAPL&year=999999999&mode=calYear'))
    expect(res.status).toBe(400)
    expect(fetchCalendarYearReturn).not.toHaveBeenCalled()
  })

  it('chart mode 400s on an invalid period instead of silently serving 1Y', async () => {
    const res = await historyGET(get('/api/market/history?ticker=AAPL&period=BOGUS'))
    expect(res.status).toBe(400)
    expect(fetchHistoricalData).not.toHaveBeenCalled()
  })

  it('chart mode keeps the documented 1Y default when no period is sent at all', async () => {
    const res = await historyGET(get('/api/market/history?ticker=AAPL'))
    expect(res.status).toBe(200)
    expect((await res.json()).period).toBe('1Y')
    expect(fetchHistoricalData).toHaveBeenCalledWith('AAPL', '1Y')
  })

  it('return mode 400s on an invalid period', async () => {
    const res = await historyGET(get('/api/market/history?ticker=AAPL&period=BOGUS&mode=return'))
    expect(res.status).toBe(400)
    expect(calculateReturn).not.toHaveBeenCalled()
  })

  it('accepts the real catalogue symbols (indices, FX, Morningstar fund ids)', async () => {
    for (const ticker of ['^GSPC', 'GBPUSD=X', 'DX-Y.NYB', 'BRK-B', '0P0001CZXM.L']) {
      const res = await historyGET(get(`/api/market/history?ticker=${encodeURIComponent(ticker)}&period=1Y&mode=return`))
      expect(res.status).toBe(200)
    }
  })

  it('rejects a malformed ticker before it reaches the outbound Yahoo URL', async () => {
    const res = await historyGET(get('/api/market/history?ticker=' + encodeURIComponent('AA PL/../x')))
    expect(res.status).toBe(400)
    expect(fetchHistoricalData).not.toHaveBeenCalled()
  })

  it('length-caps the search query at the route boundary', async () => {
    const res = await searchGET(get('/api/market/search?q=' + 'a'.repeat(500)))
    expect(res.status).toBe(200)
    expect(searchTickers).toHaveBeenCalledWith('a'.repeat(64))
  })

  it('an empty search query is an empty result set, not an error (the UI types into it)', async () => {
    const res = await searchGET(get('/api/market/search?q=%20%20'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
    expect(searchTickers).not.toHaveBeenCalled()
  })
})

describe('MAX_TICKERS stays at 1500 — Beating Peers posts the ~475-ticker union', () => {
  it('accepts a 475-ticker POST without truncation', async () => {
    signedIn()
    const union = Array.from({ length: 475 }, (_, i) => `TCK${i}`)
    cacheState.rows = {
      returns_cache: union.map((ticker) => ({
        ticker, returns: { '1Y': 1 }, years: { '1Y': 1 }, fetched_at: new Date().toISOString(),
      })),
    }
    const res = await returnsPOST(post('/api/market/returns', { tickers: union }))
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json())).toHaveLength(475)
    expect(calculateMultiReturns).not.toHaveBeenCalled()
  })
})
