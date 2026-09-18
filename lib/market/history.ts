import type { HistoricalDataPoint } from '@/types'
import YahooFinanceLib from 'yahoo-finance2'
import { OBS, errMessage, obsWarn } from '@/lib/utils/obs'

const yf = new YahooFinanceLib({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false, allowAdditionalProps: true },
})

export type PeriodKey = '1W' | '1M' | '6M' | '1Y' | '3Y' | '5Y' | 'YTD' | '10Y' | 'MAX'

const YAHOO_RANGE_MAP: Record<PeriodKey, string> = {
  '1W': '5d',
  '1M': '1mo',
  '6M': '6mo',
  '1Y': '1y',
  '3Y': '3y',
  '5Y': '5y',
  YTD: 'ytd',
  '10Y': '10y',
  MAX: 'max',
}

const YAHOO_INTERVAL_MAP: Record<PeriodKey, string> = {
  '1W': '1d',
  '1M': '1d',
  '6M': '1d',
  '1Y': '1d',
  '3Y': '1d',
  '5Y': '1d',
  YTD: '1d',
  '10Y': '1d',
  MAX: '3mo',
}

/**
 * ── Explicit result state (REL-08) ──────────────────────────────────────────
 *
 * Every failure path in this module used to return `[]`, so "Yahoo has no bars for this symbol"
 * and "Yahoo 503'd / timed out" were the same value. Callers therefore could not tell a genuine
 * empty result (safe to cache as a known null, so we stop asking) from a provider failure (must
 * NOT be cached, must fall back to last-good). That single ambiguity is what made a transient
 * hiccup turn into a permanent "— sin dato".
 *
 * The state is INTERNAL: no route exposes it to the UI. It exists so the caching layer can make
 * that decision, and so the logs say which of the two happened.
 *
 *   ok             → at least one usable bar came back
 *   no_data        → a structurally valid response with nothing usable in it (or an unknown period)
 *   provider_error → HTTP error, timeout, abort, unparseable body, or the deadline hit first
 *   stale          → never produced here; the value was substituted from cache by a caller
 */
export type SeriesStatus = 'ok' | 'no_data' | 'provider_error' | 'stale'

export type SeriesProvider = 'yahoo' | 'yahoo-finance2' | 'cache' | 'none'

export interface SeriesResult {
  data: HistoricalDataPoint[]
  status: SeriesStatus
  provider: SeriesProvider
  /** Attempts actually spent — lets callers run a shared network budget. */
  attempts: number
}

/**
 * Structured-log event for the explicit state. Not in `OBS` because `lib/utils/obs.ts` belongs to
 * another change set; `ObsFields.event` accepts a plain string for exactly this case.
 */
const OBS_SERIES_STATUS = 'series_status'

/**
 * Availability control: no Yahoo request may hang a serverless invocation forever.
 * Before this there was NO timeout at all — a stalled socket burned the whole function budget
 * (and on Netlify the ~10 s synchronous ceiling isn't extended by `maxDuration`).
 * `AbortSignal.timeout` is used because its internal timer is `unref`'d, so it never keeps the
 * process alive on its own.
 */
const REQUEST_TIMEOUT_MS = 8_000

/** Default retry attempts for one range fetch (transient 429/5xx/empty-body only). */
const MAX_ATTEMPTS = 3

export interface FetchHistoryOptions {
  /** Hard cap on attempts for THIS call. Defaults to `MAX_ATTEMPTS`. */
  maxAttempts?: number
  /** Absolute epoch-ms deadline: no NEW attempt starts after it. */
  deadlineMs?: number
  /** Caller-supplied cancellation (composed with the per-request timeout). */
  signal?: AbortSignal
  /** Correlation id, echoed into structured logs. */
  cid?: string
}

/** Per-request timeout, composed with any caller signal. */
function requestSignal(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  if (!external) return timeout
  // `AbortSignal.any` needs Node >= 20 (Next 16 requires 20.9+); fall back to the timeout alone.
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, external]) : timeout
}

