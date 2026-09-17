import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The helper resolves the session through the SSR client, which needs `next/headers` cookies.
// Only the client is stubbed; the gate logic under test is the real thing.
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))

import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/require-user'

const CTX = { endpoint: 'test', cid: 'cid-0001' }
const SECRET = 'cron-secret-value'

const req = (auth?: string) =>
  new Request('https://example.test/api/market/quote?tickers=AAPL', {
    headers: auth ? { Authorization: auth } : {},
  })

const anonymous = () => getUser.mockResolvedValue({ data: { user: null }, error: null })
const signedIn = () =>
  getUser.mockResolvedValue({ data: { user: { id: 'u-1', email: 'a@b.test' } }, error: null })

let savedSecret: string | undefined

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  getUser.mockReset()
  vi.mocked(createClient).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  vi.restoreAllMocks()
})

describe('requireUser — session branch', () => {
  it('401s an anonymous caller', async () => {
    anonymous()
    const result = await requireUser(req(), CTX)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.response.status).toBe(401)
  })

  it('401s when Supabase reports an auth error', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'jwt expired' } })
    const result = await requireUser(req(), CTX)
    expect(result.ok).toBe(false)
  })

  it('FAILS CLOSED when the Supabase client throws — a thrown error is not a pass', async () => {
    getUser.mockRejectedValue(new Error('cookie store exploded'))
    const result = await requireUser(req(), CTX)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.response.status).toBe(401)
  })

  it('returns the user for a valid session', async () => {
    signedIn()
    const result = await requireUser(req(), CTX)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.user).toEqual({ id: 'u-1', email: 'a@b.test', via: 'session' })
  })

  it('never says WHY it failed (no session vs bad token are indistinguishable)', async () => {
    anonymous()
    const anon = await requireUser(req(), CTX)
    process.env.CRON_SECRET = SECRET
    const badToken = await requireUser(req('Bearer nope'), CTX)

    if (anon.ok || badToken.ok) throw new Error('unreachable')
    expect(await anon.response.json()).toEqual({ error: 'Unauthorized' })
    expect(await badToken.response.json()).toEqual({ error: 'Unauthorized' })
  })
})

describe('requireUser — cron bearer branch is GUARDED', () => {
  it('is UNREACHABLE with CRON_SECRET unset: "Bearer undefined" does not authenticate', async () => {
    delete process.env.CRON_SECRET
    anonymous()
    // This is the exact string the old cron bug authenticated (`Bearer ${undefined}`).
    for (const header of ['Bearer undefined', 'Bearer ', 'Bearer null', 'Bearer ']) {
      const result = await requireUser(req(header), CTX)
      expect(result.ok).toBe(false)
    }
    // It fell through to the session check rather than short-circuiting as authorized.
    expect(getUser).toHaveBeenCalled()
  })

  it('is UNREACHABLE with CRON_SECRET empty', async () => {
    process.env.CRON_SECRET = ''
    anonymous()
    for (const header of ['Bearer ', 'Bearer undefined', 'Bearer ']) {
      const result = await requireUser(req(header), CTX)
      expect(result.ok).toBe(false)
    }
  })

  it('authorizes the exact bearer when the secret IS set, without touching GoTrue', async () => {
    process.env.CRON_SECRET = SECRET
    anonymous()
    const result = await requireUser(req(`Bearer ${SECRET}`), CTX)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.user.via).toBe('cron')
    expect(getUser).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret, a bare token, a wrong scheme and wrong casing', async () => {
    process.env.CRON_SECRET = SECRET
    anonymous()
    for (const header of [
      undefined,
      SECRET,
      `Basic ${SECRET}`,
      `bearer ${SECRET}`,
      'Bearer cron-secret-valuX', // same length, different content
    ]) {
      const result = await requireUser(req(header), CTX)
      expect(result.ok).toBe(false)
    }
  })
})
