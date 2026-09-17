import { z } from 'zod'
import type { PeriodKey } from './history'

/**
 * Input validation for the market endpoints. ONE definition per concept — before this, the period
 * list was duplicated between `lib/market/history.ts` and `app/api/market/history/route.ts`, and
 * the year parser accepted `'2024junk'` and `999999999`.
 *
 * Scope: these helpers only REJECT malformed input. They never rewrite a well-formed request, so
 * the figures the app renders are unchanged.
 */

// ─── Periods ─────────────────────────────────────────────────────────────────

/** Single source of truth for the accepted period keys. */
export const VALID_PERIODS = ['1W', '1M', '6M', '1Y', '3Y', '5Y', 'YTD', '10Y', 'MAX'] as const

export type Period = (typeof VALID_PERIODS)[number]

// Compile-time guard: this list must stay in lockstep with `PeriodKey` in ./history.
// (Type-only import → erased at runtime, so there is no import cycle.)
const _periodsMatchHistory: readonly PeriodKey[] = VALID_PERIODS
void _periodsMatchHistory

const periodSchema = z.enum(VALID_PERIODS)

/** Returns the period, or `null` when the input is absent/unknown. Never throws. */
export function parsePeriod(input: unknown): Period | null {
  const parsed = periodSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

// ─── Tickers ─────────────────────────────────────────────────────────────────

/**
 * Upper bound on tickers per request — an abuse guard, NOT a functional limit.
 *
 * Beating-Peers legitimately posts the full union (assets ∪ all peers), ~475 for a real portfolio.
 * An older 400 cap silently TRUNCATED that union and any peer past position 400 rendered
 * "— sin dato" forever. Keep this well above realistic unions; truncation is always logged.
 */
export const MAX_TICKERS = 1500

/**
 * Longest ticker we accept. The real catalogue tops out around 12 chars
 * (`0P0001CZXM.L`, `DX-Y.NYB`); 32 is generous headroom with no attack surface.
 */
export const MAX_TICKER_LENGTH = 32

/**
 * Permissive on purpose. Yahoo symbols in this catalogue include indices (`^GSPC`, `^RUT`),
 * futures/FX (`CL=F`, `GBPUSD=X`, `DX-Y.NYB`), share classes (`BRK-B`) and Morningstar fund ids
 * (`0P0001CZXM.L`). Rejecting a legitimate symbol would blank prices, so this only excludes
 * whitespace, control characters, separators and anything that could travel further as a payload.
 */
const TICKER_RE = /^[A-Za-z0-9.^=_-]+$/

const tickerSchema = z
  .string()
  .transform((t) => t.trim())
  .refine((t) => t.length > 0 && t.length <= MAX_TICKER_LENGTH)
  .refine((t) => TICKER_RE.test(t))

export interface ParseTickerListOptions {
  /** Hard cap; anything past it is dropped and reported via `truncated`. */
  max?: number
  /**
   * ⚠️ DO NOT flip this to `true` for `/api/market/quote` or `/api/market/returns`.
   *
   * Both endpoints key their JSON response with the EXACT string the client sent, and PostgREST's
   * `.in('ticker', …)` is case-sensitive. Upper-casing there would make the response keys stop
   * matching the keys the client looks up — prices would render blank across the entire app.
   * Defaults to `false` (preserve caller casing) for exactly that reason.
   */
  uppercase?: boolean
}

export interface ParsedTickerList {
  /** Valid, de-duplicated, order-preserving. */
  tickers: string[]
  /** `true` when `max` was hit and entries were dropped — callers MUST log this. */
  truncated: boolean
  /** How many entries failed validation (malformed/too long/wrong type). */
  rejected: number
}

/**
 * Accepts a comma-separated query-string value OR an array (JSON body) and returns a clean list.
 * Never throws; malformed entries are counted, not fatal.
 */
export function parseTickerList(
  input: unknown,
  options: ParseTickerListOptions = {}
): ParsedTickerList {
  const max = options.max ?? MAX_TICKERS
  const uppercase = options.uppercase ?? false

  const raw: unknown[] =
    typeof input === 'string' ? input.split(',') : Array.isArray(input) ? input : []

  const seen = new Set<string>()
  const tickers: string[] = []
  let rejected = 0
  let truncated = false

  for (const entry of raw) {
    const parsed = tickerSchema.safeParse(entry)
    if (!parsed.success) {
      // An empty segment from a trailing comma is not a client error worth counting.
      if (typeof entry !== 'string' || entry.trim().length > 0) rejected++
      continue
    }
    const value = uppercase ? parsed.data.toUpperCase() : parsed.data
    if (seen.has(value)) continue
    if (tickers.length >= max) {
      truncated = true
      break
    }
    seen.add(value)
    tickers.push(value)
  }

  return { tickers, truncated, rejected }
}

// ─── Calendar years ──────────────────────────────────────────────────────────

/** Yahoo has no usable daily history before this; anything earlier is a malformed request. */
export const MIN_CALENDAR_YEAR = 1900

/** One year ahead of today, so a January request for "this year" never trips the guard. */
export function maxCalendarYear(now: Date = new Date()): number {
  return now.getUTCFullYear() + 1
}

/**
 * Strict year parsing.
 *
 * Uses `Number()` + `Number.isInteger`, never `parseInt`: `parseInt('2024junk', 10)` happily
 * returns `2024`, and an unbounded year like `999999999` produced a Yahoo request spanning
 * ~1e9 years. Both are rejected here.
 */
export function parseCalendarYear(input: unknown, now: Date = new Date()): number | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null
  if (typeof input === 'string' && input.trim().length === 0) return null

  const year = Number(input)
  if (!Number.isInteger(year)) return null
  if (year < MIN_CALENDAR_YEAR || year > maxCalendarYear(now)) return null
  return year
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Yahoo's search endpoint ignores anything longer; the cap keeps the outbound URL bounded. */
export const MAX_SEARCH_QUERY_LENGTH = 64

/** Trims and length-caps a search query. Returns `null` for absent/empty input. */
export function parseSearchQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, MAX_SEARCH_QUERY_LENGTH)
}
