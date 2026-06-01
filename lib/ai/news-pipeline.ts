import { tavily } from '@tavily/core'
import Firecrawl from 'firecrawl'
import type { SupabaseClient } from '@supabase/supabase-js'
import { callLLM, extractJson } from './llm'
import { sourceAuthority } from './source-authority'

// ── Types ────────────────────────────────────────────────────

export interface RawArticle {
  url: string
  title: string
  content: string  // snippet from Tavily
  score: number
  published_date?: string
  source?: string
}

export interface AnalyzedArticle {
  rank: number
  title: string
  date: string
  source_name: string
  source_url: string
  summary: string
  insight: string
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

function getFirecrawlClient() {
  return new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })
}

// ── Function A ───────────────────────────────────────────────

export async function getTopTickers(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_top_tickers')

  // Fallback: manual query if RPC not defined
  if (error) {
    const { data: rows } = await supabase
      .from('watchlist_assets')
      .select('asset_ticker')
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

  const queries = [
    { query: 'global markets macro economic outlook this week', topic: 'finance' as const, days: 7, max_results: 12 },
    { query: 'central banks interest rates inflation monetary policy', topic: 'finance' as const, days: 7, max_results: 10 },
    { query: 'geopolitical risk trade tariffs market impact', topic: 'news' as const, days: 7, max_results: 10 },
    { query: `${topTickers} earnings revenue guidance market news`, topic: 'finance' as const, days: 7, max_results: 10 },
    { query: 'technology AI sector market institutional investors outlook', topic: 'finance' as const, days: 7, max_results: 8 },
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

  for (const result of results) {
    if (result.status === 'rejected') continue
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
      })
    }
  }

  return articles.sort((a, b) => b.score - a.score).slice(0, 25)
}

// ── Pre-ranking determinista ─────────────────────────────────

// Cuántos candidatos pasan a extracción/análisis (cota superior; el conteo FINAL del brief
// lo decide la calidad: 3 a 7, ver selectFinalArticles).
const MAX_CANDIDATES = 7

// Recencia 0..1 (hoy = 1, ~0 a los 10 días). Penaliza noticias viejas sin descartarlas.
function recencyScore(publishedDate?: string): number {
  if (!publishedDate) return 0.5
  const pub = new Date(publishedDate)
  if (isNaN(pub.getTime())) return 0.5
  const days = (Date.now() - pub.getTime()) / 86_400_000
  return Math.max(0, Math.min(1, 1 - days / 10))
}

// Ordena candidatos por una señal compuesta y determinista ANTES del LLM:
// relevancia de búsqueda (Tavily) + autoridad de fuente + recencia + un empujón si toca
// el portafolio (para que esas noticias no se caigan del set de candidatos). Devuelve el top.
// `relevantUrls`: URLs que cruzan el universo (matching preliminar por snippet, hecho por el caller).
export function rankCandidates(
  articles: RawArticle[],
  relevantUrls?: Set<string>,
  limit = 14
): RawArticle[] {
  const composite = (a: RawArticle): number => {
    const tavily = Math.max(0, Math.min(1, a.score))
    const authority = sourceAuthority(a.source ?? a.url)
    const recency = recencyScore(a.published_date)
    const portfolio = relevantUrls?.has(a.url) ? 1 : 0
    return 0.4 * tavily + 0.3 * authority + 0.2 * recency + 0.1 * portfolio
  }
  return [...articles]
    .map((a) => ({ a, c: composite(a) }))
    .sort((x, y) => y.c - x.c)
    .slice(0, limit)
    .map((x) => x.a)
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

  const prompt = `Eres un editor de mercados. De la lista, elige hasta ${TARGET} noticias MÁS IMPORTANTES por su impacto de mercado real (puedes elegir menos si no hay tantas que valgan la pena).

PRIORIZA: decisiones de bancos centrales y tasas de interés, datos macro (inflación, empleo, PIB), declaraciones del gobierno de EE.UU., geopolítica de alto impacto (p.ej. Irán), movimientos corporativos relevantes.
DESCARTA: páginas índice de titulares, columnas tipo "Market Talk", "what to watch", live blogs, listicles ("top/bottom performers"), guías genéricas — salvo que sean claramente market-moving.
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

// ── Selección final del brief (conteo variable 3–7 + garantía de inclusión) ──

export interface SelectableArticle {
  source_url: string
  score: number
  rating: 'A' | 'B' | 'C' | 'D'
}

// Decide qué artículos ENTRAN al brief tras el análisis. Reglas:
// - Núcleo de calidad: ratings A/B (STRONG/MODERATE), ordenados por score.
// - Conteo variable 3–7: si el núcleo es <3, rellena con los mejores siguientes; nunca >7.
// - Garantía de inclusión: una noticia que TOCA el portafolio y supera el mínimo (score>=11, C+)
//   entra aunque no sea top macro, SUSTITUYENDO a la de menor importancia NO relevante del set,
//   priorizando entre las garantizadas las de mayor score. Nunca excede el tope de 7.
export function selectFinalArticles<T extends SelectableArticle>(
  articles: T[],
  isRelevant: (a: T) => boolean,
  min = 3,
  max = 7
): T[] {
  if (!articles.length) return []
  const byScore = (a: T, b: T) => b.score - a.score
  const sorted = [...articles].sort(byScore)

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

interface ExtractedJson {
  body_markdown?: string
}

// Reject the scrape promise if Firecrawl takes longer than `ms` (stealth + AI extraction is slow).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('scrape timeout')), ms)),
  ])
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)/g

// Deterministic backstop: drop logo / icon / avatar / agency-credit / tracking images.
// Keeps content photos and charts/graphs (what the user wants).
function isJunkImage(alt: string, url: string): boolean {
  const a = alt.trim().toLowerCase()
  const u = url.replace(/^<|>$/g, '').trim().toLowerCase()
  if (!u || u.startsWith('data:')) return true
  // Alt is exactly a news-agency wordmark → it's a credit logo, not a content photo.
  if (/^(reuters|getty|getty images|associated press|ap|ap photo|bloomberg|afp|epa|shutterstock|istock|alamy|nurphoto|via getty images)$/.test(a)) return true
  if (/\b(logo|icon|favicon|avatar|sprite|spacer|pixel|placeholder|watermark|wordmark|badge|headshot)\b/.test(a)) return true
  if (/logo|favicon|sprite|\/icons?\/|avatar|placeholder|spacer|1x1|tracking|beacon|\.svg(\?|$)/.test(u)) return true
  return false
}

// Remove junk images from the markdown but keep content photos/charts in place.
function filterImages(md: string): string {
  return md.replace(MD_IMAGE_RE, (full, alt: string, url: string) => (isJunkImage(alt, url) ? '' : full))
}

// Drop a leading H1 (the article title is shown separately in the modal header).
function stripLeadingH1(md: string): string {
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i < lines.length && /^#\s+\S/.test(lines[i].trim())) lines.splice(i, 1)
  return lines.join('\n')
}

// Build the final clean markdown stored in `full_text_md`.
function buildCleanMarkdown(json: ExtractedJson): string | null {
  let md = (json.body_markdown ?? '').trim()
  if (!md) return null
  md = stripLeadingH1(md)
  md = filterImages(md)
  md = md.replace(/\n{3,}/g, '\n\n').trim()
  // Require some actual prose, not just leftover image/whitespace.
  const textOnly = md.replace(MD_IMAGE_RE, '').replace(/[#>*_`-]/g, '').trim()
  return textOnly.length >= 80 ? md : null
}

