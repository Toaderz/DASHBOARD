import { tavily } from '@tavily/core'
import Firecrawl from 'firecrawl'
import type { SupabaseClient } from '@supabase/supabase-js'
import { callLLM, extractJson } from './llm'
import { sourceAuthority } from './source-authority'
import { buildCleanMarkdown, type ExtractedJson } from './article-clean'
import {
  enrichAssetProfiles,
  loadUniverseAssets,
  matchAffectedSymbols,
  type UniverseAsset,
} from './asset-enrichment'
import type { AffectedSymbol } from '@/types'

// ── Types ────────────────────────────────────────────────────

// Categoría semántica de la query que originó el candidato (NO el `topic` de Tavily,
// que solo distingue 'finance'/'news'). Es el bucket de DIVERSIDAD: el pre-ranking
// reparte cuotas por categoría para que un macro-evento no monopolice el pool.
export type NewsCategory =
  | 'fed-macro'    // Economía / Reserva Federal / macro EE.UU.
  | 'mexico'       // México / Banxico / peso
  | 'geopolitics'  // gobierno EE.UU. / aranceles / geopolítica / energía
  | 'portfolio'    // earnings / noticias de los tickers del universo
  | 'technology'   // sector tecnología / IA

// Orden estable de categorías para el reparto round-robin del pre-ranking.
const NEWS_CATEGORY_ORDER: NewsCategory[] = [
  'fed-macro', 'mexico', 'geopolitics', 'portfolio', 'technology',
]

export interface RawArticle {
  url: string
  title: string
  content: string  // snippet from Tavily
  score: number
  published_date?: string
  source?: string
  category?: NewsCategory  // query que lo surfó primero (para cuotas de diversidad)
}

export interface AnalyzedArticle {
  rank: number
  title: string
  date: string
  source_name: string
  source_url: string
  summary: string
  insight: string
  // Etiqueta canónica del SUCESO base (≤5 palabras). Dos artículos del mismo evento
  // deben compartirla → dedup semántica dura en selectFinalArticles. Siempre string
  // tras analyzeAndSynthesize (se normaliza el output del LLM; '' si no la devolvió).
  core_event_tag: string
  score: number
  rating: 'A' | 'B' | 'C' | 'D'
  signal: 'STRONG' | 'MODERATE' | 'WEAK'
  actionability: 'MONITOR' | 'REVIEW' | 'CONFIRMS' | 'CONTRADICTS' | null
  score_breakdown: {
    macro: number
    surprise: number
    market_rel: number
    forward: number
    structural: number
    portfolio: number
    time_decay: number
  }
  // El LLM ya NO emite esto: affected_symbols se calcula de forma determinista (Fase B)
  // tras el análisis. Se mantiene opcional por compatibilidad.
  affected_tickers?: string[]
}

export interface WeeklySummary {
  strong_signals: number
  moderate_signals: number
  weak_noise: number
  top_theme: string
  key_risk: string
  context_md: string
  editorial_stance: string
  watchlist_items: Array<{ priority: 'Alta' | 'Media' | 'Baja'; item: string }>
}

export interface PipelineResult {
  articles: AnalyzedArticle[]
  weekly_summary: WeeklySummary
}

// ── Helpers ──────────────────────────────────────────────────

function getTavilyClient() {
  return tavily({ apiKey: process.env.TAVILY_API_KEY! })
}

// Cadena de clientes Firecrawl: clave primaria + respaldo (FIRECRAWL_API_KEY_2).
// Si la primaria se queda sin créditos, extractContent salta a la siguiente automáticamente.
function buildFirecrawlClients(): Firecrawl[] {
  const keys = [process.env.FIRECRAWL_API_KEY, process.env.FIRECRAWL_API_KEY_2]
    .map((k) => k?.trim())
    .filter((k): k is string => !!k)
  return keys.map((apiKey) => new Firecrawl({ apiKey }))
}

// Errores que indican que la CLAVE está agotada/bloqueada (créditos/cuota/rate-limit),
// no un fallo del sitio: marcan la clave como muerta para el resto de la corrida.
const isFirecrawlKeyExhausted = (e: unknown) =>
  /\b(401|402|429)\b|payment required|insufficient|out of credits|no credits|\bcredit|quota|rate.?limit|too many requests/i.test(String(e))

// ── Function A ───────────────────────────────────────────────

export async function getTopTickers(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_top_tickers')

  // Fallback: manual query if RPC not defined.
  // source='user': excluye peers auto-materializados (no son holdings elegidos por el usuario).
  if (error) {
    const { data: rows } = await supabase
      .from('watchlist_assets')
      .select('asset_ticker')
      .eq('source', 'user')
    if (!rows) return []
    const freq = new Map<string, number>()
    for (const row of rows) {
      freq.set(row.asset_ticker, (freq.get(row.asset_ticker) ?? 0) + 1)
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([ticker]) => ticker)
  }

  return (data as Array<{ ticker: string }>).map((r) => r.ticker)
}

// Catálogo descriptivo (ticker — nombre [sector/industria]) — SOLO para que el LLM entienda
// el CONTEXTO del universo de la plataforma. El LLM ya NO decide relevancia (eso es determinista).
// Se pasa el universo completo de tickers más repetidos (cabe de sobra en el contexto del modelo).
export async function getTickerCatalog(supabase: SupabaseClient, tickers: string[]): Promise<string> {
  const top = tickers
  if (!top.length) return ''
  const { data } = await supabase
    .from('assets_metadata')
    .select('ticker,name,sector,industry')
    .in('ticker', top)
  const byTicker = new Map((data ?? []).map((r) => [r.ticker as string, r]))
  return top
    .map((t) => {
      const m = byTicker.get(t)
      if (!m) return t
      const tags = [m.sector, m.industry].filter(Boolean).join('/')
      return `${t} — ${m.name ?? ''}${tags ? ` [${tags}]` : ''}`.trim()
    })
    .join('\n')
}

// ── Function B ───────────────────────────────────────────────

