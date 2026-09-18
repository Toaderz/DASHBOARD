/**
 * `GET /api/market/quote` — the fundamentals lease.
 *
 * The problem: candidates are ordered `fundamentals_fetched_at ASC NULLS FIRST` and cut to 12, so
 * the selection is DETERMINISTIC — two concurrent invocations pick exactly the same 12 tickers.
 * The client polls every 5 s from every open tab, so that duplication is guaranteed, not unlucky.
 *
 * The fake Postgres below models the one property the lease depends on: a conditional
 * `UPDATE … WHERE ticker IN (…) AND (started_at IS NULL OR started_at < cutoff) RETURNING ticker`
 * is atomic, so two racing callers get DISJOINT result sets. Matching happens synchronously inside
 * the fake, which is exactly the serialisation Postgres provides under READ COMMITTED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { getUser, fetchBatchQuotes, fetchFundamentals, hasFundamentalsSignal, fetchHistoricalData } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    fetchBatchQuotes: vi.fn(async (_tickers: string[]) => [] as Array<Record<string, unknown>>),
    fetchFundamentals: vi.fn(async (_ticker: string) => ({ beta: 1.1 }) as Record<string, unknown>),
    hasFundamentalsSignal: vi.fn((_f: unknown) => true),
    fetchHistoricalData: vi.fn(async (_t: string, _p: string) => [] as Array<Record<string, unknown>>),
  }))

const LEASE_STALE_MS = 90_000

interface Row {
  ticker: string
  price?: number
  last_updated?: string
  fundamentals_fetched_at?: string | null
  fundamentals_refresh_started_at?: string | null
  [key: string]: unknown
}

/** A minimal Postgres stand-in: just enough of PostgREST's shapes, with atomic conditional UPDATE. */
const db = vi.hoisted(() => ({
  price_cache: new Map<string, Record<string, unknown>>(),
  /** Every conditional claim: `{ requested, granted }`. */
  claims: [] as Array<{ requested: string[]; granted: string[] }>,
  releases: [] as string[][],
  upserts: [] as Array<Record<string, unknown>>,
  failClaim: false,
  throwClaim: false,
}))

