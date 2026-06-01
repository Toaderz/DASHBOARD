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

async function callOllama(prompt: string, temperature = 0.1): Promise<string> {
  const baseUrl = process.env.OLLAMA_API_URL!
  const apiKey = process.env.OLLAMA_API_KEY
  const model = process.env.OLLAMA_MODEL ?? 'deepseek-r1:14b'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
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

function extractJson<T>(text: string): T {
  const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  const raw = match ? match[1] ?? match[0] : text.trim()
  return JSON.parse(raw) as T
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
    queries.map((q) => client.search(q.query, { topic: q.topic, days: q.days, maxResults: q.max_results }))
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

  const prompt = `You are a financial news curator. Select the 10 most important articles from the list below.

Priority order: macro/geopolitical events > central bank decisions > commodity moves > sector-specific (only if market-moving).

DIVERSITY REQUIREMENT: Your selection must cover at least 4 of these themes: (1) macro/global growth, (2) monetary policy/rates, (3) geopolitics/trade, (4) specific sectors or assets, (5) commodities/FX. Do not select 10 articles from the same theme.

CONTRADICTION VALUE: If two articles present opposing signals on the same asset (e.g. one bullish / one bearish on oil), include BOTH — contradictions reveal what the market is processing.

Return ONLY a JSON array of up to 10 URLs in order of importance. No other text.

Example: ["https://...", "https://..."]

ARTICLES:
${articleList}`

  const response = await callOllama(prompt, 0.1)
  const urls = extractJson<string[]>(response)
  return urls.filter((u) => articles.some((a) => a.url === u)).slice(0, 10)
}

// ── Function D ───────────────────────────────────────────────

export async function extractContent(urls: string[]): Promise<Map<string, string>> {
  const client = getFirecrawlClient()
  const contentMap = new Map<string, string>()

  await Promise.allSettled(
    urls.map(async (url) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      try {
        const result = await client.scrape(url, {
          formats: ['markdown'],
          onlyMainContent: true,
          excludeTags: [
            'nav', 'header', 'footer', 'aside', 'script', 'style',
            '.nav', '.navigation', '.header', '.footer', '.sidebar',
            '.cookie-banner', '.cookie-notice', '.cookie-consent',
            '.paywall', '.subscription-wall', '.subscription-prompt',
            '.related-articles', '.recommended', '.what-to-read',
            '.advertisement', '.ad', '.promo', '.newsletter-signup',
            '.share-buttons', '.social-share', '.comments-section',
          ],
        })
        clearTimeout(timeout)
        if (result.markdown) {
          contentMap.set(url, result.markdown)
        }
      } catch {
        clearTimeout(timeout)
        // Leave empty — caller uses Tavily snippet as fallback
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
${fullText.slice(0, 3000)}`
  }).join('\n\n')

  const prompt = `Eres un analista financiero senior que redacta un market brief semanal en ESPAÑOL para gestores de carteras institucionales.

REGLA CRÍTICA: TODO EL TEXTO del JSON debe estar en ESPAÑOL. Ningún campo de texto en inglés es aceptable.

UNIVERSO DE INVERSIÓN (para scoring de relevancia):
- Tickers top de la plataforma: ${tickers.join(', ')}
- Exposición amplia: S&P 500, NASDAQ, MSCI ACWI, mercados globales
- Temas: tecnología/IA, duración/tasas, geopolítica/aranceles, commodities, FX, mercados emergentes

SISTEMA DE SCORING (aplicar a cada artículo):
- macro_impact (0-5): 0=evento local, 3=regional, 5=cambio macro global
- surprise_factor (0-5): 0=totalmente descontado, 3=sorpresa parcial, 5=desviación significativa del consenso
- market_relevance (0-5): 0=sin reacción, 3=reacción moderada, 5=reacción fuerte cross-asset
- forward_implications (0-5): 0=sin cambio, 3=revisión menor, 5=cambia el caso base
- structural_vs_noise (0-5): 0=ruido puro, 3=señal mixta, 5=cambio de régimen estructural
- portfolio_relevance (0-5): 5=ticker directo en cartera, 4=impacto sectorial fuerte, 3=universo amplio, 2=indirecto débil, 1=lejano, 0=ninguno
- time_decay: 0 si <=2 días, -1 si 3-4 días, -2 si 5-7 días (EXCLUIR completamente artículos con fecha >7 días — no incluirlos en el output)

TOTAL = suma de todas las dimensiones (máx 30)
RATING: A=22-30 | B=18-21 | C=14-17 | D<14
SIGNAL: STRONG si score>=22 Y portfolio>=4; MODERATE si score 18-21 O portfolio 3-4; WEAK en otro caso
ACTIONABILITY (solo A/B): MONITOR | REVIEW | CONFIRMS | CONTRADICTS

REQUERIMIENTOS DE CALIDAD — campos summary e insight:
- summary (8-10 oraciones estructuradas en 3 partes):
  1. QUÉ PASÓ: El evento específico con números concretos, institución y fecha
  2. POR QUÉ IMPORTA MACRO: Transmisión al mercado, implicación para tasas, inflación o crecimiento
  3. IMPLICACIÓN DE ACTIVOS: Clases de activo, sectores o geografías afectadas y cómo
- insight (1-2 párrafos): Nombra tickers/sectores específicos probablemente afectados. Lista datos económicos, discursos de bancos centrales o eventos de la próxima semana a monitorear. Incluye niveles técnicos relevantes si aplica. Señala si hay tensión o señales contradictorias entre artículos.

NARRATIVA DEL RESUMEN SEMANAL (context_md — 3 párrafos en español con arquitectura explícita):
- Párrafo 1 — CATALIZADOR: El evento o noticia que definió los movimientos de la semana. Qué pasó, cuándo, y cuál fue la reacción inmediata del mercado.
- Párrafo 2 — PERSPECTIVA MACRO: Implicaciones para política monetaria (Fed, BCE y otros bancos centrales), inflación y tasas. Incluir niveles de índices, expectativas de recortes/alzas, o movimientos de commodities si los artículos los mencionan.
- Párrafo 3 — SENTIMIENTO DE MERCADO: Posicionamiento actual (risk-on / risk-off / mixto). Explicar por qué coexisten sentimientos aparentemente contradictorios si los hay. Usar lenguaje de inversión profesional.

OUTPUT: Solo JSON válido. Sin texto adicional. Incluir MÍNIMO 5 artículos con rating A o B (máximo 7). Incluir artículos C y D solo si hay menos de 5 con rating A/B. Todos los campos de texto en ESPAÑOL.

JSON SCHEMA:
{
  "articles": [
    {
      "rank": 1,
      "title": "Título en español (traducir si el original está en inglés)",
      "date": "YYYY-MM-DD",
      "source_name": "wsj.com",
      "source_url": "https://...",
      "summary": "8-10 oraciones en español con estructura: qué pasó / por qué importa macro / implicación de activos",
      "insight": "1-2 párrafos en español: tickers/sectores afectados, agenda de seguimiento para la semana, niveles a monitorear",
      "score": 24,
      "rating": "A",
      "signal": "STRONG",
      "actionability": "MONITOR",
      "score_breakdown": {"macro":5,"surprise":4,"market_rel":4,"forward":5,"structural":3,"portfolio":4,"time_decay":-1},
      "affected_tickers": ["QQQ","AAPL"]
    }
  ],
  "weekly_summary": {
    "strong_signals": 2,
    "moderate_signals": 3,
    "weak_noise": 1,
    "top_theme": "frase en español sobre el tema dominante de la semana",
    "key_risk": "frase en español sobre el riesgo principal para las carteras",
    "context_md": "3 párrafos en español con estructura: catalizador → perspectiva macro → sentimiento de mercado",
    "editorial_stance": "párrafo en español con posicionamiento editorial propio — visión del mercado con convicción ('Mantenemos una visión X con énfasis en Y'). No solo descripción, sino recomendación de postura para gestores de cartera.",
    "watchlist_items": [
      {"priority": "Alta", "item": "descripción del dato/evento/nivel crítico a vigilar esta semana"},
      {"priority": "Alta", "item": "segundo evento de alta prioridad"},
      {"priority": "Media", "item": "evento de seguimiento moderado"},
      {"priority": "Media", "item": "segundo evento de seguimiento"},
      {"priority": "Baja", "item": "evento de contexto o seguimiento de fondo"},
      {"priority": "Baja", "item": "segundo evento de contexto"}
    ]
  }
}

ARTÍCULOS A ANALIZAR:
${articleBlocks}`

  const response = await callOllama(prompt, 0.1)
  return extractJson<PipelineResult>(response)
}
