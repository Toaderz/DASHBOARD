export type AssetType = 'stock' | 'etf' | 'index' | 'fund' | 'crypto'

export type MetricKey =
  | '1D'
  | '1W'
  | '1M'
  | 'YTD'
  | '1Y'
  | '3Y'
  | '5Y'
  | '10Y'
  | 'MAX'
  | 'marketCap'
  | 'pe'
  | 'dividendYield'
  | 'from52wHigh'
  | 'expenseRatio'
  | 'aum'
  | 'beta'
  | 'profitMargins'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  created_at: string
  is_team_evolve?: boolean
}

export interface AssetMetadata {
  ticker: string
  name: string
  type: AssetType
  sector: string | null
  region: string | null
  industry: string | null
  benchmark: string | null
  manager: string | null
}

export interface Watchlist {
  id: string
  user_id: string
  name: string
  description: string | null
  selected_metrics: MetricKey[]
  created_at: string
  updated_at: string
}

export interface AssetWithCategory extends AssetMetadata {
  category: string | null
}

export interface WatchlistAsset {
  watchlist_id: string
  asset_ticker: string
  added_at: string
  category: string | null
  sort_order: number | null
  asset?: AssetMetadata
}

export interface SectorWeight {
  sector: string
  weight: number
}

export interface Holding {
  symbol: string | null
  name: string | null
  pct: number | null
}

export interface QuoteData {
  ticker: string
  price: number
  change_percent: number
  volume?: number | null
  high_52w?: number | null
  low_52w?: number | null
  market_cap?: number | null
  pe?: number | null
  dividend_yield?: number | null
  expense_ratio?: number | null
  aum?: number | null
  beta?: number | null
  profit_margins?: number | null
  nav?: number | null
  sector?: string | null
  industry?: string | null
  fund_family?: string | null
  alpha?: number | null
  r_squared?: number | null
  std_dev?: number | null
  sharpe?: number | null
  treynor?: number | null
  sector_weightings?: SectorWeight[] | null
  top_holdings?: Holding[] | null
  inception_date?: string | null
  price_to_book?: number | null
  median_market_cap?: number | null
  currency?: string | null
  last_updated: string
}

export interface HistoricalDataPoint {
  date: string
  close: number
  open?: number
  high?: number
  low?: number
  volume?: number
}

export interface AssetRow extends AssetMetadata {
  price?: number
  change_percent?: number
  returns?: Partial<Record<MetricKey, number>>
  market_cap?: number
  pe_ratio?: number
  dividend_yield?: number
  high_52w?: number
  from_52w_high?: number
}

export interface SearchResult {
  ticker: string
  name: string
  type: AssetType
  exchange?: string
}

export interface WatchlistShare {
  id: string
  watchlist_id: string
  shared_with_user_id: string
  created_at: string
  profiles?: { email: string | null }[] | null
}

export type FlashState = 'up' | 'down' | null

export interface MetricDefinition {
  key: MetricKey
  label: string
  description: string
  format: 'percent' | 'currency' | 'ratio' | 'number'
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: '1D', label: '1D %', description: '1 Day Return', format: 'percent' },
  { key: '1W', label: '1W %', description: '1 Week Return', format: 'percent' },
  { key: '1M', label: '1M %', description: '1 Month Return', format: 'percent' },
  { key: 'YTD', label: 'YTD %', description: 'Year to Date Return', format: 'percent' },
  { key: '1Y', label: '1Y %', description: '1 Year Return', format: 'percent' },
  { key: '3Y', label: '3Y %', description: '3 Year Return', format: 'percent' },
  { key: '5Y', label: '5Y %', description: '5 Year Return', format: 'percent' },
  { key: '10Y', label: '10Y %', description: '10 Year Return', format: 'percent' },
  { key: 'MAX', label: 'MAX %', description: 'Since Inception Return', format: 'percent' },
  { key: 'marketCap', label: 'Mkt Cap', description: 'Market Capitalization', format: 'currency' },
  { key: 'pe', label: 'P/E', description: 'Price to Earnings Ratio', format: 'ratio' },
  { key: 'dividendYield', label: 'Div Yield', description: 'Dividend Yield', format: 'percent' },
  { key: 'from52wHigh', label: '52W High', description: 'Distance from 52-Week High', format: 'percent' },
  { key: 'expenseRatio', label: 'Exp. Ratio', description: 'Expense Ratio (net)', format: 'percent' },
  { key: 'aum', label: 'AUM', description: 'Assets Under Management', format: 'currency' },
  { key: 'beta', label: 'Beta', description: 'Market Sensitivity (Beta)', format: 'ratio' },
  { key: 'profitMargins', label: 'Net Margin', description: 'Net Profit Margin', format: 'percent' },
]
