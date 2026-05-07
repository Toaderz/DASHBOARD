import type { QuoteData, SearchResult, AssetType } from '@/types'

const YAHOO_BASE = 'https://query1.finance.yahoo.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ─── v8/finance/chart (no auth required) ─────────────────────────────────────
// Returns: price, change%, volume, 52w high/low
// market_cap, pe, dividend_yield are not available without Yahoo auth
async function fetchQuoteV8Chart(ticker: string): Promise<QuoteData | null> {
  try {
    const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d&includePrePost=false`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      next: { revalidate: 0 },
    })
    if (!res.ok) return null

    const data = await res.json()
    const meta = data.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null

    const price: number = meta.regularMarketPrice
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? 0
    const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

    return {
      ticker,
      price,
      change_percent: changePercent,
      volume: meta.regularMarketVolume ?? null,
      high_52w: meta.fiftyTwoWeekHigh ?? null,
      low_52w: meta.fiftyTwoWeekLow ?? null,
      market_cap: null,
      pe: null,
      dividend_yield: null,
      last_updated: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export async function fetchBatchQuotes(tickers: string[]): Promise<Map<string, QuoteData>> {
  if (tickers.length === 0) return new Map()

  const settled = await Promise.allSettled(tickers.map((t) => fetchQuoteV8Chart(t)))
  const map = new Map<string, QuoteData>()
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      map.set(tickers[i], result.value)
    }
  })
  return map
}

export async function fetchQuote(ticker: string): Promise<QuoteData> {
  const result = await fetchQuoteV8Chart(ticker)
  if (!result) throw new Error(`No quote data for ${ticker}`)
  return result
}

// ─── Asset type detection ────────────────────────────────────────────────────
function detectAssetType(quoteType: string): AssetType {
  const q = quoteType.toUpperCase()
  if (q === 'ETF') return 'etf'
  if (q === 'MUTUALFUND') return 'fund'
  if (q === 'INDEX' || q === 'FUTURE') return 'index'
  if (q === 'CRYPTOCURRENCY') return 'crypto'
  return 'stock'
}

interface YahooSearchQuote {
  symbol: string
  longname?: string
  shortname?: string
  quoteType: string
  exchange?: string
}

export async function searchTickers(query: string): Promise<SearchResult[]> {
  const url = `${YAHOO_BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
  })

  if (!res.ok) throw new Error(`Yahoo Finance search error: ${res.status}`)

  const data = await res.json()
  const ALLOWED_TYPES = ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'FUTURE', 'CRYPTOCURRENCY']

  return (data.quotes ?? [])
    .filter((item: YahooSearchQuote) => ALLOWED_TYPES.includes(item.quoteType))
    .slice(0, 10)
    .map((item: YahooSearchQuote) => ({
      ticker: item.symbol,
      name: item.longname ?? item.shortname ?? item.symbol,
      type: detectAssetType(item.quoteType),
      exchange: item.exchange,
    }))
}
