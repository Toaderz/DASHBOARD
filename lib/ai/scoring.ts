// ════════════════════════════════════════════════════════════════════════════
// Re-derivación DETERMINISTA del scoring del brief (server-authoritative).
//
// PROBLEMA QUE RESUELVE
// El modelo devolvía `score`, `rating` y `signal` como tres campos INDEPENDIENTES y
// nadie los cruzaba contra los 6 sub-scores que él mismo reportaba en `score_breakdown`.
// Resultado observado: filas incoherentes tipo «rating A con score 4». Y `score` no es
// cosmético: alimenta la aritmética de orden de `dedupeByEvent` (gana el de mayor score
// por suceso), del núcleo A/B de `selectFinalArticles`, de la garantía de portafolio
// (`score >= 11`) y del `rank` final. Un score inflado reordena el brief entero.
//
// PRINCIPIO (el mismo de PR5, aplicado al scoring): la autoridad del modelo se reduce a
// los SUB-SCORES y a la PROSA. El total, el rating y la señal los calcula el servidor con
// el rubric que el propio prompt de `analyzeAndSynthesize` declara. No se inventa ninguna
// banda nueva aquí; este archivo es la transcripción ejecutable del rubric del prompt:
//
//   SCORING (0-5 cada uno): macro_impact, surprise_factor, market_relevance,
//   forward_implications, structural_vs_noise; más time_decay (0 si <=2 días, -1 si 3-4,
//   -2 si 5-7) y portfolio_relevance (SOLO informativo).
//   TOTAL = macro + surprise + market_rel + forward + structural + time_decay
//           (máx 25; portfolio_relevance NO suma al total).
//   RATING: A=19-25, B=15-18, C=11-14, D<11.
//   SIGNAL: STRONG si TOTAL>=19; MODERATE si 15-18; WEAK si <15.
//
// Se extrae a su propio archivo porque `news-pipeline.ts` ya pasa de 1400 líneas y
// CLAUDE.md pide archivos <500.
// ════════════════════════════════════════════════════════════════════════════

export const RATINGS = ['A', 'B', 'C', 'D'] as const
export const SIGNALS = ['STRONG', 'MODERATE', 'WEAK'] as const

export type Rating = (typeof RATINGS)[number]
export type Signal = (typeof SIGNALS)[number]

export interface ScoreBreakdown {
  macro: number
  surprise: number
  market_rel: number
  forward: number
  structural: number
  /** SOLO informativo: NO entra en el total (regla explícita del rubric). */
  portfolio: number
  time_decay: number
}

export const ZERO_BREAKDOWN: ScoreBreakdown = {
  macro: 0, surprise: 0, market_rel: 0, forward: 0, structural: 0, portfolio: 0, time_decay: 0,
}

/** Techo del rubric (5 dimensiones × 5, con time_decay <= 0). Coincide con el clamp de `score`. */
export const MAX_TOTAL = 25

/** Las 5 dimensiones 0–5 que suman al total. */
export const TOTAL_DIMENSIONS = ['macro', 'surprise', 'market_rel', 'forward', 'structural'] as const

/** Campos que DEBEN venir para poder calcular el total (las 5 dimensiones + time_decay). */
export const REQUIRED_BREAKDOWN_FIELDS = [...TOTAL_DIMENSIONS, 'time_decay'] as const

// Umbrales del rubric. Se usan con `>=` en orden descendente, así que las bandas son
// EXHAUSTIVAS para cualquier número real (un total fraccionario nunca cae en un hueco).
const RATING_FLOOR: ReadonlyArray<readonly [number, Rating]> = [
  [19, 'A'], [15, 'B'], [11, 'C'],
]
const SIGNAL_FLOOR: ReadonlyArray<readonly [number, Signal]> = [
  [19, 'STRONG'], [15, 'MODERATE'],
]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Coerción laxa (misma semántica que el `z.coerce.number()` que había en el schema):
 * número finito o string numérica → valor; cualquier otra cosa → 0.
 */
function coerceNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * ¿El modelo REPORTÓ de verdad esta dimensión? Más estricto que la coerción: `null`,
 * `true`, `undefined`, `{}`, `''` y `'abc'` NO cuentan como reporte. Distinguir
 * «reportó 0» de «no reportó» es lo que permite no castigar con D/WEAK a un artículo
 * cuyo breakdown llegó ilegible (ver `deriveScoring`).
 */
function isReported(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string' && v.trim()) return Number.isFinite(Number(v))
  return false
}

/**
 * Normaliza el `score_breakdown` crudo del modelo y dice si es USABLE para re-derivar.
 *
 * `usable` exige que las 6 contribuyentes al total (`macro`, `surprise`, `market_rel`,
 * `forward`, `structural`, `time_decay`) vengan como números reportados. `portfolio` NO
 * afecta a `usable` porque, por el propio rubric, no suma al total.
 */
