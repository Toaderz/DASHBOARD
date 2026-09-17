/**
 * Structured, parseable observability for the market/data server paths.
 *
 * Deliberately NOT a metrics system: one `console` line per event, prefixed with a stable tag and
 * carrying a single-line JSON payload, so it can be grepped by humans AND parsed by a log drain
 * (Vercel/Netlify/GitHub Actions) without adding a dependency.
 *
 *   [evolve] {"lvl":"info","event":"cache_hit","endpoint":"quote","cid":"...","count":37}
 *
 * Rules:
 *  - NEVER pass secrets, tokens or env-var values into `fields`. Only identifiers and measurements.
 *  - `cid` (correlation id) ties every line of one request together. Mint it once per handler.
 */

/** Canonical event names. Centralised so a typo can't split a counter in two. */
export const OBS = {
  MARKET_API_REQUEST: 'market_api_request',
  CACHE_HIT: 'cache_hit',
  CACHE_MISS: 'cache_miss',
  CACHE_WRITE_SKIPPED: 'cache_write_skipped',
  CACHE_WRITE_ERROR: 'cache_write_error',
  YAHOO_429: 'yahoo_429',
  YAHOO_5XX: 'yahoo_5xx',
  TIMEOUT: 'timeout',
  PARSE_ERROR: 'parse_error',
  FUNDAMENTALS_REFRESH: 'fundamentals_refresh',
  FUNDAMENTALS_FAILURE: 'fundamentals_failure',
  SERVICE_ROLE_MISSING: 'service_role_missing',
  BUDGET_EXHAUSTED: 'budget_exhausted',
  AUTH_FAILURE: 'auth_failure',
  CONFIG_ERROR: 'config_error',
  UNHANDLED_ERROR: 'unhandled_error',
} as const

export type ObsEvent = (typeof OBS)[keyof typeof OBS]

export interface ObsFields {
  event: ObsEvent | string
  /** Correlation id — one per inbound request. */
  cid?: string
  endpoint?: string
  ticker?: string
  provider?: string
  status?: string | number
  latency_ms?: number
  count?: number
  [key: string]: unknown
}

const PREFIX = '[evolve]'

function emit(lvl: 'info' | 'warn' | 'error', fields: ObsFields): void {
  let payload: string
  try {
    payload = JSON.stringify({ lvl, ...fields })
  } catch {
    // Circular/unserialisable field — never let logging throw inside a request handler.
    payload = JSON.stringify({ lvl, event: fields.event, cid: fields.cid, serialize_error: true })
  }
  const line = `${PREFIX} ${payload}`
  if (lvl === 'error') console.error(line)
  else if (lvl === 'warn') console.warn(line)
  else console.log(line)
}

export const obsInfo = (fields: ObsFields): void => emit('info', fields)
export const obsWarn = (fields: ObsFields): void => emit('warn', fields)
export const obsError = (fields: ObsFields): void => emit('error', fields)

/** Correlation id for one request. Short enough to read, unique enough to join on. */
export function newCorrelationId(): string {
  try {
    return globalThis.crypto.randomUUID().slice(0, 8)
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

/** `const elapsed = startTimer()` … `elapsed()` → ms since start, rounded. */
export function startTimer(): () => number {
  const t0 = Date.now()
  return () => Date.now() - t0
}

/** Error → a short, safe string for logs. Never returned to clients. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300)
  return String(err).slice(0, 300)
}
