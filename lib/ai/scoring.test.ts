/**
 * Tests de `lib/ai/scoring.ts` — la re-derivación server-authoritative del scoring del brief.
 *
 * Qué protege cada grupo:
 *  · `computeTotal` — que el TOTAL sea exactamente el del rubric del prompt (5 dimensiones
 *    0–5 + time_decay, `portfolio` NO suma) y que ninguna dimensión fuera de rango devuelva
 *    al modelo el control del total por la puerta de atrás.
 *  · `deriveRating`/`deriveSignal` — las bandas A/B/C/D y STRONG/MODERATE/WEAK, con sus
 *    fronteras exactas. Si alguien las mueve, esto lo caza.
 *  · `readBreakdown` — la distinción «reportó 0» vs «no reportó», que es la que decide si un
 *    artículo se re-deriva o cae al respaldo del modelo.
 *  · `deriveScoring` — la coherencia estructural: rating y signal SIEMPRE salen del score
 *    persistido, así que «rating A con score 4» deja de ser representable.
 *  · «MEDICIÓN old vs new» — la magnitud del cambio de producto, escrita con números para
 *    que sea revisable ANTES de desplegar, no descubrible en producción.
 */

import { describe, it, expect } from 'vitest'
import {
  MAX_TOTAL,
  ZERO_BREAKDOWN,
  computeTotal,
  deriveRating,
  deriveScoring,
  deriveSignal,
  readBreakdown,
  type Rating,
  type ScoreBreakdown,
  type Signal,
} from './scoring'

const bd = (p: Partial<ScoreBreakdown>): ScoreBreakdown => ({ ...ZERO_BREAKDOWN, ...p })

describe('computeTotal — el TOTAL del rubric', () => {
  it('suma las 5 dimensiones + time_decay', () => {
    expect(computeTotal(bd({ macro: 5, surprise: 4, market_rel: 4, forward: 5, structural: 3 }))).toBe(21)
  })

  it('aplica time_decay (que es negativo) al total', () => {
    const base = { macro: 5, surprise: 4, market_rel: 5, forward: 4, structural: 3 } // 21
    expect(computeTotal(bd({ ...base, time_decay: 0 }))).toBe(21)
    expect(computeTotal(bd({ ...base, time_decay: -1 }))).toBe(20)
    expect(computeTotal(bd({ ...base, time_decay: -2 }))).toBe(19)
  })

  it('IGNORA portfolio_relevance — regla explícita del rubric', () => {
    const conPortfolio = bd({ macro: 2, surprise: 2, market_rel: 2, forward: 2, structural: 2, portfolio: 5 })
    const sinPortfolio = bd({ macro: 2, surprise: 2, market_rel: 2, forward: 2, structural: 2, portfolio: 0 })
    expect(computeTotal(conPortfolio)).toBe(10)
    expect(computeTotal(sinPortfolio)).toBe(10)
  })

  it('el máximo del rubric es 25 (5 dimensiones × 5, time_decay 0)', () => {
    expect(computeTotal(bd({ macro: 5, surprise: 5, market_rel: 5, forward: 5, structural: 5 }))).toBe(MAX_TOTAL)
    expect(MAX_TOTAL).toBe(25)
  })

  it('acota CADA dimensión a su rango declarado antes de sumar', () => {
    // Sin el clamp por dimensión, macro=500 sumaría 500 y el clamp final a 25 lo dejaría en A:
    // el modelo recuperaría el control del total por la puerta de atrás.
    expect(computeTotal(bd({ macro: 500 }))).toBe(5)
    expect(computeTotal(bd({ macro: -10 }))).toBe(0)
    // time_decay sólo puede RESTAR (0 a −2): un +50 no puede inflar el total.
    expect(computeTotal(bd({ macro: 5, time_decay: 50 }))).toBe(5)
    expect(computeTotal(bd({ macro: 5, time_decay: -50 }))).toBe(3)
  })

  it('el total nunca sale del rango 0..25 aunque el breakdown sea absurdo', () => {
    expect(computeTotal(bd({ macro: 9e9, surprise: 9e9, market_rel: 9e9, forward: 9e9, structural: 9e9 }))).toBe(25)
    expect(computeTotal(bd({ macro: -9e9, time_decay: -9e9 }))).toBe(0)
  })

  it('devuelve un ENTERO (market_news.score es `int` en Postgres)', () => {
    const total = computeTotal(bd({ macro: 4.4, surprise: 4.4, market_rel: 4.4, forward: 4.4, structural: 4.4 }))
    expect(Number.isInteger(total)).toBe(true)
    expect(total).toBe(22) // 22.0
    const impar = computeTotal(bd({ macro: 3.3, surprise: 3.3, market_rel: 3.3, forward: 3.3, structural: 3.3 }))
    expect(Number.isInteger(impar)).toBe(true)
    expect(impar).toBe(17) // 16.5 → 17
  })

  it('coerce strings numéricas y degrada la basura a 0 (igual que el schema anterior)', () => {
    expect(computeTotal(bd({ macro: '5' as unknown as number, surprise: '4' as unknown as number }))).toBe(9)
    expect(computeTotal(bd({ macro: 'cinco' as unknown as number }))).toBe(0)
    expect(computeTotal(bd({ macro: NaN, surprise: Infinity }))).toBe(0)
  })
})

