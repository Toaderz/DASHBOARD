import type { QuoteData, SearchResult, AssetType, SectorWeight, Holding } from '@/types'
// yahoo-finance2 handles Yahoo Finance auth (crumb/cookies) automatically
import YahooFinanceLib from 'yahoo-finance2'
import { toGlobalCategory } from './morningstar-categories'
import { mapSettledWithConcurrency } from '@/lib/utils/concurrency'
import { parseSearchQuery } from './validation'
import { OBS, errMessage, obsWarn } from '@/lib/utils/obs'

const yf = new YahooFinanceLib({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false, allowAdditionalProps: true },
})

const YAHOO_BASE = 'https://query1.finance.yahoo.com'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** No Yahoo call may hang a serverless invocation. `AbortSignal.timeout`'s timer is `unref`'d. */
const REQUEST_TIMEOUT_MS = 8_000

/**
 * Bound on concurrent quote fetches inside ONE `fetchBatchQuotes` call.
 *
 * This is the primitive fix for the batch fan-out: the previous implementation ran
 * `Promise.allSettled(tickers.map(fetchQuoteV8Chart))`, so a cold 475-ticker Beating-Peers union
 * opened 475 sockets at once — a self-inflicted DoS that reliably earns a Yahoo 429 for the whole
 * batch. Bounding it here means EVERY caller of `fetchBatchQuotes` is bounded, present and future.
 */
const BATCH_QUOTE_CONCURRENCY = 16

// ─── v8/finance/chart (no auth required) ─────────────────────────────────────
async function fetchQuoteV8Chart(ticker: string): Promise<QuoteData | null> {
  try {
    const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d&includePrePost=false`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      if (res.status === 429) obsWarn({ event: OBS.YAHOO_429, ticker, provider: 'yahoo', status: res.status })
      else if (res.status >= 500) obsWarn({ event: OBS.YAHOO_5XX, ticker, provider: 'yahoo', status: res.status })
      return null
    }

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
      name: meta.longName ?? meta.shortName ?? null,
      instrument_type: meta.instrumentType ?? null,
      volume: meta.regularMarketVolume ?? null,
      high_52w: meta.fiftyTwoWeekHigh ?? null,
      low_52w: meta.fiftyTwoWeekLow ?? null,
      market_cap: null,
      pe: null,
      dividend_yield: null,
      currency: meta.currency ?? null,
      last_updated: new Date().toISOString(),
    }
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
    obsWarn({
      event: aborted ? OBS.TIMEOUT : OBS.PARSE_ERROR,
      ticker, provider: 'yahoo', reason: errMessage(err),
    })
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
  country: string | null
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
  country: null,
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
    profitMargins?: number; fundFamily?: string; fundInceptionDate?: number | Date
  } | null
  summaryProfile?: { sector?: string; industry?: string; country?: string } | null
  assetProfile?: { sector?: string; industry?: string; country?: string } | null
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
          'assetProfile',
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
        std_dev:        riskStats?.stdDev ?? null,  // Yahoo ya lo da en puntos % (18.09 = 18.09%), NO decimal
        sharpe:         riskStats?.sharpeRatio ?? null,
        treynor:        riskStats?.treynorRatio ?? null,
        sector_weightings: sectorWeightings.length > 0 ? sectorWeightings : null,
        top_holdings:      topHoldings.length > 0 ? topHoldings : null,
        inception_date: (() => {
          // Yahoo expone la fecha en defaultKeyStatistics.fundInceptionDate (Date ya parseado);
          // fundProfile.inceptionDate suele venir undefined para ETFs → usar aquél primero.
          const raw = data.defaultKeyStatistics?.fundInceptionDate ?? data.fundProfile?.inceptionDate
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
      sector:               data.summaryProfile?.sector ?? data.assetProfile?.sector ?? null,
      industry:             data.summaryProfile?.industry ?? data.assetProfile?.industry ?? null,
      country:              data.assetProfile?.country ?? data.summaryProfile?.country ?? null,
      morningstar_category: eqCategory,
      global_category:      toGlobalCategory(eqCategory),
    }
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
    obsWarn({
      event: aborted ? OBS.TIMEOUT : OBS.FUNDAMENTALS_FAILURE,
      ticker, provider: 'yahoo-finance2', reason: errMessage(err),
    })
    return EMPTY_FUNDAMENTALS
  }
}

/**
 * Does this bundle carry ANY real signal, or is it the `EMPTY_FUNDAMENTALS` shape returned by the
 * catch above?
 *
 * Callers need this because `fetchFundamentals` never throws: on a Yahoo hiccup it returns an
 * all-null bundle that looks like a legitimate answer. Upserting that bundle unconditionally wipes
 * `morningstar_category` / `sector_weightings` / `aum` for 24 h — precisely the columns
 * `/api/peers/init` depends on. Check this before writing data columns.
 */
export function hasFundamentalsSignal(f: Fundamentals): boolean {
  return Object.values(f).some((value) => {
    if (value == null) return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim().length > 0
    return true
  })
}

export type { Fundamentals }

export async function fetchBatchQuotes(
  tickers: string[],
  options: { concurrency?: number } = {}
): Promise<Map<string, QuoteData>> {
  if (tickers.length === 0) return new Map()

  // Bounded at the PRIMITIVE, not at the call site: every caller inherits the cap.
  const settled = await mapSettledWithConcurrency(
    tickers,
    options.concurrency ?? BATCH_QUOTE_CONCURRENCY,
    (t) => fetchQuoteV8Chart(t)
  )
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
  // Length cap applied in the primitive so no route can forward an unbounded string into an
  // outbound URL. `MAX_SEARCH_QUERY_LENGTH` chars is far more than Yahoo's search uses.
  const q = parseSearchQuery(query)
  if (!q) return []

  const url = `${YAHOO_BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