// Fuentes oficiales/neutras y de acceso abierto (paywall ligero o nulo).
// Restringe la búsqueda de Tavily a estas → excluye automáticamente Yahoo Finance
// y los de paywall duro (WSJ, Bloomberg, FT), y permite extraer el artículo completo.
// Nota: se excluyen los sitios .gov/IMF como FUENTE DE NOTICIAS porque devuelven
// explainers/discursos/datos en vez de artículos; sus decisiones se cubren vía estas agencias.
// Todas de acceso abierto o paywall ligero (extraíbles por Firecrawl) y neutras/profesionales.
// El pre-ranking por autoridad (source-authority.ts) prioriza las de cable/profesional, así que
// ampliar la lista no degrada calidad: las de menor autoridad quedan al fondo solas.
// Enfoque trader: tasas, declaraciones del gobierno de EE.UU., geopolítica de alto impacto.
const NEWS_SOURCES = [
  'reuters.com', 'apnews.com',        // agencias de cable (máxima neutralidad)
  'bbc.com', 'theguardian.com',       // prensa general de calidad
  'cnbc.com', 'marketwatch.com',      // mercados
  'axios.com', 'npr.org',             // política/macro EE.UU., texto limpio
  'thehill.com', 'politico.com',      // gobierno y política de EE.UU.
  'aljazeera.com',                    // geopolítica (Medio Oriente, Irán)
  'semafor.com', 'fortune.com',       // negocios/mercados, acceso abierto
]

// Títulos que NO son artículos de noticia (páginas índice, columnas de mercado, live blogs).
const JUNK_TITLE = /stock market headlines|breaking stock market news|^market talk\b|live (updates|blog|coverage)|what to watch|markets? (wrap|roundup)|things to know|newsletter/i

export async function searchNews(tickers: string[]): Promise<RawArticle[]> {
  const client = getTavilyClient()
  const topTickers = tickers.slice(0, 20).join(' OR ')

  // Foco geográfico: EE.UU. + México (más temas globales que SÍ mueven esos mercados:
  // petróleo/commodities, geopolítica de alto impacto, grandes tecnológicas, treasuries).
  // Evita atraer decisiones domésticas de bancos centrales irrelevantes (Sudáfrica, Corea, etc.).
  // `category` es el bucket de diversidad del pre-ranking (uno por query). NO confundir con
  // `topic`, que es el modo de búsqueda de Tavily ('finance'/'news').
  const queries: Array<{
    query: string
    topic: 'finance' | 'news'
    days: number
    max_results: number
    category: NewsCategory
  }> = [
    { category: 'fed-macro',   query: 'US economy markets Federal Reserve outlook this week', topic: 'finance', days: 7, max_results: 12 },
    { category: 'mexico',      query: 'Federal Reserve interest rates US inflation; Banxico Mexico monetary policy peso', topic: 'finance', days: 7, max_results: 10 },
    { category: 'geopolitics', query: 'US government policy tariffs trade geopolitical risk oil market impact', topic: 'news', days: 7, max_results: 10 },
    { category: 'portfolio',   query: `${topTickers} earnings revenue guidance market news`, topic: 'finance', days: 7, max_results: 10 },
    { category: 'technology',  query: 'US technology AI sector stocks institutional investors outlook', topic: 'finance', days: 7, max_results: 8 },
  ]

  const results = await Promise.allSettled(
    queries.map((q) =>
      client.search(q.query, {
        topic: q.topic,
        days: q.days,
        maxResults: q.max_results,
        timeRange: 'week',
        includeAnswer: false,
        includeDomains: NEWS_SOURCES,
      })
    )
  )

  const seen = new Set<string>()
  const articles: RawArticle[] = []
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)

  // Itera por índice para mantener la asociación resultado→query (mismo orden que Promise.allSettled).
  // La primera query que surfa una URL le fija su `category` (dedup-por-primero, determinista).
  for (let qi = 0; qi < results.length; qi++) {
    const result = results[qi]
    if (result.status === 'rejected') continue
    const category = queries[qi].category
    for (const item of result.value.results) {
      if (!item.url || seen.has(item.url)) continue
      if ((item.score ?? 0) < 0.4) continue
      // Descarta páginas no-artículo: índices de titulares, "Market Talk", live blogs, "what to watch".
      if (JUNK_TITLE.test(item.title ?? '')) continue
      // Hard reject articles older than 10 days
      if (item.publishedDate) {
        const pub = new Date(item.publishedDate)
        if (!isNaN(pub.getTime()) && pub < cutoff) continue
      }
      seen.add(item.url)
      articles.push({
        url: item.url,
        title: item.title ?? '',
        content: item.content ?? '',
        score: item.score ?? 0,
        published_date: item.publishedDate ?? undefined,
        source: item.url ? new URL(item.url).hostname.replace('www.', '') : undefined,
        category,
      })
    }
  }

  return articles.sort((a, b) => b.score - a.score).slice(0, 25)
}

// ── Pre-ranking determinista ─────────────────────────────────

// Cuántos candidatos pasan a extracción/análisis (cota superior; el conteo FINAL del brief
// lo decide la calidad: 5 a 7, ver selectFinalArticles).
// Headroom DELIBERADO (>7): la dedup por core_event_tag colapsa varios candidatos del MISMO
// suceso en 1, así que analizamos de más para que tras la dedup queden ≥5 eventos distintos
// y el piso de 5 sea alcanzable incluso en semanas con un macro-evento dominante.
const MAX_CANDIDATES = 10

// Recencia 0..1 (hoy = 1, ~0 a los 10 días). Penaliza noticias viejas sin descartarlas.
function recencyScore(publishedDate?: string): number {
  if (!publishedDate) return 0.5
  const pub = new Date(publishedDate)
  if (isNaN(pub.getTime())) return 0.5
  const days = (Date.now() - pub.getTime()) / 86_400_000
  return Math.max(0, Math.min(1, 1 - days / 10))
}

// Clave canónica de agrupación por suceso. Robusta a las variaciones del LLM:
// minúsculas, sin acentos, sin puntuación, espacios colapsados. '' si no hay tag.
export function normalizeEventTag(tag: string | null | undefined): string {
  if (!tag || typeof tag !== 'string') return ''
  return tag
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos (Decisión → decision)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                      // quita puntuación
    .replace(/\s+/g, ' ')                              // colapsa espacios
    .trim()
}