vi.mock('@/lib/supabase/service-role', () => {
  /** Parses `col.is.null,col.lt."<iso>"` back into the cutoff. */
  const cutoffOf = (filter: string): string | null => {
    const m = filter.match(/\.lt\."([^"]+)"/)
    return m ? m[1] : null
  }

  const makeUpdate = (patch: Record<string, unknown>) => ({
    in(_col: string, tickers: string[]) {
      // Branch 1 — the CLAIM: `.or(...).select('ticker')`
      const or = (filter: string) => ({
        async select() {
          if (db.throwClaim) throw new Error('lease claim exploded')
          if (db.failClaim) return { data: null, error: { message: 'permission denied' } }
          const cutoff = cutoffOf(filter)
          // Atomic: match and write with no await in between.
          const granted: string[] = []
          for (const ticker of tickers) {
            const row = db.price_cache.get(ticker)
            if (!row) continue // an UPDATE cannot create a row
            const held = row.fundamentals_refresh_started_at as string | null | undefined
            const free = held == null || (cutoff != null && held < cutoff)
            if (!free) continue
            Object.assign(row, patch)
            granted.push(ticker)
          }
          db.claims.push({ requested: [...tickers], granted })
          return { data: granted.map((ticker) => ({ ticker })), error: null }
        },
      })

      // Branch 2 — the RELEASE: `.eq('fundamentals_refresh_started_at', claimIso)`
      const eq = async (col: string, value: unknown) => {
        const released: string[] = []
        for (const ticker of tickers) {
          const row = db.price_cache.get(ticker)
          if (!row || row[col] !== value) continue
          Object.assign(row, patch)
          released.push(ticker)
        }
        db.releases.push(released)
        return { error: null }
      }

      return { or, eq }
    },
  })

  return {
    createCacheClient: () => ({
      client: {
        from: (table: string) => ({
          select: () => ({
            in: async (_col: string, tickers: string[]) => ({
              data: tickers.map((t) => db.price_cache.get(t)).filter(Boolean),
              error: null,
            }),
          }),
          update: makeUpdate,
          upsert: async (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const list = Array.isArray(rows) ? rows : [rows]
            if (table === 'price_cache') {
              for (const row of list) {
                const ticker = row.ticker as string
                const existing = db.price_cache.get(ticker) ?? { ticker }
                Object.assign(existing, row)
                db.price_cache.set(ticker, existing)
                db.upserts.push(row)
              }
            }
            return { error: null }
          },
        }),
      },
      canWrite: true,
    }),
    createServiceRoleClient: () => ({}),
  }
})

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))
vi.mock('@/lib/market/finnhub', () => ({
  fetchBatchQuotes, fetchFundamentals, hasFundamentalsSignal, searchTickers: vi.fn(),
}))
vi.mock('@/lib/market/history', () => ({
  fetchHistoricalData,
  calculateReturn: vi.fn(),
  calculateMultiReturns: vi.fn(),
  fetchCalendarYearReturn: vi.fn(),
  calculateReturnDetailed: vi.fn(),
  fetchCalendarYearReturnDetailed: vi.fn(),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/market/quote/route'

const TICKERS = Array.from({ length: 30 }, (_, i) => `T${String(i).padStart(2, '0')}`)

const call = (tickers: string[] = TICKERS) =>
  GET(new NextRequest(`https://example.test/api/market/quote?tickers=${tickers.join(',')}`))

/** Rows with FRESH prices (so no Yahoo price fetch) but no fundamentals yet. */
function seedNeedingFundamentals(tickers: string[], overrides: Partial<Row> = {}) {
  const nowIso = new Date().toISOString()
  for (const ticker of tickers) {
    db.price_cache.set(ticker, {
      ticker,
      price: 100,
      change_percent: 0,
      last_updated: nowIso,
      fundamentals_fetched_at: null,
      fundamentals_refresh_started_at: null,
      ...overrides,
    })
  }
}

let savedSecret: string | undefined

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET
  delete process.env.CRON_SECRET
  db.price_cache = new Map()
  db.claims = []
  db.releases = []
  db.upserts = []
  db.failClaim = false
  db.throwClaim = false
  getUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
  fetchFundamentals.mockResolvedValue({ beta: 1.1 })
  hasFundamentalsSignal.mockReturnValue(true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
  vi.restoreAllMocks()
})

// ══════════════════════════════════════════════════════════════════════════════

describe('the claim', () => {
  it('leases before doing any work, and only works on what it owns', async () => {
    seedNeedingFundamentals(TICKERS)
    await call()
    expect(db.claims).toHaveLength(1)
    // Exactly the budget is offered for lease, not all 30 candidates.
    expect(db.claims[0].requested).toHaveLength(12)
    expect(fetchFundamentals).toHaveBeenCalledTimes(12)
    const worked = fetchFundamentals.mock.calls.map((c) => c[0] as string)
    expect(new Set(worked)).toEqual(new Set(db.claims[0].granted))
  })

  it('TWO CONCURRENT INVOCATIONS NEVER PICK THE SAME TICKER', async () => {
    seedNeedingFundamentals(TICKERS)
    const fetched: string[] = []
    fetchFundamentals.mockImplementation(async (ticker: string) => {
      fetched.push(ticker)
      return { beta: 1 }
    })

    // Both handlers are started before either completes, so their claims genuinely race.
    await Promise.all([call(), call()])

    // No ticker was fetched twice ACROSS the two invocations — the property that did not hold
    // before the lease, where both would have fetched the identical 12.
    expect(fetched.length).toBe(new Set(fetched).size)
    expect(db.claims).toHaveLength(2)
    // And the two granted sets are disjoint by construction.
    const [first, second] = db.claims
    expect(first.granted.filter((t) => second.granted.includes(t))).toEqual([])
    // The winner got real work; nothing was duplicated.
    expect(first.granted.length + second.granted.length).toBeLessThanOrEqual(12)
  })

  it('a ticker held by a LIVE lease is skipped, not duplicated', async () => {
    seedNeedingFundamentals(TICKERS)
    const held = TICKERS.slice(0, 5)
    for (const ticker of held) {
      db.price_cache.get(ticker)!.fundamentals_refresh_started_at = new Date(Date.now() - 1_000).toISOString()
    }
    await call()
    const worked = fetchFundamentals.mock.calls.map((c) => c[0] as string)
    for (const ticker of held) expect(worked).not.toContain(ticker)
    expect(worked).toHaveLength(7) // 12 offered − 5 already leased
  })

  it('a STALE lease is reclaimed — nothing can be locked out forever', async () => {
    seedNeedingFundamentals(TICKERS)
    const abandoned = TICKERS.slice(0, 12)
    for (const ticker of abandoned) {
      // A process that was killed mid-flight left this behind.
      db.price_cache.get(ticker)!.fundamentals_refresh_started_at =
        new Date(Date.now() - (LEASE_STALE_MS + 10_000)).toISOString()
    }
    await call()
    const worked = fetchFundamentals.mock.calls.map((c) => c[0] as string)
    expect(new Set(worked)).toEqual(new Set(abandoned))
  })

  it('the stale cutoff sits above any invocation that could still be alive', async () => {
    seedNeedingFundamentals(TICKERS)
    // Just inside the window ⇒ still considered live.
    for (const ticker of TICKERS) {
      db.price_cache.get(ticker)!.fundamentals_refresh_started_at =
        new Date(Date.now() - (LEASE_STALE_MS - 10_000)).toISOString()
    }
    await call()
    expect(fetchFundamentals).not.toHaveBeenCalled()
  })
})

describe('the release', () => {
  it('clears the lease in the SAME write that records the work', async () => {
    seedNeedingFundamentals(TICKERS)
    await call()
    const fundamentalsWrites = db.upserts.filter((r) => 'fundamentals_fetched_at' in r)
    expect(fundamentalsWrites).toHaveLength(12)
    for (const row of fundamentalsWrites) {
      expect(row.fundamentals_refresh_started_at).toBeNull()
      expect(row.fundamentals_fetched_at).toEqual(expect.any(String))
    }
    // Nothing is left holding a lease.
    for (const ticker of TICKERS) {
      expect(db.price_cache.get(ticker)!.fundamentals_refresh_started_at).toBeNull()
    }
  })

  it('releases a ticker whose fetch THREW — the upsert never ran for it', async () => {
    seedNeedingFundamentals(TICKERS)
    fetchFundamentals.mockImplementation(async (ticker: string) => {
      if (ticker === 'T00') throw new Error('quoteSummary exploded')
      return { beta: 1 }
    })
    await call()
    expect(db.price_cache.get('T00')!.fundamentals_refresh_started_at).toBeNull()
    expect(db.releases.flat()).toContain('T00')
  })

  it('a no-signal result still advances the clock AND releases', async () => {
    seedNeedingFundamentals(TICKERS)
    hasFundamentalsSignal.mockReturnValue(false)
    await call()
    const writes = db.upserts.filter((r) => 'fundamentals_fetched_at' in r)
    expect(writes).toHaveLength(12)
    for (const row of writes) {
      // No data columns written (that would blank curated values for 24 h) — clock + release only.
      expect(Object.keys(row).sort()).toEqual(
        ['fundamentals_fetched_at', 'fundamentals_refresh_started_at', 'ticker'].sort()
      )
      expect(row.fundamentals_refresh_started_at).toBeNull()
    }
  })

  it('the release only clears OUR stamp, so it cannot steal another request\'s lease', async () => {
    seedNeedingFundamentals(TICKERS)
    // T00's fetch throws → it goes down the explicit-release path. Meanwhile pretend someone else
    // re-stamped it with a different timestamp.
    fetchFundamentals.mockImplementation(async (ticker: string) => {
      if (ticker === 'T00') {
        db.price_cache.get('T00')!.fundamentals_refresh_started_at = 'SOMEONE-ELSES-LEASE'
        throw new Error('boom')
      }
      return { beta: 1 }
    })
    await call()
    expect(db.price_cache.get('T00')!.fundamentals_refresh_started_at).toBe('SOMEONE-ELSES-LEASE')
  })

  it('is idempotent: a second identical run changes nothing about the lease column', async () => {
    seedNeedingFundamentals(TICKERS)
    await call()
    const after = TICKERS.map((t) => db.price_cache.get(t)!.fundamentals_refresh_started_at)
    db.claims = []
    db.releases = []
    // Now the first 12 have fresh fundamentals, so the next 12 are the candidates.
    await call()
    expect(after.every((v) => v === null)).toBe(true)
    for (const ticker of TICKERS) {
      expect(db.price_cache.get(ticker)!.fundamentals_refresh_started_at).toBeNull()
    }
  })
})

describe('leasing fails OPEN', () => {
  it('a rejected claim still refreshes fundamentals (pre-lease behaviour), and says so', async () => {
    seedNeedingFundamentals(TICKERS)
    db.failClaim = true
    await call()
    // Efficiency control, not a correctness one: a DB that cannot lease must never stop the refresh.
    expect(fetchFundamentals).toHaveBeenCalledTimes(12)
  })

  it('a THROWN claim also fails open', async () => {
    seedNeedingFundamentals(TICKERS)
    db.throwClaim = true
    await call()
    expect(fetchFundamentals).toHaveBeenCalledTimes(12)
  })

  it('and never tries to release a lease it never took', async () => {
    seedNeedingFundamentals(TICKERS)
    db.failClaim = true
    fetchFundamentals.mockRejectedValue(new Error('boom'))
    await call()
    expect(db.releases).toHaveLength(0)
  })
})

describe('the rest of the handler is unaffected', () => {
  it('a fully fresh cache does no lease work at all', async () => {
    const nowIso = new Date().toISOString()
    seedNeedingFundamentals(TICKERS, { fundamentals_fetched_at: nowIso })
    const res = await call()
    expect(res.status).toBe(200)
    expect(db.claims).toHaveLength(0)
    expect(fetchFundamentals).not.toHaveBeenCalled()
  })

  it('still answers with the prices for every requested ticker', async () => {
    seedNeedingFundamentals(TICKERS)
    const res = await call(TICKERS.slice(0, 3))
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['T00', 'T01', 'T02'])
    expect(body.T00.price).toBe(100)
  })
})
