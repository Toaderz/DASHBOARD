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
    { query: 'global markets macro economic news this week', topic: 'finance' as const, days: 7, max_results: 8 },
    { query: 'central banks interest rates inflation this week', topic: 'finance' as const, days: 7, max_results: 6 },
    { query: 'geopolitical risk trade market impact this week', topic: 'news' as const, days: 7, max_results: 5 },
    { query: `${topTickers} earnings news this week`, topic: 'finance' as const, days: 7, max_results: 6 },
  ]

  const results = await Promise.allSettled(
    queries.map((q) => client.search(q.query, { topic: q.topic, days: q.days, maxResults: q.max_results }))
  )

  const seen = new Set<string>()
  const articles: RawArticle[] = []
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 10)

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

  return articles.sort((a, b) => b.score - a.score).slice(0, 20)
}

// ── Function C ───────────────────────────────────────────────

export async function selectTop7(articles: RawArticle[]): Promise<string[]> {
  const articleList = articles
    .map((a, i) => `${i + 1}. [${a.title}] ${a.url}\nSnippet: ${a.content.slice(0, 200)}`)
    .join('\n\n')

  const prompt = `You are a financial news curator. Select the 7 most important articles from the list below.

Priority: macro/geopolitical events > central banks/commodities > company news (only if market-moving).

Return ONLY a JSON array of 7 URLs in order of importance. No other text.

Example: ["https://...", "https://..."]

ARTICLES:
${articleList}`

  const response = await callOllama(prompt, 0.1)
  const urls = extractJson<string[]>(response)
  return urls.filter((u) => articles.some((a) => a.url === u)).slice(0, 7)
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

  const prompt = `You are a senior financial analyst generating a weekly market brief.

INVESTMENT UNIVERSE (for portfolio relevance scoring):
- Top platform tickers: ${tickers.join(', ')}
- Broad exposure: S&P 500, NASDAQ, MSCI ACWI, global markets
- Themes: technology, rates/duration, geopolitics, commodities, FX, EM

SCORING SYSTEM (apply to each article):
- macro_impact (0-5): 0=local event, 3=regional, 5=global macro shift
- surprise_factor (0-5): 0=fully priced in, 3=partial surprise, 5=significant deviation from consensus
- market_relevance (0-5): 0=no reaction, 3=some reaction, 5=strong cross-asset reaction
- forward_implications (0-5): 0=no change, 3=minor revision, 5=changes base case
- structural_vs_noise (0-5): 0=pure noise, 3=mixed signal, 5=structural regime change
- portfolio_relevance (0-5): 5=direct ticker match, 4=strong sector impact, 3=broad universe, 2=weak indirect, 1=distant, 0=none
- time_decay: 0 if <=2 days old, -1 if 3-4 days, -2 if 5-7 days, -4 if >7 days (EXCLUDE articles >10 days old entirely)

TOTAL = sum of all dimensions (max 30)
RATING: A=22-30 | B=18-21 | C=14-17 | D<14
SIGNAL: STRONG if score>=22 AND portfolio>=4; MODERATE if score 18-21 OR portfolio 3-4; WEAK otherwise
ACTIONABILITY (A/B only): MONITOR | REVIEW | CONFIRMS | CONTRADICTS

QUALITY REQUIREMENTS for summary and insight fields:
- summary: Be specific. Name the actual numbers, institutions, policies, or events. State WHAT happened, WHY it matters for asset prices, and WHAT is the direct implication for equities/bonds/commodities.
- insight: Name specific assets, sectors, or tickers likely affected. Describe what a portfolio manager should watch next week (data releases, speeches, levels to watch).
- context_md: Write in Spanish. Include actual market data (index levels, rate expectations, commodity moves if relevant). 2-3 paragraphs with professional investment language.

OUTPUT: Return valid JSON only. No other text. Include only A and B rated articles (minimum 3, maximum 7). Drop C and D items unless fewer than 3 A/B articles exist. context_md must be in Spanish.

JSON SCHEMA:
{
  "articles": [
    {
      "rank": 1,
      "title": "...",
      "date": "YYYY-MM-DD",
      "source_name": "...",
      "source_url": "...",
      "summary": "4-6 lines: what happened, why it matters",
      "insight": "1 paragraph: what to watch next",
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
    "weak_noise": 2,
    "top_theme": "one sentence about the dominant theme",
    "key_risk": "one sentence about the main risk",
    "context_md": "2-3 párrafos en español sobre el feeling de la semana"
  }
}

ARTICLES TO ANALYZE:
${articleBlocks}`

  const response = await callOllama(prompt, 0.1)
  return extractJson<PipelineResult>(response)
}