// Ordena candidatos por una señal compuesta y determinista ANTES del LLM:
// relevancia de búsqueda (Tavily) + autoridad de fuente + recencia + un empujón si toca
// el portafolio (para que esas noticias no se caigan del set de candidatos).
// `relevantUrls`: URLs que cruzan el universo (matching preliminar por snippet, hecho por el caller).
//
// CUOTAS DE DIVERSIDAD (anti-cámara-de-eco): en vez de un Top-N global —donde un macro-evento
// con score altísimo barre todos los slots— reparte por CATEGORÍA en round-robin: cada bucket
// coloca su mejor candidato antes de que ninguno coloque el 2º (`perCategory` rondas). Los slots
// sobrantes hasta `limit` se rellenan con los mejores globales restantes. Así el LLM de selección
// recibe un pool forzosamente diverso (Fed, México, geopolítica, portafolio, tecnología) y la
// deduplicación dura final (selectFinalArticles) ya no tiene 5 notas del mismo suceso que comprimir.
export function rankCandidates(
  articles: RawArticle[],
  relevantUrls?: Set<string>,
  limit = 14,
  perCategory = 3
): RawArticle[] {
  const composite = (a: RawArticle): number => {
    const tavily = Math.max(0, Math.min(1, a.score))
    const authority = sourceAuthority(a.source ?? a.url)
    const recency = recencyScore(a.published_date)
    const portfolio = relevantUrls?.has(a.url) ? 1 : 0
    return 0.4 * tavily + 0.3 * authority + 0.2 * recency + 0.1 * portfolio
  }

  // Orden global descendente: base para los buckets, el round-robin y el relleno.
  const scored = [...articles]
    .map((a) => ({ a, c: composite(a) }))
    .sort((x, y) => y.c - x.c)

  if (scored.length <= limit) return scored.map((x) => x.a)

  // Agrupa por categoría preservando el orden desc dentro de cada bucket.
  const buckets = new Map<string, RawArticle[]>()
  for (const { a } of scored) {
    const key = a.category ?? 'uncategorized'
    const arr = buckets.get(key)
    if (arr) arr.push(a)
    else buckets.set(key, [a])
  }

  // Orden estable de categorías: las conocidas primero (orden fijo), luego cualquier
  // extra/'uncategorized' presente (alfabético) para que el reparto sea determinista.
  const known = NEWS_CATEGORY_ORDER as readonly string[]
  const extras = [...buckets.keys()].filter((k) => !known.includes(k)).sort()
  const categoryOrder = [...known, ...extras].filter((k) => buckets.has(k))

  const picked: RawArticle[] = []
  const pickedUrls = new Set<string>()

  // Fase 1 — cuota equitativa por categoría (round-robin hasta `perCategory` o `limit`).
  for (let round = 0; round < perCategory && picked.length < limit; round++) {
    for (const cat of categoryOrder) {
      if (picked.length >= limit) break
      const item = buckets.get(cat)?.[round]
      if (item && !pickedUrls.has(item.url)) {
        picked.push(item)
        pickedUrls.add(item.url)
      }
    }
  }

  // Fase 2 — rellena los slots restantes con los mejores globales aún no elegidos.
  for (const { a } of scored) {
    if (picked.length >= limit) break
    if (!pickedUrls.has(a.url)) {
      picked.push(a)
      pickedUrls.add(a.url)
    }
  }

  // Devuelve en orden de score compuesto desc (el fallback determinista de selectTop7
  // respeta este orden, y así limita 2 por dominio empezando por el mejor material).
  return picked.sort((x, y) => composite(y) - composite(x))
}

// ── Function C ───────────────────────────────────────────────

// Selección por IMPORTANCIA de mercado vía LLM (el score de Tavily mide relevancia de búsqueda,
// no importancia, y pondría páginas índice/opinión por encima de decisiones de bancos centrales).
// Recibe candidatos YA pre-rankeados; el respaldo determinista preserva ese orden + diversidad.
export async function selectTop7(articles: RawArticle[]): Promise<string[]> {
  const TARGET = MAX_CANDIDATES

  // El input ya viene pre-rankeado: el fallback respeta ese orden y limita 2 por fuente.
  const deterministic = (): string[] => {
    const perDomain = new Map<string, number>()
    const picked: string[] = []
    for (const a of articles) {
      const domain = a.source ?? a.url
      const count = perDomain.get(domain) ?? 0
      if (count >= 2) continue
      perDomain.set(domain, count + 1)
      picked.push(a.url)
      if (picked.length >= TARGET) break
    }
    for (const a of articles) {
      if (picked.length >= TARGET) break
      if (!picked.includes(a.url)) picked.push(a.url)
    }
    return picked.slice(0, TARGET)
  }

  if (articles.length <= TARGET) return articles.map((a) => a.url)

  const list = articles
    .map((a, i) => `${i + 1}. ${a.title} — ${a.source ?? ''}\n${a.url}\n${a.content.slice(0, 180)}`)
    .join('\n\n')

  const prompt = `Eres un editor de mercados para un lector de EE.UU. y México. De la lista, elige hasta ${TARGET} noticias MÁS IMPORTANTES por su impacto de mercado real para ESE lector (puedes elegir menos si no hay tantas que valgan la pena).

FOCO GEOGRÁFICO (clave): prioriza EE.UU. y México. Cuentan como relevantes: la Reserva Federal y datos macro de EE.UU., Banxico/peso y macro de México, gobierno/Congreso de EE.UU., empresas de EE.UU., y temas GLOBALES que mueven los mercados de EE.UU. (petróleo/commodities, geopolítica de alto impacto como Irán/Medio Oriente, grandes tecnológicas, treasuries).
DESPRIORIZA FUERTE: decisiones de tasas o política doméstica de OTROS países (p.ej. Sudáfrica, Corea del Sur, política interna europea aislada) cuyo impacto NO llegue claramente a EE.UU./México. No las elijas solo por ser "decisiones de banco central"; para este lector son de bajo interés salvo que el propio texto muestre contagio claro a EE.UU./México o a un activo global importante.
DESCARTA: páginas índice de titulares, columnas tipo "Market Talk", "what to watch", live blogs, listicles ("top/bottom performers"), guías genéricas — salvo que sean claramente market-moving.
NO REDUNDANCIA (clave): agrupa mentalmente las noticias que cubren el MISMO evento o sub-tema (p.ej. varias declaraciones de distintos funcionarios de la Fed sobre inflación/tasas la misma semana = UN solo tema) y elige SOLO LA MEJOR de cada grupo (la más completa, reciente o de mayor impacto). NO incluyas dos o tres noticias que, leídas juntas, le dirían al lector básicamente lo mismo. Como mucho 1 noticia por sub-tema; permite una 2ª del mismo tema únicamente si aporta un ángulo claramente NUEVO (un dato, una postura opuesta, o una consecuencia distinta). Prefiere COBERTURA AMPLIA (Fed, empresas/earnings, geopolítica/energía, México, tecnología) sobre profundizar en un solo tema.
DIVERSIDAD: cubre temas distintos; máximo 2 de la misma fuente.

Devuelve SOLO un array JSON de hasta ${TARGET} URLs por orden de importancia, sin texto adicional.
Ejemplo: ["https://...", "https://..."]

NOTICIAS:
${list}`

  try {
    const response = await callLLM({ role: 'selection', prompt, temperature: 0.2 })
    const urls = extractJson<string[]>(response)
    const valid = urls.filter((u) => articles.some((a) => a.url === u)).slice(0, TARGET)
    return valid.length >= 3 ? valid : deterministic()
  } catch {
    return deterministic()
  }
}

