import { NextRequest, NextResponse } from 'next/server'
import {
  calculateMultiReturns,
  calculateReturnDetailed,
  fetchCalendarYearReturnDetailed,
  type MultiReturnPeriod,
  type MultiReturns,
  type SeriesStatus,
} from '@/lib/market/history'
import { createCacheClient } from '@/lib/supabase/service-role'
import { mapWithConcurrency } from '@/lib/utils/concurrency'
import { MAX_TICKERS, parseCalendarYear, parsePeriod, parseTickerList, type Period } from '@/lib/market/validation'
import { requireUser } from '@/lib/auth/require-user'
import { OBS, errMessage, newCorrelationId, obsInfo, obsError, obsWarn, startTimer } from '@/lib/utils/obs'

// The full Beating-Peers union (several hundred tickers) can need many cold Yahoo fetches on a
// cache miss; allow headroom over Vercel's default so a partial-cold load completes instead of
// timing out and blanking every peer. Cached loads still return in ~3s.
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// TWO CONSUMERS, TWO SEMANTICS, ONE CACHE — AND NO CROSS-CONTAMINATION
// ─────────────────────────────────────────────────────────────────────────────
//
// `returns_cache.returns` is JSONB, so this endpoint serves both consumers with no DDL. What it
// must NEVER do is let them read each other's numbers, because THEY ARE NOT THE SAME NUMBERS.
// Measured on the golden fixtures (`lib/market/returns-parity.test.ts` freezes this):
//
//   period   derived from ONE 1Y series   own range= request      Δ
//   1W       0.38461538461538336 %        0.30745580322829164 %   0.077 pp
//   6M      11.063829787234045  %        11.158432708688238  %   0.095 pp
//   YTD     24.88038277511962   %        24.999999999999993  %   0.120 pp
//
// Different date anchors, therefore different figures. So:
//
//   · Beating Peers (`usePeerComparison`) reads the DERIVED bundle, stored under the bare period
//     keys `1W | 1M | 6M | YTD | 1Y` exactly as before. Untouched, byte for byte.
//   · The watchlist / Top-Bottom performers (`usePerformanceMetrics`, `useTopPerformers`) read
//     PER-PERIOD values computed by `calculateReturnDetailed` — the same function
//     `/api/market/history?mode=return` uses — stored under `perf:<PERIOD>` and `cy:<YEAR>`.
//
// The prefixes are deliberately visible in the wire format: a key without a prefix is a derived
// value and can never be mistaken for a per-period one, in the cache or in the network tab.
const PERF_PREFIX = 'perf:'
const CY_PREFIX = 'cy:'
/** Per-key fetch timestamps live inside the same JSONB under this prefix (epoch ms). */
const TS_PREFIX = 'ts:'

const perfKey = (period: string) => `${PERF_PREFIX}${period}`
const cyKey = (year: number) => `${CY_PREFIX}${year}`

/**
 * The derived bundle's key set, spelled out on purpose.
 *
 * It CANNOT be `[...MULTI_RETURN_PERIODS]`: `app/api/market/auth.test.ts` replaces the whole
 * `@/lib/market/history` module with a mock that exports four functions and no constants, so
 * touching that array at module scope would throw at import time. The type annotation below is
 * the drift guard instead — it is a compile error if these ever stop being the documented set.
 */
const DERIVED_PERIODS: readonly MultiReturnPeriod[] = ['1W', '1M', '6M', 'YTD', '1Y']

// ── TTLs ─────────────────────────────────────────────────────────────────────

/** Derived bundle. Unchanged: returns change daily, 6 h is fresh enough and spares Yahoo. */
const DERIVED_TTL_MS = 6 * 60 * 60_000

/**
 * Per-period values: 1 h, NOT 6 h.
 *
 * These figures used to come from `/api/market/history?mode=return`, whose outbound Yahoo fetch
 * carries `next: { revalidate: 3600 }` — so the watchlist's observed freshness has always been
 * ≤1 h. Reusing the 6 h bundle TTL here would have made the watchlist STALER than before this
 * change, which is a regression dressed up as an optimisation.
 *
 * And no, a long period does not deserve a longer TTL: the right edge of a 10Y window is today's
 * close, so a 10Y return moves every day by exactly as many points as a 1W one. The only genuinely
 * immutable case is a CLOSED calendar year — that one gets the long TTL below.
 */
