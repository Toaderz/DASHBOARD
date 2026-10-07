// Validación única de entradas de las rutas /api/market/*. Ninguna ruta debe usar un ticker,
// año o lista que no haya pasado por aquí.

const TICKER_RE = /^[A-Z0-9._^=-]{1,20}$/
const MIN_YEAR = 1970

/** Ticker normalizado (trim + mayúsculas) o null si no es válido. */
export function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toUpperCase()
  return TICKER_RE.test(t) ? t : null
}

export interface ParsedTickers {
  tickers: string[]
  /** Entradas descartadas por no ser tickers válidos. */
  invalid: number
  /** Más entradas únicas que el tope: no se trunca, la ruta debe responder 400. */
  tooMany: boolean
}

/** Acepta "A,B,C" o un array. Deduplica, normaliza y descarta lo inválido. */
export function parseTickerList(raw: unknown, max: number): ParsedTickers {
  const items: unknown[] = typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  let invalid = 0
  for (const item of items) {
    if (typeof item === 'string' && item.trim() === '') continue
    const t = normalizeTicker(item)
    if (t) seen.add(t)
    else invalid++
  }
  if (seen.size > max) return { tickers: [], invalid, tooMany: true }
  return { tickers: [...seen], invalid, tooMany: false }
}

/** Año entero entre 1970 y el año actual, o null. */
export function parseYear(raw: string | null): number | null {
  if (raw == null || !/^\d{4}$/.test(raw)) return null
  const year = Number(raw)
  return year >= MIN_YEAR && year <= new Date().getUTCFullYear() ? year : null
}