// ── Selección final del brief (conteo variable 5–7 + garantía de inclusión) ──

export interface SelectableArticle {
  source_url: string
  score: number
  rating: 'A' | 'B' | 'C' | 'D'
  core_event_tag?: string  // etiqueta canónica del suceso (dedup semántica dura)
}

// Colapsa artículos del MISMO suceso (core_event_tag normalizado): conserva SOLO el de mayor
// score total. Empate de score → prefiere el relevante para el portafolio (no perder esa señal).
// Tags vacíos/ausentes → cada artículo es ÚNICO (clave por source_url; nunca se fusionan entre sí).
function dedupeByEvent<T extends SelectableArticle>(articles: T[], isRelevant: (a: T) => boolean): T[] {
  const winners = new Map<string, T>()
  for (const a of articles) {
    const tag = normalizeEventTag(a.core_event_tag)
    const key = tag || `__unique__:${a.source_url}`
    const cur = winners.get(key)
    if (!cur) {
      winners.set(key, a)
      continue
    }
    const wins = a.score > cur.score || (a.score === cur.score && isRelevant(a) && !isRelevant(cur))
    if (wins) winners.set(key, a)
  }
  return [...winners.values()]
}

// Decide qué artículos ENTRAN al brief tras el análisis. Reglas (en orden):
// 0. DEDUP SEMÁNTICA DURA: agrupa por core_event_tag y conserva solo el de mayor score por suceso.
//    Es la defensa anti-cámara-de-eco: aunque 5 notas del mismo macro-evento lleguen como A/STRONG,
//    aquí quedan reducidas a 1 ANTES de competir por los slots, liberando espacio para otros temas.
// 1. Núcleo de calidad: ratings A/B (STRONG/MODERATE), ordenados por score.
// 2. Conteo variable 5–7: si el núcleo es <5, rellena con los mejores siguientes; nunca >7.
// 3. Garantía de inclusión: una noticia que TOCA el portafolio y supera el mínimo (score>=11, C+)
//    entra aunque no sea top macro, SUSTITUYENDO a la de menor importancia NO relevante del set,
//    priorizando entre las garantizadas las de mayor score. Nunca excede el tope de 7.
export function selectFinalArticles<T extends SelectableArticle>(
  articles: T[],
  isRelevant: (a: T) => boolean,
  min = 5,
  max = 7
): T[] {
  if (!articles.length) return []
  const byScore = (a: T, b: T) => b.score - a.score

  // Paso 0 — dedup semántica dura por suceso (antes de cualquier selección).
  const deduped = dedupeByEvent(articles, isRelevant)
  const sorted = [...deduped].sort(byScore)

  // Núcleo: A/B. Si no llega al mínimo, rellena con los siguientes mejores (incluye D solo si hace falta).
  const selected = sorted.filter((a) => a.rating === 'A' || a.rating === 'B').slice(0, max)
  if (selected.length < min) {
    for (const a of sorted) {
      if (selected.length >= min) break
      if (!selected.includes(a)) selected.push(a)
    }
  }

  // Garantía de inclusión por portafolio (mayor score primero), respetando el tope.
  const guaranteed = sorted.filter((a) => isRelevant(a) && a.score >= 11 && !selected.includes(a))
  for (const g of guaranteed) {
    if (selected.length < max) {
      selected.push(g)
      continue
    }
    // Sustituye a la de MENOR importancia NO relevante del set; si todas son relevantes, no toca.
    const replaceables = selected.filter((s) => !isRelevant(s))
    if (!replaceables.length) break
    const weakest = replaceables.reduce((lo, s) => (s.score < lo.score ? s : lo), replaceables[0])
    selected.splice(selected.indexOf(weakest), 1)
    selected.push(g)
  }

  return selected.sort(byScore).slice(0, max)
}

// ── Function D ───────────────────────────────────────────────

const EXTRACTION_PROMPT =
  'Extract ONLY the main news article. Return clean markdown of the article body: the dek/standfirst ' +
  '(if any) followed by the full article paragraphs, with a blank line between every paragraph. ' +
  'Do NOT repeat the article headline as a heading (omit the H1 title). Keep genuinely relevant ' +
  'CONTENT images embedded inline as markdown images with their original alt/caption text — that ' +
  'means photos that illustrate the story and charts/graphs/data visualizations. EXCLUDE every other ' +
  'image: agency logos (e.g. a "Reuters"/"Getty"/"AP" wordmark), site logos, section icons, author ' +
  'avatars/headshots, ad banners, social buttons and tracking pixels. Also EXCLUDE all non-article ' +
  'text: navigation, stock-ticker rails, "skip to", "what to read next", related/most-popular lists, ' +
  'subscriber/paywall notices, copyright/legal lines and Dow Jones hashes, newsletter sign-ups, ' +
  'social share links, cookie/consent banners, ads, and chart/widget text dumps (e.g. "Created with Highcharts").'

// Reject the scrape promise if Firecrawl takes longer than `ms` (stealth + AI extraction is slow).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('scrape timeout')), ms)),
  ])
}