const PERIOD_TTL_MS = 60 * 60_000

/** A finished calendar year cannot change. 6 of the 7 CY columns become free after one fetch. */
const CLOSED_YEAR_TTL_MS = 30 * 24 * 60 * 60_000

// ── Execution limits ─────────────────────────────────────────────────────────
// INPUT LIMIT ≠ EXECUTION LIMIT. Accepting 1500 tickers never means 1500 upstream requests.

/** Cap concurrent Yahoo fetches to avoid rate limiting on cold loads. */
const FETCH_CONCURRENCY = 8

/**
 * Hard ceiling on (ticker × key) fetches per request. 1500 tickers × 16 keys is 24 000 work items;
 * the point of this number is that such a request costs 600 upstream fetches, not 24 000. The
 * remainder is served from last-good and refreshed on a later poll — the same warm-up strategy
 * `/api/market/quote` uses for fundamentals.
 */
const PERIOD_ITEM_BUDGET = 600

/**
 * No NEW per-period fetch starts after this many ms into the request.
 *
 * Netlify's ~10 s synchronous-function ceiling is NOT extended by `maxDuration`, so the budget
 * above is not enough on its own: 600 slow fetches would still blow through it. 7 s leaves ~3 s
 * for the Supabase round-trips and serialisation.
 */
const PERIOD_DEADLINE_MS = 7_000

/** 9 periods + 7 calendar years = 16 today. 24 is headroom; more is not a real client. */
const MAX_RETURN_KEYS = 24

// MAX_TICKERS (1500) and the ticker grammar live in lib/market/validation.ts — one definition
// shared with /api/market/quote. The cap is purely an abuse guard: Beating-Peers legitimately sends
// the full union (assets ∪ all peers), ~475 for a real portfolio, and an older 400 cap silently
// TRUNCATED it so any peer past position 400 rendered "— sin dato" forever. Truncation is logged.

type ReturnMap = Record<string, number | null>

interface ReturnsBundle {
  returns: ReturnMap
  years: ReturnMap
}

interface CachedRow {
  ticker: string
  returns: ReturnMap | null
  years: ReturnMap | null
  fetched_at: string
}

/** One requested key, carrying everything needed to fetch it. */
type RequestedKey =
  | { kind: 'period'; key: string; period: Period }
  | { kind: 'year'; key: string; year: number }

/**
 * Parses `periods` / `calendarYears` out of the body.
 *
 * An unknown period or a junk year is a 400, never a silent fallback: a caller asking for `3Y` and
 * getting `1Y` back labelled `3Y` is the exact class of bug PR2 removed from `/api/market/history`.
 */
function parseRequestedKeys(
  body: { periods?: unknown; calendarYears?: unknown }
): { keys: RequestedKey[] } | { error: string } {
  const keys: RequestedKey[] = []
  const seen = new Set<string>()

  const rawPeriods = body.periods
  if (rawPeriods !== undefined && rawPeriods !== null) {
    if (!Array.isArray(rawPeriods)) return { error: 'periods must be an array' }
    for (const entry of rawPeriods) {
      const period = parsePeriod(entry)
      if (!period) return { error: 'Invalid period' }
      const key = perfKey(period)
      if (seen.has(key)) continue
      seen.add(key)
      keys.push({ kind: 'period', key, period })
    }
  }

  const rawYears = body.calendarYears
  if (rawYears !== undefined && rawYears !== null) {
    if (!Array.isArray(rawYears)) return { error: 'calendarYears must be an array' }
    for (const entry of rawYears) {
      const year = parseCalendarYear(entry)
      if (year === null) return { error: 'Invalid calendar year' }
      const key = cyKey(year)
      if (seen.has(key)) continue
      seen.add(key)
      keys.push({ kind: 'year', key, year })
    }
  }

  if (keys.length > MAX_RETURN_KEYS) return { error: 'Too many periods requested' }
  return { keys }
}