export function readBreakdown(raw: unknown): { breakdown: ScoreBreakdown; usable: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { breakdown: { ...ZERO_BREAKDOWN }, usable: false }
  }
  const o = raw as Record<string, unknown>
  const breakdown: ScoreBreakdown = {
    macro: coerceNumber(o.macro),
    surprise: coerceNumber(o.surprise),
    market_rel: coerceNumber(o.market_rel),
    forward: coerceNumber(o.forward),
    structural: coerceNumber(o.structural),
    portfolio: coerceNumber(o.portfolio),
    time_decay: coerceNumber(o.time_decay),
  }
  const usable = REQUIRED_BREAKDOWN_FIELDS.every((k) => isReported(o[k]))
  return { breakdown, usable }
}

/**
 * TOTAL del rubric a partir del breakdown. Cada dimensión se acota a SU rango declarado
 * (0..5; `time_decay` −2..0) ANTES de sumar: si no, un `macro: 500` del modelo volvería a
 * darle control sobre el total por la puerta de atrás (sumaría 500 y el clamp final a 25
 * lo dejaría en A). El resultado se redondea a entero porque `market_news.score` es `int`
 * en Postgres, y se acota a 0..MAX_TOTAL.
 */
export function computeTotal(breakdown: ScoreBreakdown): number {
  let sum = 0
  for (const key of TOTAL_DIMENSIONS) sum += clamp(coerceNumber(breakdown[key]), 0, 5)
  sum += clamp(coerceNumber(breakdown.time_decay), -2, 0)
  return clamp(Math.round(sum), 0, MAX_TOTAL)
}

/** RATING por bandas del rubric: A=19-25, B=15-18, C=11-14, D<11. */
export function deriveRating(total: number): Rating {
  for (const [floor, rating] of RATING_FLOOR) if (total >= floor) return rating
  return 'D'
}

/** SIGNAL por bandas del rubric: STRONG>=19, MODERATE 15-18, WEAK<15. */
export function deriveSignal(total: number): Signal {
  for (const [floor, signal] of SIGNAL_FLOOR) if (total >= floor) return signal
  return 'WEAK'
}

export interface DerivedScoring {
  /** Entero 0..25 que se PERSISTE (columna `int`). */
  score: number
  rating: Rating
  signal: Signal
  /** Breakdown normalizado (se persiste tal cual en el jsonb). */
  breakdown: ScoreBreakdown
  /** true ⇒ el breakdown llegó ilegible y el score salió del respaldo del modelo. */
  breakdown_degraded: boolean
  /** true ⇒ el rating o la señal derivados NO coinciden con lo que afirmó el modelo. */
  overridden: boolean
}

export interface ModelClaim {
  /** `score` que afirmó el modelo. Sólo se usa como RESPALDO si el breakdown es ilegible. */
  score?: number
  /** Sólo para telemetría (`overridden`): nunca se persiste. */
  rating?: Rating
  signal?: Signal
}

/**
 * Deriva `score`/`rating`/`signal` del breakdown del modelo.
 *
 * CASO NORMAL (breakdown usable): total = suma del rubric; rating y signal de las bandas.
 * Lo que el modelo afirmó en `score`/`rating`/`signal` se IGNORA por completo.
 *
 * CASO DEGRADADO (breakdown ausente/ilegible — la política de PR5 lo degradaba a ceros
 * conservando el artículo): re-derivar daría 0 → D/WEAK, es decir enterraría un artículo
 * posiblemente bueno por un fallo de formato en un campo que hasta ahora era informativo.
 * En vez de eso se toma el `score` del modelo como RESPALDO y se derivan rating y signal
 * DE ESE score con las MISMAS bandas.
 *
 * Por qué eso NO reabre el agujero que este cambio cierra:
 *  · el agujero era la INCOHERENCIA (rating A con score 4) → aquí es imposible: rating y
 *    signal siempre salen del score persistido, nunca de un campo suelto del modelo;
 *  · el score sigue acotado a 0..25 (no hay reordenación ilimitada del brief);
 *  · sólo aplica cuando el breakdown llega ilegible, lo cual es ANÓMALO y queda contado en
 *    `stats.breakdown_degraded` → visible en `market_briefs.metadata.pipeline` en vez de
 *    ser invisible;
 *  · un breakdown legítimamente TODO A CEROS no entra por aquí (`usable` distingue
 *    «reportó 0» de «no reportó»): ése sí se re-deriva a 0 → D/WEAK, como debe ser.
 */
export function deriveScoring(rawBreakdown: unknown, claim: ModelClaim = {}): DerivedScoring {
  const { breakdown, usable } = readBreakdown(rawBreakdown)

  const score = usable
    ? computeTotal(breakdown)
    : clamp(Math.round(coerceNumber(claim.score)), 0, MAX_TOTAL)

  const rating = deriveRating(score)
  const signal = deriveSignal(score)

  return {
    score,
    rating,
    signal,
    breakdown,
    breakdown_degraded: !usable,
    overridden:
      (claim.rating !== undefined && claim.rating !== rating) ||
      (claim.signal !== undefined && claim.signal !== signal),
  }
}