export async function extractContent(urls: string[]): Promise<Map<string, string>> {
  const clients = buildFirecrawlClients()
  const contentMap = new Map<string, string>()
  const dead = new Set<number>() // índices de claves agotadas: no reintentarlas en esta corrida

  // Ejecuta `fn` recorriendo la cadena de claves Firecrawl. Salta las ya agotadas; si una
  // devuelve error de créditos/cuota la marca muerta. Devuelve el primer éxito; lanza si todas fallan.
  async function withClientChain<T>(fn: (client: Firecrawl) => Promise<T>, ms: number): Promise<T> {
    let lastErr: unknown
    for (let i = 0; i < clients.length; i++) {
      if (dead.has(i)) continue
      try {
        return await withTimeout(fn(clients[i]), ms)
      } catch (e) {
        lastErr = e
        if (isFirecrawlKeyExhausted(e)) dead.add(i)
      }
    }
    throw lastErr ?? new Error('no hay clientes Firecrawl disponibles (revisa FIRECRAWL_API_KEY)')
  }

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        // Primary: Firecrawl server-side AI extraction. Las fuentes son de acceso abierto,
        // así que `proxy: 'auto'` (sólo escala si el sitio bloquea) ahorra créditos vs stealth.
        const result = await withClientChain((client) => client.scrape(url, {
          formats: [{
            type: 'json',
            prompt: EXTRACTION_PROMPT,
            schema: {
              type: 'object',
              properties: {
                body_markdown: { type: 'string' },
              },
              required: ['body_markdown'],
            },
          }],
          onlyMainContent: true,
          blockAds: true,
          proxy: 'auto',
          removeBase64Images: true,
        }), 70_000)

        const clean = buildCleanMarkdown((result.json ?? {}) as ExtractedJson)
        if (clean) {
          contentMap.set(url, clean)
          return
        }
      } catch {
        // Fall through to plain-markdown fallback below.
      }

      try {
        // Fallback: plain markdown scrape, run through the same cleaner (junk-image + leading-H1 strip).
        const result = await withClientChain((client) => client.scrape(url, {
          formats: ['markdown'],
          onlyMainContent: true,
          blockAds: true,
          proxy: 'auto',
          removeBase64Images: true,
        }), 60_000)
        const clean = buildCleanMarkdown({ body_markdown: result.markdown })
        if (clean) {
          contentMap.set(url, clean)
        }
      } catch {
        // Leave empty — caller uses Tavily snippet as scoring fallback; modal button hides when null.
      }
    })
  )

  return contentMap
}

// ── Function E ───────────────────────────────────────────────