/**
 * A healthy full series always produces the 1Y anchor; a null 1Y means the cached bundle was
 * written from a degraded fetch (legacy poisoned row). Treat those as stale so they self-heal
 * instead of serving "— sin dato" for up to 6h.
 *
 * ⚠️ This anchor is deliberately NOT tightened into "every requested period is non-null", which
 * was the obvious reading of the review note. Two reasons:
 *   1. A young fund legitimately has `6M: null` FOREVER. Demanding non-null would refetch it on
 *      every single request — a permanent amplifier, the opposite of what this endpoint is for.
 *   2. The derived bundle is written atomically by one code path, so its key set is a function of
 *      the code version, not of the data. `1Y == null` is precisely the failure it can exhibit.
 * The variable-period path does NOT use this heuristic at all: it checks each requested key's own
 * presence and its own timestamp (`isKeyFresh`), which is the check the note was really asking for.
 */
const isHealthy = (r: ReturnMap | null | undefined): boolean => !!r && r['1Y'] != null

/** Copies only the keys asked for, so `ts:` bookkeeping and the other consumer never leak out. */
function project(source: ReturnMap | null | undefined, keys: readonly string[]): ReturnMap {
  const out: ReturnMap = {}
  if (!source) return out
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key] ?? null
  }
  return out
}

function ttlFor(rk: RequestedKey, currentYear: number): number {
  if (rk.kind === 'year' && rk.year < currentYear) return CLOSED_YEAR_TTL_MS
  return PERIOD_TTL_MS
}

function timestampOf(source: ReturnMap | null | undefined, key: string): number | null {
  const raw = source?.[`${TS_PREFIX}${key}`]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

export async function POST(request: NextRequest) {
  const cid = newCorrelationId()
  const elapsed = startTimer()

  // AUTH FIRST — before the body is even read, so an anonymous POST never reaches Yahoo and never
  // touches `returns_cache`. This endpoint accepts the full Beating-Peers union (~475 tickers);
  // unauthenticated it was the cheapest way to make us hammer Yahoo on someone else's behalf.
  const auth = await requireUser(request, { endpoint: 'returns', cid })
  if (!auth.ok) return auth.response

  let body: { tickers?: unknown; periods?: unknown; calendarYears?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ⚠️ `uppercase: false` is LOAD-BEARING, do not "fix" it. The response is keyed by the exact
  // string the client sent and PostgREST's `.in('ticker', …)` is case-sensitive; upper-casing here
  // would make the response keys stop matching what the client looks up → blank returns app-wide.
  const { tickers, truncated, rejected } = parseTickerList(body.tickers, {
    max: MAX_TICKERS,
    uppercase: false,
  })
  if (truncated) {
    obsWarn({ event: OBS.BUDGET_EXHAUSTED, cid, endpoint: 'returns', count: MAX_TICKERS, reason: 'ticker_union_truncated' })
  }
  if (rejected > 0) {
    obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'returns', count: rejected, reason: 'malformed_tickers' })
  }

  const parsedKeys = parseRequestedKeys(body)
  if ('error' in parsedKeys) {
    obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'returns', reason: parsedKeys.error })
    return NextResponse.json({ error: parsedKeys.error }, { status: 400 })
  }

  if (tickers.length === 0) {
    return NextResponse.json({})
  }

  const { client: supabaseAdmin, canWrite } = createCacheClient('returns')
  const now = Date.now()

  // 1. Read cache (one round trip, shared by both modes)
  const { data: cached, error: cacheReadErr } = await supabaseAdmin
    .from('returns_cache')
    .select('ticker, returns, years, fetched_at')
    .in('ticker', tickers)
  if (cacheReadErr) {
    obsError({ event: OBS.UNHANDLED_ERROR, cid, endpoint: 'returns', reason: `returns_cache read: ${cacheReadErr.message}` })
  }

  const cacheByTicker = new Map<string, CachedRow>()
  for (const row of (cached ?? []) as CachedRow[]) {
    cacheByTicker.set(row.ticker, row)
  }

  const requested = parsedKeys.keys
  const result = requested.length > 0
    ? await servePerPeriod({ tickers, requested, cacheByTicker, supabaseAdmin, canWrite, cid, now })
    : await serveDerived({ tickers, cacheByTicker, supabaseAdmin, canWrite, cid, now })

  obsInfo({
    event: OBS.MARKET_API_REQUEST,
    cid,
    endpoint: 'returns',
    status: 200,
    latency_ms: elapsed(),
    mode: requested.length > 0 ? 'periods' : 'derived',
    count: tickers.length,
    keys: requested.length,
    cache_hit: result.cacheHit,
    cache_miss: result.cacheMiss,
  })

  return NextResponse.json(result.out)
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode A — the DERIVED bundle (Beating Peers). Behaviour is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

