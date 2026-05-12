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
  nav: number | null
  sector: string | null
  industry: string | null
  fund_family: string | null
  alpha: number | null
  r_squared: number | null
  std_dev: number | null
  sharpe: number | null
  treynor: number | null
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
  nav: null,
  sector: null,
  industry: null,
  fund_family: null,
  alpha: null,
  r_squared: null,
  std_dev: null,
  sharpe: null,
  treynor: null,
  sector_weightings: null,
  top_holdings: null,
}

const YAHOO_V10_BASE = 'https://query2.finance.yahoo.com'

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  try {
    const modules = [
      'summaryDetail',
      'defaultKeyStatistics',
      'summaryProfile',
      'assetProfile',
      'fundProfile',
      'topHoldings',
      'fundPerformance',
      'price',
    ].join(',')

    const url = `${YAHOO_V10_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, next: { revalidate: 0 } })
    if (!res.ok) return EMPTY_FUNDAMENTALS
    const json = await res.json()
    const data = json?.quoteSummary?.result?.[0]
    if (!data) return EMPTY_FUNDAMENTALS

    // Safe helper: traverses path on obj and unwraps .raw if present
    const getRaw = (obj: unknown, path: string[]): number | null => {
      let cur: unknown = obj
      for (const key of path) {
        if (cur == null || typeof cur !== 'object') return null
        cur = (cur as Record<string, unknown>)[key]
      }
      if (cur == null) return null
      if (typeof cur === 'object' && 'raw' in (cur as object)) return (cur as { raw: number }).raw
      return typeof cur === 'number' ? cur : null
    }

    const pct = (val: number | null) => (val != null ? val * 100 : null)

    // Fields common to all asset types
    const pe            = getRaw(data, ['summaryDetail', 'trailingPE'])
    const beta          = getRaw(data, ['defaultKeyStatistics', 'beta'])
    const divRaw        = getRaw(data, ['summaryDetail', 'dividendYield']) ?? getRaw(data, ['summaryDetail', 'yield'])
    const dividend_yield = pct(divRaw)

    // Market cap: use defaultKeyStatistics first (works for equities and some ETFs),
    // fall back to summaryDetail (sometimes populated for indices)
    const marketCapRaw = getRaw(data, ['defaultKeyStatistics', 'marketCap'])
      ?? getRaw(data, ['summaryDetail', 'marketCap'])

    // AUM: correct path is fundProfile.feesExpensesInvestment.totalNetAssets
    const aumRaw = getRaw(data, ['fundProfile', 'feesExpensesInvestment', 'totalNetAssets'])
      ?? getRaw(data, ['defaultKeyStatistics', 'totalAssets'])

    // NAV
    const navRaw = getRaw(data, ['price', 'netAssetValue']) ?? getRaw(data, ['summaryDetail', 'navPrice'])

    // Sector / industry (equities and some ETFs expose these via summaryProfile or assetProfile)
    const sectorVal   = (data as Record<string, Record<string, unknown>>)?.summaryProfile?.sector as string | null
      ?? (data as Record<string, Record<string, unknown>>)?.assetProfile?.sector as string | null
      ?? null
    const industryVal = (data as Record<string, Record<string, unknown>>)?.summaryProfile?.industry as string | null
      ?? (data as Record<string, Record<string, unknown>>)?.assetProfile?.industry as string | null
      ?? null

    // Fund family
    const profileData = (data as Record<string, Record<string, unknown>>)?.fundProfile ?? {}
    const fundFamilyVal = (profileData.family ?? profileData.categoryName ?? null) as string | null

    // Advanced risk stats (fundPerformance — ETFs/mutual funds only)
    const riskStats = (data as Record<string, { riskOverviewStatistics?: { riskStatistics?: unknown[] } }>)
      ?.fundPerformance?.riskOverviewStatistics?.riskStatistics?.[0] ?? {}
    const alphaVal    = pct(getRaw(riskStats, ['alpha']))
    const rSquaredVal = getRaw(riskStats, ['rSquared'])
    const stdDevVal   = pct(getRaw(riskStats, ['stdDev']))
    const sharpeVal   = getRaw(riskStats, ['sharpeRatio'])
    const treynorVal  = getRaw(riskStats, ['treynorRatio'])

    // Holdings / sector weights (ETFs/funds)
    const holdingsData = (data as Record<string, { sectorWeightings?: unknown[]; holdings?: unknown[] }>)?.topHoldings ?? {}

    const sectorWeightings: SectorWeight[] = ((holdingsData.sectorWeightings ?? []) as Record<string, { raw: number }>[])
      .map((item) => {
        const [sector, val] = Object.entries(item)[0] as [string, { raw: number }]
        return { sector, weight: val?.raw ?? 0 }
      })
      .filter((s: SectorWeight) => s.weight > 0)

    const topHoldings: Holding[] = ((holdingsData.holdings ?? []) as { symbol?: string; holdingName?: string; holdingPercent?: { raw: number } }[])
      .map((h) => ({
        symbol: h.symbol ?? null,
        name:   h.holdingName ?? null,
        pct:    h.holdingPercent?.raw != null ? h.holdingPercent.raw * 100 : null,
      }))

    // Detect asset type from price module; fall back to checking if fund-specific fields are present
    const priceData = (data as Record<string, Record<string, unknown>>)?.price ?? {}
    const rawQuoteType = ((priceData.quoteType ?? '') as string).toLowerCase()
    const isFund = rawQuoteType === 'etf' || rawQuoteType === 'mutualfund'
      || aumRaw != null || (holdingsData.holdings as unknown[] | undefined)?.length

    if (isFund) {
      return {
        ...EMPTY_FUNDAMENTALS,
        // For ETFs, Yahoo rarely returns marketCap; use AUM as the sentinel so the
        // cache trigger (market_cap == null && expense_ratio == null && aum == null)
        // evaluates to false after the first successful fetch.
        market_cap:      aumRaw,
        pe,
        beta,
        dividend_yield,
        expense_ratio:   pct(getRaw(data, ['fundProfile', 'feesExpensesInvestment', 'annualReportExpenseRatio'])),
        aum:             aumRaw,
        nav:             navRaw,
        fund_family:     fundFamilyVal,
        alpha:           alphaVal,
        r_squared:       rSquaredVal,
        std_dev:         stdDevVal,
        sharpe:          sharpeVal,
        treynor:         treynorVal,
        sector_weightings: sectorWeightings.length > 0 ? sectorWeightings : null,
        top_holdings:    topHoldings.length > 0 ? topHoldings : null,
      }
    }

    // Equity / index / other
    return {
      ...EMPTY_FUNDAMENTALS,
      market_cap:     marketCapRaw,
      pe,
      dividend_yield,
      beta,
      profit_margins: pct(getRaw(data, ['defaultKeyStatistics', 'profitMargins'])),
      sector:         sectorVal,
      industry:       industryVal,
    }
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