describe('deriveRating / deriveSignal — las bandas del rubric', () => {
  it('RATING: A=19-25, B=15-18, C=11-14, D<11 (fronteras exactas)', () => {
    const cases: Array<[number, Rating]> = [
      [25, 'A'], [19, 'A'],
      [18, 'B'], [15, 'B'],
      [14, 'C'], [11, 'C'],
      [10, 'D'], [0, 'D'],
    ]
    for (const [total, rating] of cases) expect(deriveRating(total)).toBe(rating)
  })

  it('SIGNAL: STRONG>=19, MODERATE 15-18, WEAK<15 (fronteras exactas)', () => {
    const cases: Array<[number, Signal]> = [
      [25, 'STRONG'], [19, 'STRONG'],
      [18, 'MODERATE'], [15, 'MODERATE'],
      [14, 'WEAK'], [0, 'WEAK'],
    ]
    for (const [total, signal] of cases) expect(deriveSignal(total)).toBe(signal)
  })

  it('las bandas son exhaustivas: todo 0..25 cae en un rating y una señal del enum de la DB', () => {
    for (let t = 0; t <= 25; t++) {
      expect(['A', 'B', 'C', 'D']).toContain(deriveRating(t))
      expect(['STRONG', 'MODERATE', 'WEAK']).toContain(deriveSignal(t))
    }
  })

  it('A↔STRONG y B↔MODERATE van siempre de la mano (mismos umbrales en el prompt)', () => {
    for (let t = 0; t <= 25; t++) {
      expect(deriveRating(t) === 'A').toBe(deriveSignal(t) === 'STRONG')
      expect(deriveRating(t) === 'B').toBe(deriveSignal(t) === 'MODERATE')
    }
  })
})

describe('readBreakdown — «reportó 0» vs «no reportó»', () => {
  it('un breakdown completo es usable', () => {
    const raw = { macro: 3, surprise: 2, market_rel: 4, forward: 3, structural: 2, portfolio: 5, time_decay: -1 }
    const { breakdown, usable } = readBreakdown(raw)
    expect(usable).toBe(true)
    expect(breakdown).toEqual(raw)
  })

  it('TODO A CEROS reportado explícitamente SÍ es usable (el modelo dijo 0, no calló)', () => {
    const raw = { macro: 0, surprise: 0, market_rel: 0, forward: 0, structural: 0, portfolio: 0, time_decay: 0 }
    expect(readBreakdown(raw).usable).toBe(true)
  })

  it('`portfolio` ausente NO lo hace inusable: no suma al total', () => {
    const raw = { macro: 3, surprise: 3, market_rel: 3, forward: 3, structural: 3, time_decay: 0 }
    const { breakdown, usable } = readBreakdown(raw)
    expect(usable).toBe(true)
    expect(breakdown.portfolio).toBe(0)
  })

  it('falta CUALQUIERA de las 6 contribuyentes → inusable', () => {
    const full = { macro: 3, surprise: 3, market_rel: 3, forward: 3, structural: 3, time_decay: 0 }
    for (const key of Object.keys(full)) {
      const partial: Record<string, unknown> = { ...full }
      delete partial[key]
      expect(readBreakdown(partial).usable, `falta ${key}`).toBe(false)
    }
  })

  it('valores no numéricos NO cuentan como reporte (null/bool/objeto/string vacía/basura)', () => {
    const full = { macro: 3, surprise: 3, market_rel: 3, forward: 3, structural: 3, time_decay: 0 }
    for (const bogus of [null, true, {}, [], '', '   ', 'cuatro', NaN, Infinity]) {
      expect(readBreakdown({ ...full, macro: bogus }).usable, String(bogus)).toBe(false)
    }
  })

  it('strings numéricas SÍ cuentan (el modelo a veces las emite)', () => {
    const raw = { macro: '3', surprise: '3', market_rel: '3', forward: '3', structural: '3', time_decay: '0' }
    const { breakdown, usable } = readBreakdown(raw)
    expect(usable).toBe(true)
    expect(breakdown.macro).toBe(3)
  })

  it('no-objetos → ceros + inusable, sin lanzar', () => {
    for (const bogus of [undefined, null, 'A', 42, [], [1, 2, 3], true]) {
      const { breakdown, usable } = readBreakdown(bogus)
      expect(usable, String(bogus)).toBe(false)
      expect(breakdown).toEqual(ZERO_BREAKDOWN)
    }
  })
})