interface ModeArgs {
  tickers: string[]
  cacheByTicker: Map<string, CachedRow>
  // The service-role client; typed loosely because only two calls are made on it.
  supabaseAdmin: ReturnType<typeof createCacheClient>['client']
  canWrite: boolean
  cid: string
  now: number
}

interface ModeResult {
  out: Record<string, ReturnsBundle>
  cacheHit: number
  cacheMiss: number
}

async function serveDerived(args: ModeArgs): Promise<ModeResult> {
  const { tickers, cacheByTicker, supabaseAdmin, canWrite, cid, now } = args
  const out: Record<string, ReturnsBundle> = {}
  const staleOrMissing: string[] = []

  for (const ticker of tickers) {
    const row = cacheByTicker.get(ticker)
    if (row && isHealthy(row.returns) && now - new Date(row.fetched_at).getTime() < DERIVED_TTL_MS) {
      out[ticker] = {
        returns: project(row.returns, DERIVED_PERIODS),
        years: project(row.years, DERIVED_PERIODS),
      }
    } else {
      staleOrMissing.push(ticker)
    }
  }

  // Dedicated counter events only when something missed; the summary line always has both.
  if (staleOrMissing.length > 0) {
    obsInfo({ event: OBS.CACHE_HIT, cid, endpoint: 'returns', count: tickers.length - staleOrMissing.length })
    obsInfo({ event: OBS.CACHE_MISS, cid, endpoint: 'returns', count: staleOrMissing.length })
  }

  if (staleOrMissing.length > 0) {
    const fetched = await mapWithConcurrency(staleOrMissing, FETCH_CONCURRENCY, async (ticker) => {
      const data = await calculateMultiReturns(ticker, { cid })
      return { ticker, data }
    })

    // Stale-fallback: a fresh fetch that comes back unhealthy (transient Yahoo failure) must NOT
    // blank a ticker that was previously good. If a healthy cached row exists (even past its TTL),
    // serve that last-good value instead of nulls. Only a ticker with NO prior good data shows the
    // degraded result. This is what makes the peer section as resilient as the watchlist: once a
    // ticker has been fetched successfully, a later hiccup degrades to last-good, never to "sin dato".
    for (const { ticker, data } of fetched) {
      if (isHealthy(data.returns)) {
        out[ticker] = toBundle(data)
      } else {
        const stale = cacheByTicker.get(ticker)
        out[ticker] = stale && isHealthy(stale.returns)
          ? { returns: project(stale.returns, DERIVED_PERIODS), years: project(stale.years, DERIVED_PERIODS) }
          : toBundle(data)
      }
    }

    // Only cache healthy bundles (1Y anchor present). A degraded/all-null result (total Yahoo
    // outage) is still returned to the client but NOT cached, so the next request retries instead
    // of pinning stale nulls for 6h.
    //
    // MERGE, never replace: the same row may hold `perf:`/`cy:`/`ts:` keys owned by the watchlist
    // path. Writing `data.returns` flat would wipe them on every peer refresh.
    const upsertRows = fetched
      .filter(({ data }) => isHealthy(data.returns))
      .map(({ ticker, data }) => {
        const existing = cacheByTicker.get(ticker)
        return {
          ticker,
          returns: { ...(existing?.returns ?? {}), ...data.returns },
          years: { ...(existing?.years ?? {}), ...data.years },
          fetched_at: new Date(now).toISOString(),
        }
      })

    await writeCache(supabaseAdmin, canWrite, upsertRows, cid)
  }

  return { out, cacheHit: tickers.length - staleOrMissing.length, cacheMiss: staleOrMissing.length }
}