interface YahooChartResult {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        adjclose?: Array<{ adjclose?: (number | null)[] }>
        quote?: Array<{
          close?: (number | null)[]
          open?: (number | null)[]
          high?: (number | null)[]
          low?: (number | null)[]
          volume?: (number | null)[]
        }>
      }
    }>
    error?: unknown
  }
}

/**
 * Parses one Yahoo v8 chart response into points; returns [] on any structural gap.
 *
 * Every access is optional-chained on purpose: Yahoo intermittently returns a `result[0]` with no
 * `indicators.quote` (or a non-array `timestamp`). The previous `indicators.quote[0]` and
 * `timestamp.map(...)` THREW on those shapes, turning a degraded response into an exception that
 * propagated out of the retry loop. The contract is "[] on a structural gap", never a throw.
 * Values themselves are untouched, so parsed series are byte-for-byte what they were.
 */
function parseChart(data: YahooChartResult): HistoricalDataPoint[] {
  const result = data?.chart?.result?.[0]
  if (!result) return []

  const timestamp = result.timestamp
  if (!Array.isArray(timestamp) || timestamp.length === 0) return []

  const quotes = result.indicators?.quote?.[0]
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose

  const points: HistoricalDataPoint[] = []
  for (let i = 0; i < timestamp.length; i++) {
    const ts = timestamp[i]
    // A non-finite timestamp would make `new Date(...).toISOString()` throw (RangeError).
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue

    const close = adjClose?.[i] ?? quotes?.close?.[i] ?? 0
    if (!(close > 0)) continue

    points.push({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close,
      open: quotes?.open?.[i] ?? undefined,
      high: quotes?.high?.[i] ?? undefined,
      low: quotes?.low?.[i] ?? undefined,
      volume: quotes?.volume?.[i] ?? undefined,
    })
  }
  return points
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches one Yahoo range and reports WHAT happened, not just what came back.
 *
 * Retry policy is UNCHANGED (429/5xx/empty body, 3 attempts, 250 ms × attempt backoff) and the
 * parsed values are untouched; the only additions over the original are the per-request timeout,
 * an optional deadline, an optional attempt cap and the explicit `status`.
 */
export async function fetchHistorySeries(
  ticker: string,
  period: PeriodKey,
  options: FetchHistoryOptions = {}
): Promise<SeriesResult> {
  const range = YAHOO_RANGE_MAP[period]
  const interval = YAHOO_INTERVAL_MAP[period]
  // An unknown period is not a provider failure: we never asked anyone.
  if (!range || !interval) return { data: [], status: 'no_data', provider: 'none', attempts: 0 }

  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS))
  const { deadlineMs, cid } = options

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`

  /** One place to attach the summary log, so no early return can skip it. */
  const done = (status: SeriesStatus, data: HistoricalDataPoint[], attempts: number): SeriesResult => {
    if (status !== 'ok') {
      obsWarn({ event: OBS_SERIES_STATUS, cid, ticker, period, provider: 'yahoo', status, attempts })
    }
    return { data, status, provider: 'yahoo', attempts }
  }

  // Resilience: Yahoo intermittently returns 429/5xx or an empty body under concurrent load
  // (the Beating-Peers batch fires dozens of tickers at once). A single failed attempt used to
  // become a permanent "— sin dato" because failures aren't cached. Retry transient failures with
  // a short backoff so the peer path is as reliable as the watchlist's per-period fetches.
  // Successful responses (the common case) hit `next.revalidate` and never retry → zero overhead.
  let attempts = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (deadlineMs != null && Date.now() >= deadlineMs) {
      obsWarn({ event: OBS.BUDGET_EXHAUSTED, cid, ticker, period, provider: 'yahoo', reason: 'deadline' })
      break
    }
    attempts++
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: requestSignal(options.signal),
        next: { revalidate: 3600 },
      })

      if (!res.ok) {
        if (res.status === 429) obsWarn({ event: OBS.YAHOO_429, cid, ticker, period, provider: 'yahoo', status: res.status })
        else if (res.status >= 500) obsWarn({ event: OBS.YAHOO_5XX, cid, ticker, period, provider: 'yahoo', status: res.status })
        // 4xx other than rate-limit won't fix itself; only retry 429/5xx.
        if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
          await sleep(250 * attempt)
          continue
        }
        return done('provider_error', [], attempts)
      }

      const data = (await res.json()) as YahooChartResult
      const points = parseChart(data)
      if (points.length === 0) {
        obsWarn({ event: OBS.PARSE_ERROR, cid, ticker, period, provider: 'yahoo', reason: 'empty_series' })
        if (attempt < maxAttempts) {
          await sleep(250 * attempt)
          continue
        }
        // Structurally valid response, nothing usable in it: a genuine empty, not a failure.
        return done('no_data', [], attempts)
      }
      return done('ok', points, attempts)
    } catch (err) {
      const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
      obsWarn({
        event: aborted ? OBS.TIMEOUT : OBS.PARSE_ERROR,
        cid, ticker, period, provider: 'yahoo', reason: errMessage(err),
      })
      if (attempt < maxAttempts) {
        await sleep(250 * attempt)
        continue
      }
      return done('provider_error', [], attempts)
    }
  }
  // Only reachable via the deadline break: we never got an answer at all.
  return done('provider_error', [], attempts)
}

/**
 * Back-compatible view of `fetchHistorySeries`: just the bars.
 *
 * Kept with the EXACT original signature so the chart route, the inception-date backfill in
 * `/api/market/quote` and the golden tests are untouched by the introduction of the explicit
 * state. Callers that need to distinguish "no data" from "provider failed" call
 * `fetchHistorySeries` directly.
 */
export async function fetchHistoricalData(
  ticker: string,
  period: PeriodKey,
  options: FetchHistoryOptions = {}
): Promise<HistoricalDataPoint[]> {
  const { data } = await fetchHistorySeries(ticker, period, options)
  return data
}

async function fetchCalendarYearReturnFromPrice(
  ticker: string,
  year: number,
  options: FetchHistoryOptions = {}
): Promise<CalendarYearReturn> {
  const period1 = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000)
  const period2 = Math.floor(new Date(`${year + 1}-01-01T00:00:00Z`).getTime() / 1000) - 1

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: requestSignal(options.signal),
      next: { revalidate: 3600 },
    })
    // An HTTP error is the provider failing, NOT the year being empty. The distinction decides
    // whether the caller may cache this null.
    if (!res.ok) return { value: null, status: 'provider_error', provider: 'yahoo' }

    const data = (await res.json()) as YahooChartResult
    const result = data?.chart?.result?.[0]
    if (!result) return { value: null, status: 'no_data', provider: 'yahoo' }

    // Optional-chained throughout: a degraded response with no `indicators.quote` used to throw.
    const adjClose = result.indicators?.adjclose?.[0]?.adjclose
    const closes = adjClose ?? result.indicators?.quote?.[0]?.close

    if (!closes || closes.length < 2) return { value: null, status: 'no_data', provider: 'yahoo' }

    const valid = closes.filter((c): c is number => c != null && c > 0)
    if (valid.length < 2) return { value: null, status: 'no_data', provider: 'yahoo' }

    const first = valid[0]
    const last = valid[valid.length - 1]
    return { value: ((last - first) / first) * 100, status: 'ok', provider: 'yahoo' }
  } catch (err) {
    obsWarn({
      event: OBS_SERIES_STATUS, cid: options.cid, ticker, provider: 'yahoo',
      status: 'provider_error', year, reason: errMessage(err),
    })
    return { value: null, status: 'provider_error', provider: 'yahoo' }
  }
}

/**
 * Defence in depth against an out-of-range `year` reaching Yahoo (e.g. `999999999`, which produced
 * a request spanning ~1e9 years). Mirrors `parseCalendarYear` in ./validation without importing it,
 * so this module keeps zero runtime edges to the validation layer.
 */
function isSaneCalendarYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= new Date().getUTCFullYear() + 1
}

export interface CalendarYearReturn {
  value: number | null
  status: SeriesStatus
  provider: SeriesProvider
}

/** Calendar-year return WITH the explicit state. Same two-stage lookup as before. */
export async function fetchCalendarYearReturnDetailed(
  ticker: string,
  year: number,
  options: FetchHistoryOptions = {}
): Promise<CalendarYearReturn> {
  if (!isSaneCalendarYear(year)) {
    obsWarn({ event: OBS.PARSE_ERROR, ticker, provider: 'yahoo', reason: 'year_out_of_range', year })
    // We never asked anyone, so this is not a provider failure.
    return { value: null, status: 'no_data', provider: 'none' }
  }

  // For ETFs/funds: use Morningstar NAV-based total returns (matches Yahoo Finance fund pages exactly)
  try {
    const summary = await yf.quoteSummary(ticker, { modules: ['fundPerformance'] }, { validateResult: false }) as Record<string, unknown>
    const fp = summary.fundPerformance as Record<string, unknown> | null | undefined
    const annualReturns = (fp?.annualTotalReturns as { returns?: Array<{ year: string | number; annualValue: number | null }> } | null)?.returns
    if (Array.isArray(annualReturns)) {
      const match = annualReturns.find((r) => String(r.year) === String(year))
      if (match?.annualValue != null) {
        return { value: match.annualValue * 100, status: 'ok', provider: 'yahoo-finance2' }
      }
    }
  } catch (err) {
    obsWarn({ event: OBS.PARSE_ERROR, ticker, provider: 'yahoo-finance2', year, reason: errMessage(err) })
  }

  // For stocks: calculate from adjusted close price history
  return fetchCalendarYearReturnFromPrice(ticker, year, options)
}

/**
 * Back-compatible view: just the value. Keeps `/api/market/history?mode=calYear` and the golden
 * tests on their original signature.
 */
export async function fetchCalendarYearReturn(
  ticker: string,
  year: number
): Promise<{ value: number | null }> {
  const { value } = await fetchCalendarYearReturnDetailed(ticker, year)
  return { value }
}

export interface PeriodReturn {
  value: number | null
  years: number | null
  /** Why `value` is null, when it is. See `SeriesStatus`. */
  status: SeriesStatus
  provider: SeriesProvider
  attempts: number
}

/**
 * ONE implementation of "the return of `period` for `ticker`", with the explicit state attached.
 *
 * `calculateReturn` (used by `/api/market/history?mode=return`) and the per-period branch of
 * `/api/market/returns` both go through this function, so the watchlist figure cannot drift from
 * the bulk figure: it is literally the same arithmetic over the same URL.
 */
export async function calculateReturnDetailed(
  ticker: string,
  period: PeriodKey,
  options: FetchHistoryOptions = {}
): Promise<PeriodReturn> {
  const series = await fetchHistorySeries(ticker, period, options)
  const history = series.data
  const meta = { provider: series.provider, attempts: series.attempts }

  // A provider failure stays a provider failure; anything else with too few bars is a real empty.
  if (history.length < 2) {
    return {
      value: null,
      years: null,
      status: series.status === 'ok' ? 'no_data' : series.status,
      ...meta,
    }
  }

  // Use adjclose for both endpoints so splits and dividends are factored in
  // consistently (total return methodology). Mixing adjclose base with a live
  // unadjusted price inflates returns for dividend-paying stocks.
  const baseClose = history[0].close
  const endClose = history[history.length - 1].close

  if (!baseClose || baseClose === 0) return { value: null, years: null, status: 'no_data', ...meta }

  const value = ((endClose - baseClose) / baseClose) * 100
  const startMs = new Date(history[0].date).getTime()
  const endMs = new Date(history[history.length - 1].date).getTime()
  const years = (endMs - startMs) / (365.25 * 24 * 60 * 60 * 1000)

  return { value, years, status: 'ok', ...meta }
}

async function calculateReturnWithMeta(
  ticker: string,
  period: PeriodKey,
  options: FetchHistoryOptions
): Promise<{ value: number | null; years: number | null; attempts: number }> {
  const { value, years, attempts } = await calculateReturnDetailed(ticker, period, options)
  return { value, years, attempts }
}

export async function calculateReturn(
  ticker: string,
  period: PeriodKey,
  _currentPrice: number,
  options: FetchHistoryOptions = {}
): Promise<{ value: number | null; years: number | null }> {
  const { value, years } = await calculateReturnWithMeta(ticker, period, options)
  return { value, years }
}

// Periods computed from a single ~1Y daily series (1D comes from live quotes).
export const MULTI_RETURN_PERIODS = ['1W', '1M', '6M', 'YTD', '1Y'] as const
export type MultiReturnPeriod = typeof MULTI_RETURN_PERIODS[number]

export interface MultiReturns {
  returns: Record<MultiReturnPeriod, number | null>
  years: Record<MultiReturnPeriod, number | null>
}

// Return value (%) and years between the close nearest `targetMs` and the last close.
function returnFrom(
  history: HistoricalDataPoint[],
  parsed: number[],
  endClose: number,
  endMs: number,
  targetMs: number
): { value: number | null; years: number | null } {
  // Find the earliest point on/after the target date; fall back to the first point
  // only when the series itself starts after the target (period not fully covered).
  let idx = -1
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i] >= targetMs) { idx = i; break }
  }
  if (idx === -1) return { value: null, years: null }
  // If the very first datapoint is already after the target, the window isn't
  // fully covered (e.g. a fund younger than the period) → not enough history.
  if (idx === 0 && parsed[0] > targetMs) {
    // Only treat as covered when the gap is small (≤7 days of missing leading data).
    if (parsed[0] - targetMs > 7 * 24 * 60 * 60 * 1000) return { value: null, years: null }
  }
  const baseClose = history[idx].close
  if (!baseClose || baseClose === 0) return { value: null, years: null }
  const value = ((endClose - baseClose) / baseClose) * 100
  const years = (endMs - parsed[idx]) / (365.25 * 24 * 60 * 60 * 1000)
  return { value, years }
}

/**
 * Computes 1W / 1M / 6M / YTD / 1Y total returns from a single 1Y daily series.
 * One Yahoo request per ticker instead of five. Null-safe: any period without
 * enough history resolves to null and never throws.
 */
/**
 * Per-call network budget. Worst case used to be 18 fetches for ONE ticker (3 attempts on the 1Y
 * series + 3 attempts on each of 5 fallback periods). Multiplied by a ~475-ticker union that is a
 * self-inflicted flood that guarantees Yahoo rate-limits us and the function times out.
 *
 * The budget caps TOTAL attempts at 12 while guaranteeing every missing period still gets at least
 * ONE attempt, so no period silently loses data it would previously have found: only pathological
 * runs (where everything is already failing) are trimmed.
 */
const MULTI_RETURN_ATTEMPT_BUDGET = 12

/** No NEW attempt starts after this; bounds worst-case wall time per ticker. */
const MULTI_RETURN_DEADLINE_MS = 30_000

export async function calculateMultiReturns(
  ticker: string,
  options: { cid?: string; signal?: AbortSignal } = {}
): Promise<MultiReturns> {
  const deadlineMs = Date.now() + MULTI_RETURN_DEADLINE_MS
  const base: FetchHistoryOptions = { cid: options.cid, signal: options.signal, deadlineMs }
  let budget = MULTI_RETURN_ATTEMPT_BUDGET

  // Start all periods null; the fast path fills them from one 1Y series, and the per-period
  // fallback below backfills whatever's still null. Initializing up front (instead of an early
  // `return EMPTY_MULTI`) is what makes the fallback reachable even when the 1Y fetch is empty.
  const returns: Record<MultiReturnPeriod, number | null> = { '1W': null, '1M': null, '6M': null, YTD: null, '1Y': null }
  const years: Record<MultiReturnPeriod, number | null> = { '1W': null, '1M': null, '6M': null, YTD: null, '1Y': null }

  let history: HistoricalDataPoint[] = []
  try {
    const res = await fetchHistorySeries(ticker, '1Y', base)
    history = res.data
    budget -= res.attempts
  } catch {
    history = []
    budget -= MAX_ATTEMPTS
  }

  // Fast path: when the 1Y series is usable, derive all 5 periods from it (one Yahoo request).
  if (history.length >= 2) {
    const parsed = history.map((h) => new Date(h.date).getTime())
    const endClose = history[history.length - 1].close
    const endMs = parsed[parsed.length - 1]

    if (endClose && endClose !== 0) {
      const DAY = 24 * 60 * 60 * 1000
      const endDate = new Date(endMs)
      const ytdMs = Date.UTC(endDate.getUTCFullYear(), 0, 1)

      const targets: Record<MultiReturnPeriod, number> = {
        '1W': endMs - 7 * DAY,
        '1M': endMs - 30 * DAY,
        '6M': endMs - 182 * DAY,
        YTD: ytdMs,
        '1Y': parsed[0], // first point of the 1Y window
      }

      for (const p of MULTI_RETURN_PERIODS) {
        const { value, years: y } = returnFrom(history, parsed, endClose, endMs, targets[p])
        returns[p] = value
        years[p] = y
      }
    }
  }

  // Self-healing fallback: deriving every period from a single 1Y series is efficient but fragile —
  // a short/degraded/empty Yahoo response (or a window `returnFrom` can't cleanly cover) yields a
  // null for a period that genuinely has data. The watchlist never hits this because it fetches a
  // dedicated range per period. So for any null period, retry it via the SAME robust per-range path
  // the watchlist uses (`calculateReturn`) — a DIFFERENT URL per period, so a degraded `range=1y`
  // response doesn't blank the whole bundle. Guarantees PeerCard parity with WatchlistTable. Fires
  // only for the null periods (zero overhead on a healthy 1Y series); each failure is swallowed so
  // the period stays null (never throws).
  const missing = MULTI_RETURN_PERIODS.filter((p) => returns[p] == null)
  if (missing.length > 0) {
    // Share whatever budget the 1Y path left over, evenly, with a floor of ONE attempt per period:
    // a healthy run (1Y succeeded first try) leaves 11 for at most a couple of periods → the full
    // 3 attempts each, exactly as before. A run where the 1Y series burned all 3 attempts leaves 9
    // for 5 periods → 1 attempt each (3 + 5 = 8 fetches instead of 18), and every period is still
    // attempted, so a transiently-null period is never left untried.
    const perPeriod = Math.max(1, Math.floor(Math.max(budget, 0) / missing.length))
    if (budget <= 0) {
      obsWarn({ event: OBS.BUDGET_EXHAUSTED, cid: options.cid, ticker, provider: 'yahoo', reason: 'multi_return_attempts' })
    }
    await Promise.all(
      missing.map(async (p) => {
        try {
          // MultiReturnPeriod strings are a subset of PeriodKey, so the cast is sound.
          const { value, years: y } = await calculateReturnWithMeta(ticker, p as PeriodKey, {
            ...base,
            maxAttempts: perPeriod,
          })
          if (value != null) {
            returns[p] = value
            years[p] = y
          }
        } catch {
          /* leave this period null — preserves the null-safe contract */
        }
      })
    )
  }

  return { returns, years }
}