export async function analyzeAndSynthesize(
  articles: RawArticle[],
  contentMap: Map<string, string>,
  tickers: string[],
  tickerCatalog = ''
): Promise<PipelineResult> {
  const articleBlocks = articles.map((a, i) => {
    const fullText = contentMap.get(a.url) ?? a.content
    return `--- ARTICLE ${i + 1} ---
URL: ${a.url}
Title: ${a.title}
Source: ${a.source ?? 'unknown'}
Date: ${a.published_date ?? 'unknown'}
Content:
${fullText.slice(0, 1000)}`
  }).join('\n\n')

  const systemPrompt = `Eres un editor de research financiero. Resumes noticias de forma DESCRIPTIVA, FACTUAL y NEUTRAL para que un equipo profesional entienda qué pasó, el contexto y hacia dónde apunta el tema, y SAQUE SUS PROPIAS conclusiones. Produces JSON estructurado en español.

REGLAS DURAS (inviolables):
1. PROHIBIDO inventar datos. Usa SOLO cifras, fechas, nombres, instituciones y niveles que aparezcan EXPLÍCITAMENTE en el contenido del artículo. Si un dato no está en el texto, NO lo menciones. Nunca inventes reacciones de mercado, puntos básicos ni porcentajes.
2. CIFRAS (máxima importancia): si el artículo DA un dato numérico (una subida de tasas, un %, un nivel, un monto), DEBE aparecer con su magnitud en el summary. Si el artículo NO menciona el número (p.ej. dice "se espera una subida" o "el gobierno está hawkish" sin cifra), NO lo inventes bajo ninguna circunstancia: descríbelo de forma cualitativa.
3. PROHIBIDO recomendar o imponer postura. Nada de consejos ("los inversores deben/deberían"), ni llamadas de mercado con niveles concretos inventados ("el dólar caerá a X"). SÍ se permite una DIRECCIÓN SUAVE y cualitativa cuando se desprende del propio artículo (p.ej. "esto tiende a presionar a los semiconductores", "suele favorecer a los exportadores"), siempre matizada y sin predecir cifras. El objetivo: que el lector forme su propio juicio.
4. CADA oración debe contener un detalle ESPECÍFICO de ESE artículo: un nombre propio, lugar, cifra, fecha o argumento concreto tomado del texto. Una oración que podría aplicar a cualquier noticia está PROHIBIDA y debe eliminarse.
5. PROHIBIDO repetir frases entre artículos. Cada resumen y cada análisis deben ser únicos y referirse a los detalles propios de su artículo.

FRASES PROHIBIDAS (no las uses nunca, ni variantes): "tendrá un impacto significativo en la economía y los mercados financieros", "serán clave para tomar decisiones informadas", "debe equilibrar su mandato dual", "es importante monitorear", "puede tener implicaciones en los mercados", "afecta a la economía en general", "es crucial para mantener la estabilidad", "navegar este escenario desafiante", "incertidumbre y volatilidad en los mercados".

CAMPO "summary" — 1 párrafo de 3 a 4 oraciones: QUÉ pasó con los hechos y datos concretos del artículo + el contexto necesario para entenderlo. Puramente descriptivo.

CAMPO "insight" (es el ANÁLISIS de contexto) — 1 párrafo de 2 a 3 oraciones: el TRASFONDO y HACIA DÓNDE APUNTA el tema según ESTE artículo: por qué surge, qué fuerzas o argumentos concretos están en juego, qué posturas o desenlaces describe el texto. Cita los detalles específicos del artículo (quién dijo qué, dónde, con qué dato). Puedes incluir una DIRECCIÓN SUAVE y matizada que se desprenda del texto (cómo tiende a afectar a un sector/activo), pero sin recomendar ni predecir niveles. Das contexto para que el lector forme su propio juicio; NO des tú el juicio.

EJEMPLO BIEN (insight): "El recelo sobre la independencia del banco central resurge porque, según Helge Berger (FMI) en Dubrovnik, controlar la inflación obliga a medidas impopulares que invitan a la interferencia política. El texto subraya que la credibilidad, una vez dañada, es difícil de reconstruir, y cita la presión de Trump sobre la Fed como el caso más visible."
EJEMPLO MAL (insight): "La decisión de la Fed tendrá un impacto significativo en la economía y los mercados. La institución debe equilibrar su mandato dual y será clave para tomar decisiones informadas."

WATCHLIST ITEMS — eventos concretos a vigilar que aparezcan o se infieran claramente de las noticias (con fecha si se conoce). Nunca genéricos como "la economía global".

context_md — 3 párrafos descriptivos y CONCRETOS (con nombres y hechos de las noticias de la semana): qué dominó la semana → qué dijeron los bancos centrales/funcionarios citados → panorama factual. Sin pronósticos, sin las frases prohibidas.

TODO el texto del JSON en ESPAÑOL. Output: solo JSON válido, sin texto adicional.`

  const prompt = `CATÁLOGO DE TICKERS DE LA PLATAFORMA (SOLO contexto, para que entiendas el universo de la plataforma; NO decides tú la relevancia de portafolio — eso se calcula de forma determinista aparte):
${tickerCatalog || tickers.join(', ')}

FOCO GEOGRÁFICO (regla de relevancia, clave): el lector es de EE.UU. y México. La relevancia de mercado se mide para esos mercados y para activos globales que los impacten.
- Relevancia PLENA: la Reserva Federal y datos macro de EE.UU. (inflación, empleo, PIB), gobierno/Congreso de EE.UU., empresas de EE.UU.; Banxico, peso y macro de México; y temas GLOBALES que mueven a EE.UU.: petróleo/commodities, geopolítica de alto impacto (Irán/Medio Oriente), grandes tecnológicas, tasas/treasuries de EE.UU.
- BAJA relevancia: decisiones de bancos centrales o política doméstica de OTROS países (p.ej. Sudáfrica, Corea del Sur, política interna europea aislada) cuyo impacto NO se transmita claramente a EE.UU./México según el propio artículo. En esos casos market_relevance y macro_impact deben ser BAJOS (≤2), aunque sean decisiones de tasas. NO las trates como señales fuertes solo por ser política monetaria; para este lector son de bajo interés.
- Si una noticia extranjera SÍ describe contagio claro a EE.UU./México (o a un activo global importante), puntúala según ese impacto real, no por el país de origen.

SCORING (0-5 cada uno): macro_impact, surprise_factor, market_relevance, forward_implications, structural_vs_noise; más time_decay (0 si <=2 días, -1 si 3-4, -2 si 5-7) y portfolio_relevance (SOLO informativo y orientativo: 5=toca un ticker del catálogo directamente, 3=universo amplio, 0=ninguno).
IMPORTANTE: la importancia de la noticia NO depende del portafolio. TOTAL = macro_impact + surprise_factor + market_relevance + forward_implications + structural_vs_noise + time_decay (máx 25; portfolio_relevance NO suma al total).
RATING: A=19-25, B=15-18, C=11-14, D<11. SIGNAL: STRONG si TOTAL>=19; MODERATE si 15-18; WEAK si <15. ACTIONABILITY (solo A/B): MONITOR|REVIEW|CONFIRMS|CONTRADICTS.

CALIBRACIÓN (ejemplos de referencia para anclar el rubric y reducir varianza):
- A (≈22): La Fed sube tasas 50 pb por sorpresa y revisa al alza la senda de inflación. macro=5, surprise=5, market_rel=5, forward=4, structural=3, time_decay=0 → cambio de régimen, fuerte reacción cross-asset.
- B (≈16): Dato de empleo de EE.UU. por encima del consenso pero dentro del rango esperado; reacción moderada en tasas. macro=4, surprise=3, market_rel=4, forward=3, structural=2, time_decay=0.
- C (≈12): Una empresa publica resultados en línea con lo esperado, sin guía nueva; impacto acotado al sector. macro=2, surprise=2, market_rel=3, forward=3, structural=2, time_decay=0.
- D (≈8): Resumen/explainer genérico de mercado sin dato nuevo ni evento. macro=2, surprise=1, market_rel=2, forward=2, structural=1, time_decay=0 → ruido.
- D/C bajo (≈7-9) por FOCO GEOGRÁFICO: un banco central extranjero sube tasas (p.ej. Sudáfrica +25 pb, o Corea del Sur con división hawkish) sin contagio claro a EE.UU./México descrito en el texto. macro=2, surprise=2, market_rel=1, forward=2, structural=2, time_decay=0 → bajo interés para este lector pese a ser decisión de tasas.

CORE EVENT TAG (clave para deduplicar — léelo con cuidado): por CADA artículo añade "core_event_tag", una etiqueta CANÓNICA de máximo 5 palabras que identifique el SUCESO BASE del que trata (NO el ángulo, NO la fuente, NO el enfoque editorial). Regla de oro: dos artículos que cubren el MISMO evento subyacente DEBEN llevar EXACTAMENTE el mismo core_event_tag, palabra por palabra, aunque sean de fuentes distintas o lo cuenten desde otro ángulo. Construye la etiqueta con sustantivos concretos en este orden: [institución/empresa/persona] + [acción/evento] (+ [detalle distintivo solo si hace falta). Sin artículos, sin verbos conjugados, sin relleno, sin la fuente. Si un artículo es ÚNICO (nadie más cubre ese suceso), igual ponle su etiqueta; NUNCA la dejes vacía.
Ejemplos de etiquetas canónicas: "Decision tasas Fed Warsh", "Resultados trimestrales Nvidia", "Banxico recorte tasas", "Aranceles EEUU China", "Empleo no agricola EEUU", "Acuerdo nuclear Iran". Ejemplo de agrupación: tres notas (Reuters, CNBC, AP) sobre la misma decisión de la Fed → las TRES llevan "Decision tasas Fed Warsh".

OUTPUT JSON SCHEMA:
{
  "articles": [{
    "rank": 1, "title": "Título en español", "date": "YYYY-MM-DD",
    "source_name": "wsj.com", "source_url": "https://...",
    "core_event_tag": "Decision tasas Fed Warsh",
    "summary": "1 párrafo 3-4 oraciones: qué pasó (hechos/datos del artículo) + contexto. Descriptivo, sin pronóstico ni cifras inventadas",
    "insight": "1 párrafo 2-3 oraciones: trasfondo y hacia dónde apunta el tema según el artículo, con detalles específicos. Sin llamadas de mercado ni datos inventados",
    "score": 24, "rating": "A", "signal": "STRONG", "actionability": "MONITOR",
    "score_breakdown": {"macro":5,"surprise":4,"market_rel":4,"forward":5,"structural":3,"portfolio":4,"time_decay":-1}
  }],
  "weekly_summary": {
    "strong_signals": 2, "moderate_signals": 3, "weak_noise": 1,
    "top_theme": "tema dominante concreto y factual",
    "key_risk": "riesgo principal concreto descrito en las noticias",
    "context_md": "párrafo1\\n\\npárrafo2\\n\\npárrafo3",
    "editorial_stance": "síntesis neutral del panorama, sin recomendaciones",
    "watchlist_items": [
      {"priority": "Alta", "item": "evento/dato concreto a vigilar"},
      {"priority": "Media", "item": "evento de seguimiento concreto"},
      {"priority": "Baja", "item": "evento de fondo concreto"}
    ]
  }
}

Analiza TODOS los artículos proporcionados, ordenados por importancia. Cada summary e insight ÚNICO y específico; cero frases prohibidas. Cada artículo DEBE traer su core_event_tag (mismo tag literal para notas del mismo suceso). Devuelve SOLO el JSON.

ARTÍCULOS:
${articleBlocks}`

  // callLLM recorre la cadena de proveedores (Gemini → Groq → Cerebras) con reintentos/backoff
  // internos ante errores transitorios (429/503/timeout). Aquí solo reintentamos si el PARSEO de
  // JSON falla (output sucio): hasta 2 pasadas, bajando temperatura. maxTokens amplio: Gemini (1M
  // contexto) elimina el truncamiento que degradaba el análisis con el free tier de Groq.
  let result: PipelineResult | null = null
  let lastErr: unknown
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      const response = await callLLM({
        role: 'analysis',
        prompt,
        system: systemPrompt,
        temperature: attempt === 0 ? 0.4 : 0.3,
        maxTokens: 8000,
      })
      result = extractJson<PipelineResult>(response)
    } catch (e) {
      lastErr = e
    }
  }

  // Resiliencia de tipado: el LLM puede omitir o ensuciar core_event_tag. Garantizamos que SIEMPRE
  // sea string (el contrato de AnalyzedArticle) — '' si no lo devolvió; la dedup tratará '' como único.
  if (result?.articles) {
    for (const a of result.articles) {
      a.core_event_tag = typeof a.core_event_tag === 'string' ? a.core_event_tag.trim() : ''
    }
  }

  // No guardes un brief vacío: si hubo artículos de entrada pero el modelo no devolvió ninguno,
  // falla la corrida (la ruta la marca 'failed' y el siguiente cron reintenta) en vez de mostrar vacío.
  if (!result) {
    throw new Error(`El análisis LLM falló tras reintentos: ${String(lastErr)}`)
  }
  if (!result.articles || result.articles.length === 0) {
    if (articles.length > 0) {
      throw new Error('El análisis devolvió 0 artículos pese a tener entrada; se reintentará')
    }
  }
  return result!
}