/** `MultiReturns` → the wire bundle. Widens the period-keyed records to plain string maps. */
function toBundle(data: MultiReturns): ReturnsBundle {
  return { returns: { ...data.returns }, years: { ...data.years } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode B — PER-PERIOD values (watchlist + Top/Bottom performers).
// ─────────────────────────────────────────────────────────────────────────────

interface WorkItem {
  ticker: string
  rk: RequestedKey
  /** Last known fetch timestamp for this key, or null when never fetched. */
  ts: number | null
}

async function servePerPeriod(args: ModeArgs & { requested: RequestedKey[] }): Promise<ModeResult> {
  const { tickers, requested, cacheByTicker, supabaseAdmin, canWrite, cid, now } = args
  const currentYear = new Date(now).getUTCFullYear()

  const out: Record<string, ReturnsBundle> = {}
  const work: WorkItem[] = []
  let cacheHit = 0

  for (const ticker of tickers) {
    const row = cacheByTicker.get(ticker)
    const bundle: ReturnsBundle = { returns: {}, years: {} }
    out[ticker] = bundle

    for (const rk of requested) {
      const ts = timestampOf(row?.returns, rk.key)
      const present = Object.prototype.hasOwnProperty.call(row?.returns ?? {}, rk.key)
      // A key present WITH a fresh timestamp is authoritative even when its value is null: that is
      // a known "Yahoo has nothing here", and re-asking every request is the amplifier we are
      // removing. Absent key, or absent/expired timestamp → work.
      if (present && ts != null && now - ts < ttlFor(rk, currentYear)) {
        bundle.returns[rk.key] = row?.returns?.[rk.key] ?? null
        if (Object.prototype.hasOwnProperty.call(row?.years ?? {}, rk.key)) {
          bundle.years[rk.key] = row?.years?.[rk.key] ?? null
        }
        cacheHit++
      } else {
        work.push({ ticker, rk, ts })
      }
    }
  }

  if (work.length === 0) {
    return { out, cacheHit, cacheMiss: 0 }
  }

  obsInfo({ event: OBS.CACHE_HIT, cid, endpoint: 'returns', count: cacheHit })
  obsInfo({ event: OBS.CACHE_MISS, cid, endpoint: 'returns', count: work.length })

  // Never-fetched keys first, then the staleest. Deterministic tie-break so two identical requests
  // pick the same batch (and so the warm-up is monotonic rather than random).
  work.sort((a, b) => {
    if (a.ts === b.ts) return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : a.rk.key < b.rk.key ? -1 : 1
    if (a.ts == null) return -1
    if (b.ts == null) return 1
    return a.ts - b.ts
  })

  const batch = work.slice(0, PERIOD_ITEM_BUDGET)
  const deferred = work.slice(PERIOD_ITEM_BUDGET)
  if (deferred.length > 0) {
    obsWarn({
      event: OBS.BUDGET_EXHAUSTED, cid, endpoint: 'returns',
      count: deferred.length, reason: 'period_items_deferred_to_next_request',
    })
  }

  const deadline = now + PERIOD_DEADLINE_MS

  const fetched = await mapWithConcurrency(batch, FETCH_CONCURRENCY, async (item) => {
    if (Date.now() >= deadline) {
      return { item, status: 'provider_error' as SeriesStatus, value: null, years: null, skipped: true }
    }
    try {
      if (item.rk.kind === 'period') {
        const r = await calculateReturnDetailed(item.ticker, item.rk.period, { cid, deadlineMs: deadline })
        return { item, status: r.status, value: r.value, years: r.years, skipped: false }
      }
      const r = await fetchCalendarYearReturnDetailed(item.ticker, item.rk.year, { cid })
      return { item, status: r.status, value: r.value, years: null, skipped: false }
    } catch (err) {
      obsWarn({
        event: OBS.UNHANDLED_ERROR, cid, endpoint: 'returns', ticker: item.ticker,
        reason: errMessage(err),
      })
      return { item, status: 'provider_error' as SeriesStatus, value: null, years: null, skipped: true }
    }
  })

  /** Per-ticker keys to persist. Only authoritative results land here. */
  const persist = new Map<string, { returns: ReturnMap; years: ReturnMap }>()
  const stage = (ticker: string) => {
    let entry = persist.get(ticker)
    if (!entry) { entry = { returns: {}, years: {} }; persist.set(ticker, entry) }
    return entry
  }

  let staleServed = 0
  let providerErrors = 0

  for (const res of fetched) {
    const { item } = res
    const row = cacheByTicker.get(item.ticker)
    const cachedValue = row?.returns?.[item.rk.key]
    const cachedYears = row?.years?.[item.rk.key]
    const bundle = out[item.ticker]

    // A provider failure (or an item the budget/deadline never reached) must not blank a figure
    // that was previously good, and must NOT be written: no timestamp bump, so the next request
    // retries. Same policy the derived bundle has always applied.
    if (res.status === 'provider_error') {
      providerErrors++
      bundle.returns[item.rk.key] = cachedValue ?? null
      if (cachedYears !== undefined) bundle.years[item.rk.key] = cachedYears
      if (cachedValue != null) staleServed++
      continue
    }

    // `ok` is authoritative. `no_data` is authoritative ONLY when there is nothing better: an
    // HTTP-200-with-empty-result is a documented Yahoo degradation, so it may not overwrite a
    // known-good figure — but its timestamp IS refreshed, which is what stops the amplifier.
    const authoritative = res.status === 'ok' || cachedValue == null
    const value = authoritative ? res.value : (cachedValue ?? null)
    const years = authoritative ? res.years : (cachedYears ?? null)

    bundle.returns[item.rk.key] = value
    if (years != null) bundle.years[item.rk.key] = years

    const entry = stage(item.ticker)
    entry.returns[item.rk.key] = value
    entry.returns[`${TS_PREFIX}${item.rk.key}`] = now
    if (years != null) entry.years[item.rk.key] = years
  }

  // Deferred items were never attempted: last-good or nothing.
  for (const item of deferred) {
    const row = cacheByTicker.get(item.ticker)
    const cachedValue = row?.returns?.[item.rk.key]
    const cachedYears = row?.years?.[item.rk.key]
    out[item.ticker].returns[item.rk.key] = cachedValue ?? null
    if (cachedYears !== undefined) out[item.ticker].years[item.rk.key] = cachedYears
    if (cachedValue != null) staleServed++
  }

  if (staleServed > 0 || providerErrors > 0) {
    obsWarn({
      event: OBS.YAHOO_5XX, cid, endpoint: 'returns', provider: 'yahoo',
      count: providerErrors, recovered_from_cache: staleServed, reason: 'period_items_degraded',
    })
  }

  // MERGE with the existing row and DO NOT ADVANCE `fetched_at`.
  //
  // `fetched_at` is the derived bundle's TTL clock. Bumping it here would make a 5-hour-old peer
  // bundle look fresh for another 6 h just because the watchlist refreshed a `perf:` key in the
  // same row — a silent staleness bug across consumers. A brand-new row gets epoch 0, which is
  // correctly "the derived bundle in this row is stale", because there isn't one.
  const upsertRows = [...persist.entries()].map(([ticker, entry]) => {
    const existing = cacheByTicker.get(ticker)
    return {
      ticker,
      returns: { ...(existing?.returns ?? {}), ...entry.returns },
      years: { ...(existing?.years ?? {}), ...entry.years },
      fetched_at: existing?.fetched_at ?? new Date(0).toISOString(),
    }
  })

  await writeCache(supabaseAdmin, canWrite, upsertRows, cid)

  return { out, cacheHit, cacheMiss: work.length }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort cache write; failure must not break the response — but it MUST be visible.
 * The old `try/catch` here caught nothing: supabase-js RESOLVES with `{ error }`, it does not
 * throw, so every RLS rejection and every PGRST error was swallowed in complete silence.
 */
async function writeCache(
  supabaseAdmin: ReturnType<typeof createCacheClient>['client'],
  canWrite: boolean,
  rows: object[],
  cid: string
): Promise<void> {
  if (rows.length === 0) return
  if (!canWrite) {
    obsWarn({ event: OBS.CACHE_WRITE_SKIPPED, cid, endpoint: 'returns', count: rows.length, reason: 'no_service_role' })
    return
  }
  const { error } = await supabaseAdmin.from('returns_cache').upsert(rows, { onConflict: 'ticker' })
  if (error) {
    obsError({ event: OBS.CACHE_WRITE_ERROR, cid, endpoint: 'returns', count: rows.length, reason: error.message })
  }
}
