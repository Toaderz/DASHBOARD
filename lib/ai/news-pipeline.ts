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

async function callOllama(prompt: string, temperature = 0.1, systemPrompt?: string): Promise<string> {
  const baseUrl = process.env.OLLAMA_API_URL!
  const apiKey = process.env.OLLAMA_API_KEY
  const model = process.env.OLLAMA_MODEL ?? 'deepseek-r1:14b'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const messages: Array<{ role: string; content: string }> = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: false,
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

// ── Function B ───────────────────────────────────────────────

export async function searchNews(tickers: string[]): Promise<RawArticle[]> {
  const client = getTavilyClient()
  const topTickers = tickers.slice(0, 20).join(' OR ')

  const queries = [
    { query: 'global markets macro economic outlook this week', topic: 'finance' as const, days: 7, max_results: 10 },
    { query: 'central banks interest rates inflation monetary policy', topic: 'finance' as const, days: 7, max_results: 8 },
    { query: 'geopolitical risk trade tariffs market impact', topic: 'news' as const, days: 7, max_results: 8 },
    { query: `${topTickers} earnings revenue guidance market news`, topic: 'finance' as const, days: 7, max_results: 8 },
    { query: 'technology AI sector market institutional investors outlook', topic: 'finance' as const, days: 7, max_results: 6 },
  ]

  const results = await Promise.allSettled(
    queries.map((q) =>
      client.search(q.query, {
        topic: q.topic,
        days: q.days,
        maxResults: q.max_results,
        timeRange: 'week',
        includeAnswer: false,
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

export async function selectTop7(articles: RawArticle[]): Promise<string[]> {
  const articleList = articles
    .map((a, i) => `${i + 1}. [${a.title}] ${a.url}\nSnippet: ${a.content.slice(0, 200)}`)
    .join('\n\n')

  const prompt = `You are a financial news curator. Select the 7 most important articles from the list below.

Priority order: macro/geopolitical events > central bank decisions > commodity moves > sector-specific (only if market-moving).

DIVERSITY REQUIREMENT: Cover at least 4 of these themes: (1) macro/global growth, (2) monetary policy/rates, (3) geopolitics/trade, (4) specific sectors or assets, (5) commodities/FX.

Return ONLY a JSON array of up to 7 URLs in order of importance. No other text.

Example: ["https://...", "https://..."]

ARTICLES:
${articleList}`

  const response = await callOllama(prompt, 0.1)
  const urls = extractJson<string[]>(response)
  return urls.filter((u) => articles.some((a) => a.url === u)).slice(0, 7)
}

// ── Function D ───────────────────────────────────────────────

const EXTRACTION_PROMPT =
  'Extract ONLY the main news article body. Return clean markdown with paragraphs and ' +
  'any genuinely relevant inline images preserved as markdown image syntax. EXCLUDE: navigation, ' +
  'stock-ticker rails, "skip to", "what to read next", related-article lists, subscriber/paywall ' +
  'notices, copyright/legal lines and Dow Jones hashes, newsletter sign-ups, social share links, ' +
  'cookie/consent banners, ads, and chart/widget text dumps (e.g. "Created with Highcharts"). ' +
  'Exclude logos, icons, avatars and tracking pixels from images; keep only the hero photo and ' +
  'content figures.'

interface ExtractedJson {
  body_markdown?: string
  hero_image_url?: string
}

// Reject the scrape promise if Firecrawl takes longer than `ms` (stealth + AI extraction is slow).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('scrape timeout')), ms)),
  ])
}

// Build the final clean markdown stored in `full_text_md`: hero image (if any) + article body.
function buildCleanMarkdown(json: ExtractedJson): string | null {
  const body = (json.body_markdown ?? '').trim()
  if (!body) return null
  const hero = json.hero_image_url?.trim()
  if (hero && !body.includes(hero)) {
    return `![](${hero})\n\n${body}`
  }
  return body
}

export async function extractContent(urls: string[]): Promise<Map<string, string>> {
  const client = getFirecrawlClient()
  const contentMap = new Map<string, string>()

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        // Primary: Firecrawl server-side AI extraction (clean article + hero image), with
        // paywall bypass via `proxy: 'auto'` (escalates to stealth only when the site blocks).
        const result = await withTimeout(
          client.scrape(url, {
            formats: [{
              type: 'json',
              prompt: EXTRACTION_PROMPT,
              schema: {
                type: 'object',
                properties: {
                  body_markdown: { type: 'string' },
                  hero_image_url: { type: 'string' },
                },
                required: ['body_markdown'],
              },
            }],
            onlyMainContent: true,
            blockAds: true,
            proxy: 'auto',
            removeBase64Images: true,
          }),
          55_000
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
        // Fallback: plain markdown scrape (better than nothing if AI extraction fails/empties).
        const result = await withTimeout(
          client.scrape(url, {
            formats: ['markdown'],
            onlyMainContent: true,
            blockAds: true,
            proxy: 'auto',
          }),
          45_000
        )
        if (result.markdown?.trim()) {
          contentMap.set(url, result.markdown.trim())
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
  tickers: string[]
): Promise<PipelineResult> {
  const articleBlocks = articles.map((a, i) => {
    const fullText = contentMap.get(a.url) ?? a.content
    return `--- ARTICLE ${i + 1} ---
URL: ${a.url}
Title: ${a.title}
Source: ${a.source ?? 'unknown'}
Date: ${a.published_date ?? 'unknown'}
Content:
${fullText.slice(0, 1200)}`
  }).join('\n\n')

  const systemPrompt = `Eres un motor de análisis macroeconómico tipo Bloomberg Terminal. Extraes hechos duros, datos numéricos e inercias del mercado. Produces JSON estructurado en español.

PROHIBICIÓN ABSOLUTA: No uses "inversores", "carteras", "deben", "deberían", "hay que estar atentos", "es importante", "se recomienda", "puede impactar", "afectar a los mercados en general". Cero relleno. Cero consejos. Cero generalidades.

FORMATO OBLIGATORIO para el campo "insight" — exactamente 2 oraciones:
Oración 1: Hecho concreto con número, entidad y fecha exacta.
Oración 2: Implicación directa en clase de activo, sector o tasa específica con datos o niveles.

EJEMPLO PERFECTO:
{"insight": "El BCE situó la tasa de depósito en 3.25% en junio, por encima del consenso de 3.0%, ante una inflación subyacente del 2.9% en la eurozona. Los Bunds a 10 años cedieron 15 bps en la sesión y el EUR/USD retrocedió 0.8%, reflejando retraso en expectativas de recorte."}

EJEMPLO PROHIBIDO:
{"insight": "El BCE tomó una decisión importante. Los inversores deben estar atentos a cómo esto impactará a los mercados financieros y a sus carteras la próxima semana."}

WATCHLIST ITEMS — ultra-específicos, nunca genéricos:
BIEN: "ISM Manufacturero EE.UU. lunes — prev. 49.2", "Datos PCE subyacente viernes — consenso 2.6%", "Vencimiento mensual opciones VIX miércoles"
MAL: "La economía global", "Los mercados financieros", "La inflación en general"

CAMPO summary — 3 partes obligatorias, sin relleno:
1. QUÉ PASÓ: Evento específico con números, institución y fecha
2. POR QUÉ IMPORTA MACRO: Transmisión a tasas, inflación o crecimiento
3. IMPLICACIÓN CROSS-ASSET: Clases de activo, sectores o geografías afectadas con datos

context_md — 3 párrafos: catalizador de la semana → implicaciones Fed/BCE/tasas → sentimiento risk-on/off con datos concretos.

TODO el texto del JSON en ESPAÑOL. Output: solo JSON válido, sin texto adicional.`

  const prompt = `UNIVERSO DE INVERSIÓN (para scoring):
Tickers plataforma: ${tickers.slice(0, 30).join(', ')}
Exposición: S&P 500, NASDAQ, MSCI ACWI, globales. Temas: tech/IA, tasas/duración, geopolítica/aranceles, commodities, FX, emergentes.

SCORING (0-5 cada dimensión):
macro_impact: 0=local, 3=regional, 5=cambio macro global
surprise_factor: 0=descontado, 3=sorpresa parcial, 5=desviación vs consenso
market_relevance: 0=sin reacción, 3=moderada, 5=fuerte cross-asset
forward_implications: 0=sin cambio, 3=revisión menor, 5=cambia el caso base
structural_vs_noise: 0=ruido, 3=señal mixta, 5=cambio de régimen
portfolio_relevance: 5=ticker directo, 4=sectorial fuerte, 3=universo amplio, 2=indirecto, 1=lejano, 0=ninguno
time_decay: 0 si <=2 días, -1 si 3-4 días, -2 si 5-7 días. EXCLUIR artículos >7 días.
TOTAL = suma (máx 30). RATING: A=22-30, B=18-21, C=14-17, D<14
SIGNAL: STRONG si score>=22 Y portfolio>=4; MODERATE si 18-21 O portfolio 3-4; WEAK otro caso
ACTIONABILITY (solo A/B): MONITOR | REVIEW | CONFIRMS | CONTRADICTS

OUTPUT JSON SCHEMA:
{
  "articles": [{
    "rank": 1, "title": "Título en español", "date": "YYYY-MM-DD",
    "source_name": "wsj.com", "source_url": "https://...",
    "summary": "3 partes: qué pasó / por qué importa macro / implicación cross-asset",
    "insight": "2 oraciones exactas: hecho con número → implicación en activo específico",
    "score": 24, "rating": "A", "signal": "STRONG", "actionability": "MONITOR",
    "score_breakdown": {"macro":5,"surprise":4,"market_rel":4,"forward":5,"structural":3,"portfolio":4,"time_decay":-1},
    "affected_tickers": ["QQQ","AAPL"]
  }],
  "weekly_summary": {
    "strong_signals": 2, "moderate_signals": 3, "weak_noise": 1,
    "top_theme": "tema dominante de la semana en español",
    "key_risk": "riesgo principal concreto con datos en español",
    "context_md": "párrafo1: catalizador\\n\\npárrafo2: implicaciones tasas/BC\\n\\npárrafo3: sentimiento con posicionamiento",
    "editorial_stance": "posicionamiento editorial con convicción en español",
    "watchlist_items": [
      {"priority": "Alta", "item": "dato/evento específico con fecha y nivel previo"},
      {"priority": "Alta", "item": "segundo evento de alta prioridad específico"},
      {"priority": "Media", "item": "evento de seguimiento con contexto numérico"},
      {"priority": "Media", "item": "segundo evento de seguimiento"},
      {"priority": "Baja", "item": "evento de fondo específico"},
      {"priority": "Baja", "item": "segundo evento de fondo"}
    ]
  }
}

Incluir MÍNIMO 5 artículos rating A/B (máximo 7). Artículos C/D solo si hay menos de 5 con A/B.

ARTÍCULOS:
${articleBlocks}`

  const response = await callOllama(prompt, 0.1, systemPrompt)
  return extractJson<PipelineResult>(response)
}
