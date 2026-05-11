import type { QuoteData, SearchResult, AssetType, SectorWeight, Holding } from '@/types'

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

interface Fundamentals {
  market_cap: number | null
  pe: number | null
  dividend_yield: number | null
  beta: number | null
  profit_margins: number | null
  expense_ratio: number | null
  aum: number | null
  sector_weightings: SectorWeight[] | null
  top_holdings: Holding[] | null
}

const EMPTY_FUNDAMENTALS: Fundamentals = {
  market_cap: null,
  pe: null,
  dividend_yield: null,
  beta: null,
  profit_margins: null,
  expense_ratio: null,
  aum: null,
  sector_weightings: null,
  top_holdings: null,
}

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  try {
    const modules = 'defaultKeyStatistics%2CfundProfile%2CtopHoldings%2CsummaryDetail%2Cprice'
    const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, next: { revalidate: 0 } })
    if (!res.ok) return EMPTY_FUNDAMENTALS
    const data = await res.json()
    const result = data?.quoteSummary?.result?.[0]
    if (!result) return EMPTY_FUNDAMENTALS

    const stats    = result.defaultKeyStatistics ?? {}
    const profile  = result.fundProfile ?? {}
    const fees     = profile.feesExpensesInvestment ?? {}
    const holdings = result.topHoldings ?? {}
    const summary  = result.summaryDetail ?? {}
    const price    = result.price ?? {}
    const quoteType = (price.quoteType ?? '').toLowerCase()

    // These fields are available for both equities and ETFs — extracted before branching
    const pe            = summary.trailingPE?.raw ?? null
    const beta          = stats.beta?.raw ?? null
    const divRaw        = summary.dividendYield?.raw ?? summary.yield?.raw ?? null
    const dividend_yield = divRaw != null ? divRaw * 100 : null

    if (quoteType === 'equity') {
      const pmRaw = stats.profitMargins?.raw ?? null
      return {
        ...EMPTY_FUNDAMENTALS,
        market_cap:     price.marketCap?.raw ?? null,
        pe,
        dividend_yield,
        beta,
        profit_margins: pmRaw != null ? pmRaw * 100 : null,
      }
    }

    if (quoteType === 'etf' || quoteType === 'mutualfund') {
      const aum = stats.totalAssets?.raw ?? stats.netAssets?.raw ?? null

      const sectorWeightings: SectorWeight[] = (holdings.sectorWeightings ?? [])
        .map((item: Record<string, { raw: number }>) => {
          const [sector, val] = Object.entries(item)[0] as [string, { raw: number }]
          return { sector, weight: val?.raw ?? 0 }
        })
        .filter((s: SectorWeight) => s.weight > 0)

      const topHoldings: Holding[] = (holdings.holdings ?? []).map(
        (h: { symbol?: string; holdingName?: string; holdingPercent?: { raw: number } }) => ({
          symbol: h.symbol ?? null,
          name:   h.holdingName ?? null,
          pct:    h.holdingPercent?.raw != null ? h.holdingPercent.raw * 100 : null,
        })
      )

      return {
        ...EMPTY_FUNDAMENTALS,
        // ETFs rarely have price.marketCap in Yahoo; use AUM as the sentinel so the
        // cache trigger (market_cap == null && expense_ratio == null && aum == null)
        // evaluates to false after the first successful fetch.
        market_cap:      aum,
        pe,
        beta,
        dividend_yield,
        expense_ratio:   fees.annualReportExpenseRatio?.raw ?? null,
        aum,
        sector_weightings: sectorWeightings.length > 0 ? sectorWeightings : null,
        top_holdings:    topHoldings.length > 0 ? topHoldings : null,
      }
    }

    return EMPTY_FUNDAMENTALS
  } catch {
    return EMPTY_FUNDAMENTALS
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
