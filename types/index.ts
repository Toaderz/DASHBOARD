export type AssetType = 'stock' | 'etf' | 'index' | 'fund' | 'crypto'

export type MetricKey =
  | '1D'
  | '1W'
  | '1M'
  | '6M'
  | 'YTD'
  | '1Y'
  | '3Y'
  | '5Y'
  | '10Y'
  | 'MAX'
  | 'CY2025'
  | 'CY2024'
  | 'CY2023'
  | 'CY2022'
  | 'CY2021'
  | 'CY2020'
  | 'CY2019'
  | 'marketCap'
  | 'pe'
  | 'dividendYield'
  | 'from52wHigh'
  | 'expenseRatio'
  | 'aum'
  | 'beta'
  | 'profitMargins'
  | 'inceptionDate'
  | 'morningstarCategory'
  | 'globalCategory'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
  created_at: string
  is_team_evolve?: boolean
}

// Perfil de relevancia estable por activo (Fase A del pipeline de noticias).
// Solo descriptores factuales: gestor, estrategia, clase de activo, geografía, sector/tema.
export interface RelevanceProfile {
  asset_type: 'stock' | 'etf' | 'index' | 'fund' | 'closed_end_fund' | 'crypto' | string
  themes: string[]
  issuer_or_manager: string | null
  geography: string | null
  entities: string[]
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
  relevance_profile?: RelevanceProfile | null
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
  morningstar_category?: string | null
  global_category?: string | null
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
  format: 'percent' | 'currency' | 'ratio' | 'number' | 'date' | 'text'
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
  { key: 'CY2025', label: 'CY2025', description: '2025 Calendar Year Return', format: 'percent' },
  { key: 'CY2024', label: 'CY2024', description: '2024 Calendar Year Return', format: 'percent' },
  { key: 'CY2023', label: 'CY2023', description: '2023 Calendar Year Return', format: 'percent' },
  { key: 'CY2022', label: 'CY2022', description: '2022 Calendar Year Return', format: 'percent' },
  { key: 'CY2021', label: 'CY2021', description: '2021 Calendar Year Return', format: 'percent' },
  { key: 'CY2020', label: 'CY2020', description: '2020 Calendar Year Return', format: 'percent' },
  { key: 'CY2019', label: 'CY2019', description: '2019 Calendar Year Return', format: 'percent' },
  { key: 'marketCap', label: 'Mkt Cap', description: 'Market Capitalization', format: 'currency' },
  { key: 'pe', label: 'P/E', description: 'Price to Earnings Ratio', format: 'ratio' },
  { key: 'dividendYield', label: 'Div Yield', description: 'Dividend Yield', format: 'percent' },
  { key: 'from52wHigh', label: '52W High', description: 'Distance from 52-Week High', format: 'percent' },
  { key: 'expenseRatio', label: 'Exp. Ratio', description: 'Expense Ratio (net)', format: 'percent' },
  { key: 'aum', label: 'AUM', description: 'Assets Under Management', format: 'currency' },
  { key: 'beta', label: 'Beta', description: 'Market Sensitivity (Beta)', format: 'ratio' },
  { key: 'profitMargins', label: 'Net Margin', description: 'Net Profit Margin', format: 'percent' },
  { key: 'inceptionDate', label: 'Inception', description: 'Fund Inception Date', format: 'date' },
  { key: 'morningstarCategory', label: 'MS Category', description: 'Morningstar Category', format: 'text' },
  { key: 'globalCategory', label: 'Global Cat.', description: 'Morningstar Global Category', format: 'text' },
]

// ── Market Brief & News ──────────────────────────────────────

export type WatchlistItem = {
  priority: 'Alta' | 'Media' | 'Baja'
  item: string
}

export type MarketBrief = {
  id: string
  created_at: string
  period_start: string
  period_end: string
  valid_until: string
  status: 'generating' | 'ready' | 'failed'
  context_md: string | null
  strong_signals: number
  moderate_signals: number
  weak_noise: number
  top_theme: string | null
  key_risk: string | null
  metadata: {
    watchlist_items?: WatchlistItem[]
    editorial_stance?: string
    error?: string
    [key: string]: unknown
  }
}

export type MarketNews = {
  id: string
  brief_id: string
  rank: number
  title: string
  summary: string
  insight: string
  full_text_md: string | null
  source_url: string
  source_name: string
  published_at: string | null
  affected_tickers: string[]
  affected_symbols?: AffectedSymbol[]
  relevance_source?: string | null
  source_authority?: number | null
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
}

// Símbolo afectado por una noticia + cómo se determinó (matching determinista, Fase B).
export type AffectedSymbol = {
  ticker: string
  source: 'entity' | 'ticker' | 'text_scan'
}

export type BriefWithNews = MarketBrief & { market_news: MarketNews[] }
