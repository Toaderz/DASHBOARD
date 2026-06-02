import type { QuoteData, SearchResult, AssetType, SectorWeight, Holding } from '@/types'
// yahoo-finance2 handles Yahoo Finance auth (crumb/cookies) automatically
import YahooFinanceLib from 'yahoo-finance2'
import { toGlobalCategory } from './morningstar-categories'

const yf = new YahooFinanceLib({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false, allowAdditionalProps: true },
})

const YAHOO_BASE = 'https://query1.finance.yahoo.com'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ─── v8/finance/chart (no auth required) ─────────────────────────────────────
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
      currency: meta.currency ?? null,
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
  inception_date: string | null
  price_to_book: number | null
  median_market_cap: number | null
  morningstar_category: string | null
  global_category: string | null
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
  inception_date: null,
  price_to_book: null,
  median_market_cap: null,
  morningstar_category: null,
  global_category: null,
}

const pct = (v: number | null | undefined): number | null => (v != null ? v * 100 : null)

// Minimal typed shape returned by yahoo-finance2 quoteSummary (validateResult:false)
interface YSummary {
  price?: { quoteType?: string; navPrice?: number } | null
  summaryDetail?: { trailingPE?: number; marketCap?: number; dividendYield?: number; yield?: number } | null
  defaultKeyStatistics?: {
    totalAssets?: number; beta?: number; beta3Year?: number
    profitMargins?: number; fundFamily?: string
  } | null
  summaryProfile?: { sector?: string; industry?: string } | null
  fundProfile?: {
    family?: string
    categoryName?: string | null
    feesExpensesInvestment?: { annualReportExpenseRatio?: number } | null
    inceptionDate?: number | Date
  } | null
  topHoldings?: {
    holdings?: Array<{ symbol?: string; holdingName?: string; holdingPercent?: number }>
    sectorWeightings?: Record<string, number>[]
    equityHoldings?: { priceToBook?: number; medianMarketCap?: number } | null
  } | null
  fundPerformance?: {
    riskOverviewStatistics?: {
      riskStatistics?: Array<{
        alpha?: number; rSquared?: number; stdDev?: number; sharpeRatio?: number; treynorRatio?: number
      }>
    } | null
  } | null
}

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  try {
    const data = await yf.quoteSummary(
      ticker,
      {
        modules: [
          'summaryDetail',
          'defaultKeyStatistics',
          'summaryProfile',
          'fundProfile',
          'topHoldings',
          'fundPerformance',
          'price',
        ],
      },
      { validateResult: false }
    ) as YSummary

    const rawQuoteType = (data.price?.quoteType ?? '').toLowerCase()
    const totalAssets  = data.defaultKeyStatistics?.totalAssets ?? null
    const holdingsArr  = data.topHoldings?.holdings ?? []
    const isFund = rawQuoteType === 'etf' || rawQuoteType === 'mutualfund'
      || totalAssets != null || holdingsArr.length > 0

    // Sector weightings: [{ realestate: 0.0194 }, ...] — values already plain decimals
    const sectorWeightings: SectorWeight[] = (data.topHoldings?.sectorWeightings ?? [])
      .map((item) => {
        const [sector, weight] = Object.entries(item)[0] as [string, number]
        return { sector, weight }
      })
      .filter((s) => s.weight > 0)

    // Holdings: holdingPercent is already a decimal (0.07 = 7%)
    const topHoldings: Holding[] = holdingsArr.map((h) => ({
      symbol: h.symbol ?? null,
      name:   h.holdingName ?? null,
      pct:    h.holdingPercent != null ? h.holdingPercent * 100 : null,
    }))

    // Risk stats (fundPerformance — ETFs/funds only)
    const riskStats = data.fundPerformance?.riskOverviewStatistics?.riskStatistics?.[0]

    if (isFund) {
      const aum = totalAssets
      return {
        ...EMPTY_FUNDAMENTALS,
        market_cap:     null,
        pe:             data.summaryDetail?.trailingPE ?? null,
        beta:           data.defaultKeyStatistics?.beta3Year ?? null,
        dividend_yield: pct(data.summaryDetail?.yield),
        expense_ratio:  data.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio ?? null,
        aum,
        nav:            data.price?.navPrice ?? null,
        fund_family:    data.defaultKeyStatistics?.fundFamily ?? data.fundProfile?.family ?? null,
        alpha:          riskStats?.alpha ?? null,
        r_squared:      riskStats?.rSquared ?? null,
        std_dev:        pct(riskStats?.stdDev),
        sharpe:         riskStats?.sharpeRatio ?? null,
        treynor:        riskStats?.treynorRatio ?? null,
        sector_weightings: sectorWeightings.length > 0 ? sectorWeightings : null,
        top_holdings:      topHoldings.length > 0 ? topHoldings : null,
        inception_date: (() => {
          const raw = data.fundProfile?.inceptionDate
          if (raw == null) return null
          const d = raw instanceof Date ? raw : new Date((raw as number) * 1000)
          return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
        })(),
        price_to_book:      data.topHoldings?.equityHoldings?.priceToBook ?? null,
        median_market_cap:  data.topHoldings?.equityHoldings?.medianMarketCap ?? null,
        morningstar_category: data.fundProfile?.categoryName ?? null,
        global_category:      toGlobalCategory(data.fundProfile?.categoryName),
      }
    }

    // Equity / index / other
    const eqCategory = data.fundProfile?.categoryName ?? null
    return {
      ...EMPTY_FUNDAMENTALS,
      market_cap:           data.summaryDetail?.marketCap ?? null,
      pe:                   data.summaryDetail?.trailingPE ?? null,
      dividend_yield:       pct(data.summaryDetail?.dividendYield),
      beta:                 data.defaultKeyStatistics?.beta ?? null,
      profit_margins:       pct(data.defaultKeyStatistics?.profitMargins),
      sector:               data.summaryProfile?.sector ?? null,
      industry:             data.summaryProfile?.industry ?? null,
      morningstar_category: eqCategory,
      global_category:      toGlobalCategory(eqCategory),
    }
  } catch (err) {
    console.error('[fetchFundamentals] error for', ticker, ':', err instanceof Error ? err.message : err)
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
