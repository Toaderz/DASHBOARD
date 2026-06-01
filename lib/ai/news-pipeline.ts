import { tavily } from '@tavily/core'
import Firecrawl from 'firecrawl'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  affected_tickers: string[]
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

// Modelo para el análisis/síntesis (mejor seguimiento de instrucciones, sin relleno).
// Distinto al de selección (selectTop7) a propósito: Groq aplica el límite de tokens/min
// POR MODELO, así que usar modelos distintos evita que ambas llamadas compitan por el mismo cupo.
const ANALYSIS_MODEL = process.env.NEWS_ANALYSIS_MODEL ?? 'openai/gpt-oss-120b'

async function callOllama(
  prompt: string,
  temperature = 0.1,
  systemPrompt?: string,
  model?: string,
  maxTokens?: number
): Promise<string> {
  const baseUrl = process.env.OLLAMA_API_URL!
  const apiKey = process.env.OLLAMA_API_KEY
  const resolvedModel = model ?? process.env.OLLAMA_MODEL ?? 'deepseek-r1:14b'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const messages: Array<{ role: string; content: string }> = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      temperature,
      stream: false,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${await response.text()}`)
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> }
  return data.choices[0].message.content
}

function sanitizeJsonString(raw: string): string {
  // Escape literal control characters inside JSON string values (common LLM output issue)
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\') { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
    }
    result += ch
  }
  // Remove trailing commas before } or ]
  return result.replace(/,(\s*[}\]])/g, '$1')
}

function extractJson<T>(text: string): T {
  const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  const raw = match ? match[1] ?? match[0] : text.trim()
  try {
    return JSON.parse(raw) as T
  } catch {
    return JSON.parse(sanitizeJsonString(raw)) as T
  }
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

// Catálogo descriptivo (ticker — nombre [sector/industria]) para que el LLM sepa QUÉ es
// cada ticker y solo asigne affected_tickers cuando hay relación real (no temática vaga).
export async function getTickerCatalog(supabase: SupabaseClient, tickers: string[]): Promise<string> {
  const top = tickers.slice(0, 25)
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
const NEWS_SOURCES = [
  'reuters.com', 'apnews.com',
  'bbc.com', 'theguardian.com',
  'cnbc.com', 'marketwatch.com',
]

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

// ── Function C ───────────────────────────────────────────────

// Selección determinista (sin LLM): top por score de relevancia de Tavily, con un máximo
// de 2 artículos por dominio para forzar diversidad de fuentes. El scoring/redacción real lo
// hace analyzeAndSynthesize. Evita una llamada LLM (ahorra cupo y costo) y es reproducible.
export async function selectTop7(articles: RawArticle[]): Promise<string[]> {
  const TARGET = 5
  const MAX_PER_DOMAIN = 2
  const sorted = [...articles].sort((a, b) => b.score - a.score)

  const perDomain = new Map<string, number>()
  const picked: string[] = []
  for (const a of sorted) {
    const domain = a.source ?? a.url
    const count = perDomain.get(domain) ?? 0
    if (count >= MAX_PER_DOMAIN) continue
    perDomain.set(domain, count + 1)
    picked.push(a.url)
    if (picked.length >= TARGET) break
  }
  // Si el tope por dominio dejó menos de TARGET, completa por score.
  if (picked.length < TARGET) {
    for (const a of sorted) {
      if (!picked.includes(a.url)) {
        picked.push(a.url)
        if (picked.length >= TARGET) break
      }
    }
  }
  return picked
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
2. PROHIBIDO predecir o recomendar. Nada de llamadas de mercado ("los bonos subirán", "el dólar caerá"), consejos ni "los inversores deben/deberían".
3. CADA oración debe contener un detalle ESPECÍFICO de ESE artículo: un nombre propio, lugar, cifra, fecha o argumento concreto tomado del texto. Una oración que podría aplicar a cualquier noticia está PROHIBIDA y debe eliminarse.
4. PROHIBIDO repetir frases entre artículos. Cada resumen y cada análisis deben ser únicos y referirse a los detalles propios de su artículo.

FRASES PROHIBIDAS (no las uses nunca, ni variantes): "tendrá un impacto significativo en la economía y los mercados financieros", "serán clave para tomar decisiones informadas", "debe equilibrar su mandato dual", "es importante monitorear", "puede tener implicaciones en los mercados", "afecta a la economía en general", "es crucial para mantener la estabilidad", "navegar este escenario desafiante", "incertidumbre y volatilidad en los mercados".

CAMPO "summary" — 1 párrafo de 3 a 4 oraciones: QUÉ pasó con los hechos y datos concretos del artículo + el contexto necesario para entenderlo. Puramente descriptivo.

CAMPO "insight" (es el ANÁLISIS de contexto) — 1 párrafo de 2 a 3 oraciones: el TRASFONDO y HACIA DÓNDE APUNTA el tema según ESTE artículo: por qué surge, qué fuerzas o argumentos concretos están en juego, qué posturas o desenlaces describe el texto. Cita los detalles específicos del artículo (quién dijo qué, dónde, con qué dato). Das contexto para que el lector forme su propio juicio; NO des tú el juicio ni predigas niveles.

EJEMPLO BIEN (insight): "El recelo sobre la independencia del banco central resurge porque, según Helge Berger (FMI) en Dubrovnik, controlar la inflación obliga a medidas impopulares que invitan a la interferencia política. El texto subraya que la credibilidad, una vez dañada, es difícil de reconstruir, y cita la presión de Trump sobre la Fed como el caso más visible."
EJEMPLO MAL (insight): "La decisión de la Fed tendrá un impacto significativo en la economía y los mercados. La institución debe equilibrar su mandato dual y será clave para tomar decisiones informadas."

WATCHLIST ITEMS — eventos concretos a vigilar que aparezcan o se infieran claramente de las noticias (con fecha si se conoce). Nunca genéricos como "la economía global".

context_md — 3 párrafos descriptivos y CONCRETOS (con nombres y hechos de las noticias de la semana): qué dominó la semana → qué dijeron los bancos centrales/funcionarios citados → panorama factual. Sin pronósticos, sin las frases prohibidas.

TODO el texto del JSON en ESPAÑOL. Output: solo JSON válido, sin texto adicional.`

  const prompt = `CATÁLOGO DE TICKERS DE LA PLATAFORMA (usa SOLO estos para affected_tickers):
${tickerCatalog || tickers.slice(0, 25).join(', ')}

REGLA DE affected_tickers (estricta): incluye un ticker SOLO si el artículo menciona explícitamente esa empresa/activo, o si el sector/tema del ticker en el catálogo es el FOCO DIRECTO de la noticia. Si ninguno aplica directamente, devuelve []. PROHIBIDO asociaciones temáticas vagas — ejemplos de lo que NO se debe hacer: etiquetar un ETF de ciberseguridad para una noticia de chips de memoria; etiquetar un ETF de large caps de EE.UU. para una decisión de tasas de Corea; etiquetar un ETF de mid-cap growth para un récord del Dow. portfolio_relevance refleja esto: 0 si ningún ticker del catálogo está directamente afectado.

SCORING (0-5 cada uno): macro_impact, surprise_factor, market_relevance, forward_implications, structural_vs_noise, portfolio_relevance (5=ticker directo,3=universo amplio,0=ninguno), time_decay (0 si <=2 días, -1 si 3-4, -2 si 5-7).
TOTAL=suma (máx 30). RATING: A=22-30,B=18-21,C=14-17,D<14. SIGNAL: STRONG si score>=22 Y portfolio>=4; MODERATE si 18-21 O portfolio 3-4; WEAK otro. ACTIONABILITY (solo A/B): MONITOR|REVIEW|CONFIRMS|CONTRADICTS.

OUTPUT JSON SCHEMA:
{
  "articles": [{
    "rank": 1, "title": "Título en español", "date": "YYYY-MM-DD",
    "source_name": "wsj.com", "source_url": "https://...",
    "summary": "1 párrafo 3-4 oraciones: qué pasó (hechos/datos del artículo) + contexto. Descriptivo, sin pronóstico ni cifras inventadas",
    "insight": "1 párrafo 2-3 oraciones: trasfondo y hacia dónde apunta el tema según el artículo, con detalles específicos. Sin llamadas de mercado ni datos inventados",
    "score": 24, "rating": "A", "signal": "STRONG", "actionability": "MONITOR",
    "score_breakdown": {"macro":5,"surprise":4,"market_rel":4,"forward":5,"structural":3,"portfolio":4,"time_decay":-1},
    "affected_tickers": ["QQQ","AAPL"]
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

Analiza TODOS los artículos proporcionados (hasta 5), ordenados por importancia. Cada summary e insight ÚNICO y específico; cero frases prohibidas. Devuelve SOLO el JSON.

ARTÍCULOS:
${articleBlocks}`

  try {
    const response = await callOllama(prompt, 0.4, systemPrompt, ANALYSIS_MODEL, 4500)
    return extractJson<PipelineResult>(response)
  } catch {
    // Fallback: si gpt-oss excede el límite de tokens/min o trunca el JSON, reintenta con
    // el modelo por defecto (llama, mayor TPM y sin razonamiento) para no perder la corrida.
    const response = await callOllama(prompt, 0.3, systemPrompt)
    return extractJson<PipelineResult>(response)
  }
}
