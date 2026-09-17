import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Client-side handling of a revoked session.
 *
 * The risk this guards is a LOOP: a single dashboard render has many `/api/market/*` requests in
 * flight at once (quote + returns + N history), and when the session dies they all come back 401
 * together. One sign-out and one redirect — never one per response.
 */

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut } }),
}))

import { marketFetch, __resetSignOutLatchForTests } from '@/lib/auth/market-fetch'

const replace = vi.fn()

const res = (status: number) => new Response(JSON.stringify({}), { status })

/** `location.pathname` decides whether the redirect is suppressed. */
function stubWindow(pathname = '/watchlist/1') {
  vi.stubGlobal('window', { location: { pathname, replace } })
}

/** Lets pending `.finally()` callbacks on the sign-out promise run. */
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  __resetSignOutLatchForTests()
  signOut.mockClear()
  replace.mockClear()
  stubWindow()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('marketFetch — transparent passthrough', () => {
  it('returns the response untouched on success (no signature or behaviour change)', async () => {
    const ok = res(200)
    vi.stubGlobal('fetch', vi.fn(async () => ok))
    stubWindow()

    const out = await marketFetch('/api/market/quote?tickers=AAPL')
    expect(out).toBe(ok)
    expect(signOut).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('forwards init (method/headers/body) verbatim — the returns POST must survive', async () => {
    const spy = vi.fn(async () => res(200))
    vi.stubGlobal('fetch', spy)
    stubWindow()

    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"tickers":["AAPL"]}' }
    await marketFetch('/api/market/returns', init)
    expect(spy).toHaveBeenCalledWith('/api/market/returns', init)
  })

  it('still returns the 401 response so existing `if (!res.ok)` paths behave as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401)))
    stubWindow()

    const out = await marketFetch('/api/market/quote?tickers=AAPL')
    expect(out.status).toBe(401)
  })

  it('rethrows network errors unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    stubWindow()

    await expect(marketFetch('/api/market/quote')).rejects.toThrow('offline')
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not sign out on other error statuses (400/500 are not session problems)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(500)))
    stubWindow()

    await marketFetch('/api/market/history?ticker=AAPL')
    await flush()
    expect(signOut).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('marketFetch — revoked session', () => {
  it('signs out and redirects to /login on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401)))
    stubWindow()

    await marketFetch('/api/market/quote?tickers=AAPL')
    await flush()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('NO LOOP: a burst of concurrent 401s signs out and redirects exactly once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401)))
    stubWindow()

    // What a real dashboard render looks like when the session dies mid-poll.
    await Promise.all([
      marketFetch('/api/market/quote?tickers=AAPL'),
      marketFetch('/api/market/returns', { method: 'POST' }),
      ...Array.from({ length: 10 }, (_, i) => marketFetch(`/api/market/history?ticker=T${i}`)),
    ])
    await flush()

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('NO LOOP: later 401s after the first are ignored (the latch never re-arms)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401)))
    stubWindow()

    await marketFetch('/api/market/quote')
    await flush()
    await marketFetch('/api/market/quote')
    await marketFetch('/api/market/quote')
    await flush()

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('NEVER redirects from /login itself', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401)))
    stubWindow('/login')

    await marketFetch('/api/market/quote')
    await flush()
    expect(signOut).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('redirects even when signOut rejects — a failed sign-out must not strand the user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401)))
    stubWindow()
    signOut.mockRejectedValueOnce(new Error('network'))

    await marketFetch('/api/market/quote')
    await flush()
    expect(replace).toHaveBeenCalledWith('/login')
  })
})