// ── Orquestación (fuente única) ──────────────────────────────
// Toda la orquestación del brief vive aquí para que el route HTTP y el runner
// standalone de GitHub Actions compartan exactamente la misma lógica.

// Sanea la fecha del LLM: solo acepta YYYY-MM-DD (al inicio); cualquier otra cosa
// ("unknown", "May 28", "2026-05", "") → null. Una fecha basura rompe el INSERT
// atómico de timestamptz y tumba TODO el lote (brief sin noticias).
function toValidDate(d: string | null | undefined): string | null {
  if (!d || typeof d !== 'string') return null
  const m = d.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : null
}

function computeValidUntil(): Date {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun, 1=Mon, 5=Fri

  const next = new Date(now)
  next.setUTCHours(13, 0, 0, 0)

  if (day === 1) {
    // Monday → valid until next Friday 13:00 UTC
    next.setUTCDate(now.getUTCDate() + 4)
  } else if (day === 5) {
    // Friday → valid until next Monday 13:00 UTC
    next.setUTCDate(now.getUTCDate() + 3)
  } else {
    // Manual run → valid until tomorrow 13:00 UTC
    next.setUTCDate(now.getUTCDate() + 1)
  }

  return next
}

export type RunNewsPipelineResult =
  | { success: true; briefId: string; articles: number }
  | { skipped: true; reason: string }