describe('deriveScoring — coherencia estructural', () => {
  it('ignora por completo el score/rating/signal del modelo cuando el breakdown es usable', () => {
    const raw = { macro: 2, surprise: 2, market_rel: 3, forward: 2, structural: 2, portfolio: 0, time_decay: 0 } // 11
    const out = deriveScoring(raw, { score: 4, rating: 'A', signal: 'STRONG' })
    expect(out).toMatchObject({ score: 11, rating: 'C', signal: 'WEAK', breakdown_degraded: false, overridden: true })
  })

  it('«rating A con score 4» deja de ser REPRESENTABLE: rating/signal salen del score persistido', () => {
    // Barrido: para cualquier breakdown y cualquier mentira del modelo, la tripleta persistida
    // es siempre internamente coherente.
    for (let m = 0; m <= 5; m++) {
      for (let s = 0; s <= 5; s++) {
        for (const td of [0, -1, -2]) {
          const out = deriveScoring(
            { macro: m, surprise: s, market_rel: 5, forward: 5, structural: 5, time_decay: td },
            { score: 4, rating: 'A', signal: 'STRONG' }
          )
          expect(out.rating).toBe(deriveRating(out.score))
          expect(out.signal).toBe(deriveSignal(out.score))
        }
      }
    }
  })

  it('un breakdown legítimamente TODO A CEROS se re-deriva a 0 → D/WEAK', () => {
    const out = deriveScoring(
      { macro: 0, surprise: 0, market_rel: 0, forward: 0, structural: 0, portfolio: 0, time_decay: 0 },
      { score: 24, rating: 'A', signal: 'STRONG' }
    )
    expect(out).toMatchObject({ score: 0, rating: 'D', signal: 'WEAK', breakdown_degraded: false })
  })

  it('breakdown ILEGIBLE → respaldo al score del modelo, con rating/signal derivados DE ESE score', () => {
    const out = deriveScoring('basura', { score: 17, rating: 'A', signal: 'STRONG' })
    expect(out).toMatchObject({ score: 17, rating: 'B', signal: 'MODERATE', breakdown_degraded: true })
    // El agujero cerrado sigue cerrado: el modelo afirmó A/STRONG y no se le hizo caso.
    expect(out.overridden).toBe(true)
  })

  it('el respaldo también se acota 0..25 y se redondea a entero', () => {
    expect(deriveScoring(null, { score: 9e9 }).score).toBe(25)
    expect(deriveScoring(null, { score: -5 }).score).toBe(0)
    expect(deriveScoring(null, { score: 18.6 }).score).toBe(19)
    expect(deriveScoring(null, { score: NaN }).score).toBe(0)
    expect(deriveScoring(null, {}).score).toBe(0)
  })

  it('el score persistido es SIEMPRE un entero de 0..25 (columna `int` + techo del rubric)', () => {
    const inputs: unknown[] = [
      { macro: 4.4, surprise: 4.4, market_rel: 4.4, forward: 4.4, structural: 4.4, time_decay: 0 },
      { macro: 9e9, surprise: 9e9, market_rel: 9e9, forward: 9e9, structural: 9e9, time_decay: 0 },
      'nope', null, undefined, [], { macro: 1 },
    ]
    for (const input of inputs) {
      const { score } = deriveScoring(input, { score: 13.7 })
      expect(Number.isInteger(score), String(input)).toBe(true)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(25)
    }
  })

  it('`overridden` sólo se marca cuando el modelo afirmó algo DISTINTO', () => {
    const raw = { macro: 5, surprise: 4, market_rel: 4, forward: 5, structural: 3, time_decay: -1 } // 20 → A/STRONG
    expect(deriveScoring(raw, { rating: 'A', signal: 'STRONG' }).overridden).toBe(false)
    expect(deriveScoring(raw, { rating: 'B', signal: 'STRONG' }).overridden).toBe(true)
    expect(deriveScoring(raw, { rating: 'A', signal: 'WEAK' }).overridden).toBe(true)
    // Sin afirmación del modelo (campos inválidos → undefined) no hay nada que contradecir.
    expect(deriveScoring(raw, {}).overridden).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// MEDICIÓN old vs new — la magnitud del cambio de producto, por escrito.
//
// `old` = comportamiento ANTERIOR (pre-cambio): se persistía el `score` del modelo
// clampeado a 0..25 y su `rating`/`signal` tal cual, sin cruzarlos nunca con el breakdown.
// `new` = comportamiento actual (re-derivado del breakdown).
//
// Los fixtures son salidas REALISTAS del modelo, incluidas las incoherentes que motivaron
// el cambio. La tabla de abajo es la evidencia revisable: cada fila dice exactamente qué
// vería el usuario antes y qué ve ahora.
// ════════════════════════════════════════════════════════════════════════════

/** Reimplementación EXACTA del comportamiento anterior, para poder compararlo. */
function legacyScoring(
  claimedScore: number,
  claimedRating: Rating,
  claimedSignal: Signal
): { score: number; rating: Rating; signal: Signal } {
  const n = Number(claimedScore)
  const score = Number.isFinite(n) ? Math.min(25, Math.max(0, n)) : 0
  return { score, rating: claimedRating, signal: claimedSignal }
}

interface Fixture {
  name: string
  breakdown: unknown
  claim: { score: number; rating: Rating; signal: Signal }
  expectedNew: { score: number; rating: Rating; signal: Signal }
}

const FIXTURES: Fixture[] = [
  {
    // Caso sano: el modelo ya era coherente. La re-derivación NO lo toca.
    name: 'A coherente (Fed sube 50pb por sorpresa)',
    breakdown: { macro: 5, surprise: 5, market_rel: 5, forward: 4, structural: 3, portfolio: 4, time_decay: 0 },
    claim: { score: 22, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 22, rating: 'A', signal: 'STRONG' },
  },
  {
    // El bug que motivó todo esto: rating A con score 4.
    name: 'INCOHERENTE: rating A con score 4',
    breakdown: { macro: 2, surprise: 2, market_rel: 3, forward: 2, structural: 2, portfolio: 0, time_decay: 0 },
    claim: { score: 4, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 11, rating: 'C', signal: 'WEAK' },
  },
  {
    // Inflado: sub-scores de C pero el modelo se autoconcede un 24/A/STRONG.
    // Éste es el que más cambia el brief: antes copaba el núcleo A/B y el rank 1.
    name: 'INFLADO: sub-scores de C, score declarado 24',
    breakdown: { macro: 2, surprise: 2, market_rel: 3, forward: 3, structural: 2, portfolio: 3, time_decay: 0 },
    claim: { score: 24, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 12, rating: 'C', signal: 'WEAK' },
  },
  {
    // La re-derivación NO es de un solo sentido: también PROMUEVE al infravalorado.
    name: 'DEFLACTADO: sub-scores de A, score declarado 14',
    breakdown: { macro: 4, surprise: 4, market_rel: 5, forward: 4, structural: 3, portfolio: 2, time_decay: 0 },
    claim: { score: 14, rating: 'C', signal: 'WEAK' },
    expectedNew: { score: 20, rating: 'A', signal: 'STRONG' },
  },
  {
    // Score correcto, etiqueta inflada: 16 es banda B, el modelo dijo A/STRONG.
    name: 'ETIQUETA INFLADA: score 16 correcto, rating A',
    breakdown: { macro: 4, surprise: 3, market_rel: 4, forward: 3, structural: 2, portfolio: 1, time_decay: 0 },
    claim: { score: 16, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 16, rating: 'B', signal: 'MODERATE' },
  },
  {
    // El modelo suele "olvidar" restar time_decay del total que declara.
    name: 'time_decay ignorado por el modelo (-2)',
    breakdown: { macro: 5, surprise: 4, market_rel: 5, forward: 4, structural: 3, portfolio: 2, time_decay: -2 },
    claim: { score: 21, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 19, rating: 'A', signal: 'STRONG' },
  },
  {
    // El modelo suma portfolio_relevance al total (el rubric lo prohíbe explícitamente).
    name: 'portfolio_relevance sumado al total por el modelo',
    breakdown: { macro: 3, surprise: 3, market_rel: 4, forward: 3, structural: 2, portfolio: 5, time_decay: 0 },
    claim: { score: 20, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 15, rating: 'B', signal: 'MODERATE' },
  },
  {
    // Dimensión fuera de rango (0-5) para forzar un total alto.
    name: 'dimensión fuera de rango (macro: 50)',
    breakdown: { macro: 50, surprise: 1, market_rel: 1, forward: 1, structural: 1, portfolio: 0, time_decay: 0 },
    claim: { score: 25, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 9, rating: 'D', signal: 'WEAK' },
  },
  {
    // Banco central extranjero sin contagio: el rubric pide D; el modelo lo sobrevalora.
    name: 'FOCO GEOGRÁFICO: banco central extranjero',
    breakdown: { macro: 2, surprise: 2, market_rel: 1, forward: 2, structural: 2, portfolio: 0, time_decay: 0 },
    claim: { score: 15, rating: 'B', signal: 'MODERATE' },
    expectedNew: { score: 9, rating: 'D', signal: 'WEAK' },
  },
  {
    // Breakdown ILEGIBLE (la política de PR5 lo degradaba a ceros conservando el artículo):
    // respaldo al score del modelo, rating/signal derivados DE ESE score → 17 es B, no A.
    name: 'DEGRADADO: breakdown ilegible, score del modelo 17',
    breakdown: { macro: 'four', surprise: null, forward: {}, structural: [], time_decay: 'n/a' },
    claim: { score: 17, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 17, rating: 'B', signal: 'MODERATE' },
  },
  {
    name: 'DEGRADADO: score_breakdown ausente del todo',
    breakdown: undefined,
    claim: { score: 21, rating: 'A', signal: 'STRONG' },
    expectedNew: { score: 21, rating: 'A', signal: 'STRONG' },
  },
  {
    // Ruido honesto: el modelo ya lo puntuaba como D. Nada cambia.
    name: 'D coherente (explainer genérico)',
    breakdown: { macro: 2, surprise: 1, market_rel: 2, forward: 2, structural: 1, portfolio: 0, time_decay: 0 },
    claim: { score: 8, rating: 'D', signal: 'WEAK' },
    expectedNew: { score: 8, rating: 'D', signal: 'WEAK' },
  },
]

describe('MEDICIÓN old vs new — magnitud del cambio de producto', () => {
  const rows = FIXTURES.map((f) => {
    const old = legacyScoring(f.claim.score, f.claim.rating, f.claim.signal)
    const derived = deriveScoring(f.breakdown, f.claim)
    return { f, old, next: { score: derived.score, rating: derived.rating, signal: derived.signal }, derived }
  })

  it.each(rows.map((r) => [r.f.name, r] as const))('%s', (_name, r) => {
    expect(r.next).toEqual(r.f.expectedNew)
  })

  it('TABLA old → new (12 fixturas): la evidencia por escrito', () => {
    // Formato: nombre | old score/rating/signal | new score/rating/signal | Δscore
    const table = rows.map((r) =>
      `${r.f.name} | ${r.old.score}/${r.old.rating}/${r.old.signal} -> ${r.next.score}/${r.next.rating}/${r.next.signal} | ${r.next.score - r.old.score >= 0 ? '+' : ''}${r.next.score - r.old.score}`
    )
    expect(table).toEqual([
      'A coherente (Fed sube 50pb por sorpresa) | 22/A/STRONG -> 22/A/STRONG | +0',
      'INCOHERENTE: rating A con score 4 | 4/A/STRONG -> 11/C/WEAK | +7',
      'INFLADO: sub-scores de C, score declarado 24 | 24/A/STRONG -> 12/C/WEAK | -12',
      'DEFLACTADO: sub-scores de A, score declarado 14 | 14/C/WEAK -> 20/A/STRONG | +6',
      'ETIQUETA INFLADA: score 16 correcto, rating A | 16/A/STRONG -> 16/B/MODERATE | +0',
      'time_decay ignorado por el modelo (-2) | 21/A/STRONG -> 19/A/STRONG | -2',
      'portfolio_relevance sumado al total por el modelo | 20/A/STRONG -> 15/B/MODERATE | -5',
      'dimensión fuera de rango (macro: 50) | 25/A/STRONG -> 9/D/WEAK | -16',
      'FOCO GEOGRÁFICO: banco central extranjero | 15/B/MODERATE -> 9/D/WEAK | -6',
      'DEGRADADO: breakdown ilegible, score del modelo 17 | 17/A/STRONG -> 17/B/MODERATE | +0',
      'DEGRADADO: score_breakdown ausente del todo | 21/A/STRONG -> 21/A/STRONG | +0',
      'D coherente (explainer genérico) | 8/D/WEAK -> 8/D/WEAK | +0',
    ])
  })

  it('DISTRIBUCIÓN de ratings: menos A, más C/D (el efecto de producto esperado)', () => {
    const count = (get: (r: typeof rows[number]) => string) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        const k = get(r)
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {})

    expect(count((r) => r.old.rating)).toEqual({ A: 9, B: 1, C: 1, D: 1 })
    expect(count((r) => r.next.rating)).toEqual({ A: 4, B: 3, C: 2, D: 3 })
    expect(count((r) => r.old.signal)).toEqual({ STRONG: 9, MODERATE: 1, WEAK: 2 })
    expect(count((r) => r.next.signal)).toEqual({ STRONG: 4, MODERATE: 3, WEAK: 5 })
  })

  it('DISTRIBUCIÓN de cambios: 8/12 cambian de rating, 7 bajan, 1 sube, 3 intactas', () => {
    const changedRating = rows.filter((r) => r.old.rating !== r.next.rating)
    const changedScore = rows.filter((r) => r.old.score !== r.next.score)
    const demoted = rows.filter((r) => 'ABCD'.indexOf(r.next.rating) > 'ABCD'.indexOf(r.old.rating))
    const promoted = rows.filter((r) => 'ABCD'.indexOf(r.next.rating) < 'ABCD'.indexOf(r.old.rating))

    expect(changedRating).toHaveLength(8)
    expect(changedScore).toHaveLength(7)
    expect(demoted).toHaveLength(7)
    expect(promoted).toHaveLength(1)
    // 3 de las 12 quedan intactas en score, rating y señal.
    expect(rows.filter((r) => r.old.score === r.next.score && r.old.rating === r.next.rating && r.old.signal === r.next.signal)).toHaveLength(3)
  })

  it('el núcleo A/B de `selectFinalArticles` se reduce de 10/12 a 7/12', () => {
    const core = (get: (r: typeof rows[number]) => string) =>
      rows.filter((r) => get(r) === 'A' || get(r) === 'B').length
    expect(core((r) => r.old.rating)).toBe(10)
    expect(core((r) => r.next.rating)).toBe(7)
  })

  it('la garantía de portafolio (score>=11) se estrecha de 10/12 a 9/12', () => {
    expect(rows.filter((r) => r.old.score >= 11)).toHaveLength(10)
    expect(rows.filter((r) => r.next.score >= 11)).toHaveLength(9)
  })

  it('sólo 2/12 caen al respaldo por breakdown ilegible', () => {
    expect(rows.filter((r) => r.derived.breakdown_degraded)).toHaveLength(2)
    // …y ninguno de los dos queda incoherente.
    for (const r of rows) {
      expect(r.derived.rating).toBe(deriveRating(r.derived.score))
      expect(r.derived.signal).toBe(deriveSignal(r.derived.score))
    }
  })
})
