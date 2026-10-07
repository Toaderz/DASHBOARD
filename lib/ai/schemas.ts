import { z } from 'zod'

// SEC-10 / SEC-11: la salida del LLM es DATO NO CONFIABLE. Se valida con un esquema estricto antes de
// tocar la base. Estructura y enums: estrictos (si no cuadran, el lote se rechaza). Numeros: se acotan a su
// rango (un 26 en vez de 25 no justifica perder el brief). Textos: con tope generoso; pasarse = rechazo.
// El LLM NUNCA devuelve URLs ni nombre de fuente: devuelve `candidate_id` (indice del candidato que le
// mostramos) y la URL/fuente se toman de nuestros propios datos.

const clamp = (min: number, max: number) =>
  z.number().finite().transform((n) => Math.min(max, Math.max(min, n)))

const text = (max: number) => z.string().max(max)

export const analyzedArticleSchema = z.object({
  rank: clamp(1, 50).transform(Math.round),
  title: text(300),
  date: text(40).default(''),
  candidate_id: z.number().int().min(1).max(100),
  core_event_tag: text(120).default(''),
  summary: text(3000),
  insight: text(3000),
  score: clamp(0, 25),
  rating: z.enum(['A', 'B', 'C', 'D']),
  signal: z.enum(['STRONG', 'MODERATE', 'WEAK']),
  actionability: z.enum(['MONITOR', 'REVIEW', 'CONFIRMS', 'CONTRADICTS']).nullable().default(null),
  score_breakdown: z.object({
    macro: clamp(0, 5),
    surprise: clamp(0, 5),
    market_rel: clamp(0, 5),
    forward: clamp(0, 5),
    structural: clamp(0, 5),
    portfolio: clamp(0, 5),
    time_decay: clamp(-5, 0),
  }),
})

export const weeklySummarySchema = z.object({
  strong_signals: clamp(0, 50),
  moderate_signals: clamp(0, 50),
  weak_noise: clamp(0, 50),
  top_theme: text(300),
  key_risk: text(600),
  context_md: text(8000),
  editorial_stance: text(1500).default(''),
  watchlist_items: z
    .array(z.object({ priority: z.enum(['Alta', 'Media', 'Baja']), item: text(400) }))
    .max(12)
    .default([]),
})

export const analysisResultSchema = z.object({
  articles: z.array(analyzedArticleSchema).max(30),
  weekly_summary: weeklySummarySchema,
})

/** El selector de candidatos devuelve numeros (1..N), nunca URLs. Los ids fuera de rango se filtran despues. */
export const selectionSchema = z.array(z.number().int().min(1)).max(50)

export type ValidatedAnalysis = z.infer<typeof analysisResultSchema>
export type ValidatedArticle = z.infer<typeof analyzedArticleSchema>