export async function extractContent(urls: string[]): Promise<Map<string, string>> {
  const client = getFirecrawlClient()
  const contentMap = new Map<string, string>()

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        // Primary: Firecrawl server-side AI extraction. Las fuentes son de acceso abierto,
        // así que `proxy: 'auto'` (sólo escala si el sitio bloquea) ahorra créditos vs stealth.
        const result = await withTimeout(
          client.scrape(url, {
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
          }),
          70_000
        )

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
        const result = await withTimeout(
          client.scrape(url, {
            formats: ['markdown'],
            onlyMainContent: true,
            blockAds: true,
            proxy: 'auto',
            removeBase64Images: true,
          }),
          60_000
        )
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

SCORING (0-5 cada uno): macro_impact, surprise_factor, market_relevance, forward_implications, structural_vs_noise; más time_decay (0 si <=2 días, -1 si 3-4, -2 si 5-7) y portfolio_relevance (SOLO informativo y orientativo: 5=toca un ticker del catálogo directamente, 3=universo amplio, 0=ninguno).
IMPORTANTE: la importancia de la noticia NO depende del portafolio. TOTAL = macro_impact + surprise_factor + market_relevance + forward_implications + structural_vs_noise + time_decay (máx 25; portfolio_relevance NO suma al total).
RATING: A=19-25, B=15-18, C=11-14, D<11. SIGNAL: STRONG si TOTAL>=19; MODERATE si 15-18; WEAK si <15. ACTIONABILITY (solo A/B): MONITOR|REVIEW|CONFIRMS|CONTRADICTS.

CALIBRACIÓN (ejemplos de referencia para anclar el rubric y reducir varianza):
- A (≈22): La Fed sube tasas 50 pb por sorpresa y revisa al alza la senda de inflación. macro=5, surprise=5, market_rel=5, forward=4, structural=3, time_decay=0 → cambio de régimen, fuerte reacción cross-asset.
- B (≈16): Dato de empleo de EE.UU. por encima del consenso pero dentro del rango esperado; reacción moderada en tasas. macro=4, surprise=3, market_rel=4, forward=3, structural=2, time_decay=0.
- C (≈12): Una empresa publica resultados en línea con lo esperado, sin guía nueva; impacto acotado al sector. macro=2, surprise=2, market_rel=3, forward=3, structural=2, time_decay=0.
- D (≈8): Resumen/explainer genérico de mercado sin dato nuevo ni evento. macro=2, surprise=1, market_rel=2, forward=2, structural=1, time_decay=0 → ruido.

OUTPUT JSON SCHEMA:
{
  "articles": [{
    "rank": 1, "title": "Título en español", "date": "YYYY-MM-DD",
    "source_name": "wsj.com", "source_url": "https://...",
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

Analiza TODOS los artículos proporcionados (hasta 7), ordenados por importancia. Cada summary e insight ÚNICO y específico; cero frases prohibidas. Devuelve SOLO el JSON.

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