// Genera (o salta) el brief semanal. Lanza si el INSERT inicial falla o si el
// pipeline revienta tras crear el brief (el caller decide cómo reportar el error).
export async function runNewsPipeline(supabaseAdmin: SupabaseClient): Promise<RunNewsPipelineResult> {
  const nowIso = new Date().toISOString()
  // Un run que excede el límite de tiempo deja la fila en 'generating' para siempre y bloquea
  // todos los crons futuros. Tratamos como abandonado cualquier 'generating' de hace >15 min.
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()

  console.log(`[news-cron] runNewsPipeline invoked at ${nowIso}`)

  // Auto-recuperación: marca 'failed' los 'generating' abandonados para que dejen de bloquear.
  const { data: recovered } = await supabaseAdmin
    .from('market_briefs')
    .update({ status: 'failed', metadata: { error: 'abandoned: stuck in generating >15min' } })
    .eq('status', 'generating')
    .lt('created_at', fifteenMinAgo)
    .select('id')
  if (recovered && recovered.length > 0) {
    console.log(`[news-cron] recovered ${recovered.length} abandoned 'generating' brief(s): ${recovered.map((r) => r.id).join(', ')}`)
  }

  // Anti-double-execution guard: bloquea solo si hay un 'generating' RECIENTE (<15 min)
  // o un 'ready' aún vigente (valid_until en el futuro).
  const { data: existing } = await supabaseAdmin
    .from('market_briefs')
    .select('id, status, valid_until, created_at')
    .or(`and(status.eq.generating,created_at.gt.${fifteenMinAgo}),and(status.eq.ready,valid_until.gt.${nowIso})`)
    .limit(1)

  if (existing && existing.length > 0) {
    const e = existing[0]
    const reason = e.status === 'generating'
      ? `Brief already generating (id=${e.id}, created_at=${e.created_at})`
      : `Brief still valid (id=${e.id}, valid_until=${e.valid_until})`
    console.log(`[news-cron] SKIP — ${reason}`)
    return { skipped: true, reason }
  }

  console.log('[news-cron] guard clear — proceeding to generate new brief')

  const now = new Date()
  const periodStart = new Date(now)
  periodStart.setUTCDate(now.getUTCDate() - 7)
  const validUntil = computeValidUntil()
  console.log(`[news-cron] new brief valid_until=${validUntil.toISOString()}`)

  const { data: brief, error: insertError } = await supabaseAdmin
    .from('market_briefs')
    .insert({
      status: 'generating',
      period_start: periodStart.toISOString().split('T')[0],
      period_end: now.toISOString().split('T')[0],
      valid_until: validUntil.toISOString(),
    })
    .select()
    .single()

  if (insertError || !brief) {
    throw new Error(insertError?.message ?? 'Insert failed')
  }

  try {
    // Fase A — enriquece (una vez, cacheado) los activos del universo que aún no tienen perfil.
    // Resiliente: cualquier fallo se loguea internamente y NO rompe el pipeline.
    await enrichAssetProfiles(supabaseAdmin)

    const tickers = await getTopTickers(supabaseAdmin)
    const tickerCatalog = await getTickerCatalog(supabaseAdmin, tickers)
    const rawArticles = await searchNews(tickers)

    // Universo (unión de todos los activos de cualquier watchlist, sin índices) para el matching.
    const universe: UniverseAsset[] = await loadUniverseAssets(supabaseAdmin)

    // Pre-ranking determinista: autoridad de fuente + recencia + Tavily + empujón si el snippet
    // ya cruza el portafolio (para que esas noticias no se caigan del set de candidatos).
    const relevantUrls = new Set(
      rawArticles
        .filter((a) => matchAffectedSymbols(`${a.title}\n${a.content}`, universe).length > 0)
        .map((a) => a.url)
    )
    const ranked = rankCandidates(rawArticles, relevantUrls)

    const topUrls = await selectTop7(ranked)
    const topArticles = ranked.filter((a) => topUrls.includes(a.url))
    const contentMap = await extractContent(topUrls)
    const result = await analyzeAndSynthesize(topArticles, contentMap, tickers, tickerCatalog)

    // Fase B — matching DETERMINISTA definitivo por noticia (sobre el cuerpo extraído completo).
    const rawByUrl = new Map(rawArticles.map((a) => [a.url, a]))
    const affectedByUrl = new Map<string, AffectedSymbol[]>()
    for (const article of result.articles) {
      const fullText = contentMap.get(article.source_url) ?? rawByUrl.get(article.source_url)?.content ?? ''
      affectedByUrl.set(article.source_url, matchAffectedSymbols(`${article.title}\n${fullText}`, universe))
    }

    // Conteo variable 5–7 + garantía de inclusión por portafolio (tope 7), calidad sobre cantidad.
    const finalArticles = selectFinalArticles(
      result.articles,
      (a) => (affectedByUrl.get(a.source_url)?.length ?? 0) > 0
    )

    const newsRows = finalArticles.map((article) => {
      const fullText = contentMap.get(article.source_url) ?? null
      const affected = affectedByUrl.get(article.source_url) ?? []
      return {
        brief_id: brief.id,
        rank: article.rank,
        title: article.title,
        summary: article.summary,
        insight: article.insight,
        full_text_md: fullText,
        source_url: article.source_url,
        source_name: article.source_name,
        // Fecha del LLM (la copia del prompt); si no la devolvió válida, cae a la fecha
        // determinista de Tavily (published_date) para que la fecha SIEMPRE salga cuando la haya.
        published_at: toValidDate(article.date) ?? toValidDate(rawByUrl.get(article.source_url)?.published_date),
        affected_tickers: affected.map((s) => s.ticker),
        affected_symbols: affected,
        relevance_source: affected.length
          ? affected.map((s) => `${s.ticker}:${s.source}`).join(', ')
          : null,
        source_authority: sourceAuthority(article.source_url),
        score: article.score,
        rating: article.rating,
        signal: article.signal,
        actionability: article.actionability ?? null,
        score_breakdown: article.score_breakdown,
      }
    })

    const { error: newsError } = await supabaseAdmin.from('market_news').insert(newsRows)
    // No marcar el brief 'ready' con conteos fantasma si el insert falló: lanza para que
    // el catch lo marque 'failed' con el error real (antes fallaba en silencio → brief vacío).
    if (newsError) {
      throw new Error(`Insert de market_news falló (${newsRows.length} filas): ${newsError.message}`)
    }

    // Recalcula los conteos de señal desde los artículos REALMENTE incluidos (consistencia con la UI).
    const strong = finalArticles.filter((a) => a.signal === 'STRONG').length
    const moderate = finalArticles.filter((a) => a.signal === 'MODERATE').length
    const weak = finalArticles.filter((a) => a.signal === 'WEAK').length

    await supabaseAdmin
      .from('market_briefs')
      .update({
        status: 'ready',
        context_md: result.weekly_summary.context_md,
        strong_signals: strong,
        moderate_signals: moderate,
        weak_noise: weak,
        top_theme: result.weekly_summary.top_theme,
        key_risk: result.weekly_summary.key_risk,
        metadata: {
          editorial_stance: result.weekly_summary.editorial_stance ?? null,
          watchlist_items: result.weekly_summary.watchlist_items ?? [],
        },
      })
      .eq('id', brief.id)

    console.log(`[news-cron] SUCCESS — brief ${brief.id} ready (${finalArticles.length} articles)`)
    return { success: true, briefId: brief.id, articles: finalArticles.length }
  } catch (error) {
    console.error(`[news-cron] FAILED — brief ${brief.id}:`, error)
    await supabaseAdmin
      .from('market_briefs')
      .update({ status: 'failed', metadata: { error: String(error) } })
      .eq('id', brief.id)
    throw error
  }
}
