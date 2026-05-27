import type { AssetMetadata } from '@/types'

export type Strategy =
  | 'dividend-growth' | 'high-yield' | 'quality-blend' | 'value' | 'growth'
  | 'blend-large' | 'blend-small' | 'intl-developed' | 'emerging'
  | 'sector-tech' | 'sector-health' | 'sector-fin' | 'sector-energy'
  | 'sector-staples' | 'sector-util' | 'sector-realestate'
  | 'real-estate' | 'concentrated-equity'
  | 'fixed-income-core' | 'fixed-income-hy' | 'fixed-income-tip'
  | 'commodity' | 'commodity-gold' | 'commodity-miners'
  | 'biz-platform' | 'biz-digital-ads' | 'biz-consumer-hardware'
  | 'biz-cloud-software' | 'biz-cloud-infra' | 'biz-semiconductor-ai'
  | 'biz-semiconductor-mobile' | 'biz-semiconductor-cpu'
  | 'biz-fintech-payments' | 'biz-bank-diversified' | 'biz-investment-bank'
  | 'biz-asset-mgmt' | 'biz-managed-care' | 'biz-pharma-large'
  | 'crypto-btc' | 'crypto-layer1' | 'crypto-defi' | 'crypto-stablecoin'

export type Universe =
  | 'us-large' | 'us-mid' | 'us-small' | 'us-broad'
  | 'global' | 'intl-developed' | 'emerging' | 'sector-specific'
  | 'crypto'

export type PortfolioRole =
  | 'core' | 'core-income' | 'income' | 'growth-satellite'
  | 'defensive' | 'inflation-hedge' | 'speculative'
  | 'alternatives' | 'international' | 'fixed-income'

export type BehaviorProfile =
  | 'rate-sensitive' | 'momentum-heavy' | 'defensive' | 'cyclical'
  | 'quality-compounder' | 'event-driven' | 'commodity-linked' | 'income-stable'
  | 'crypto-volatile'

export interface AssetClassification {
  strategy: Strategy
  subStrategy?: string
  universe: Universe
  portfolioRole: PortfolioRole
  behaviorProfile?: BehaviorProfile
  factorTilts?: string[]
  manager?: string
  benchmark?: string
  isIndexFund?: boolean
  concentration?: 'concentrated' | 'diversified'
  classificationConfidence: number
}

const STRATEGY_ADJACENCY: Partial<Record<Strategy, Strategy[]>> = {
  // ETF strategies
  'dividend-growth':       ['quality-blend', 'high-yield'],
  'quality-blend':         ['dividend-growth', 'growth', 'value'],
  'growth':                ['quality-blend', 'blend-large'],
  'high-yield':            ['dividend-growth', 'fixed-income-core'],
  'value':                 ['quality-blend', 'dividend-growth'],
  'blend-large':           ['growth', 'value'],
  'blend-small':           ['value', 'blend-large'],
  'intl-developed':        ['emerging'],
  'emerging':              ['intl-developed'],
  'sector-tech':           ['growth', 'biz-semiconductor-ai', 'biz-cloud-software'],
  'sector-fin':            ['biz-bank-diversified', 'biz-investment-bank', 'biz-fintech-payments', 'biz-asset-mgmt'],
  'sector-health':         ['biz-managed-care', 'biz-pharma-large'],
  'sector-realestate':     ['real-estate'],
  'real-estate':           ['sector-realestate'],
  // Stock biz strategies
  'biz-consumer-hardware': ['biz-cloud-software', 'biz-platform'],
  'biz-digital-ads':       ['biz-platform', 'biz-cloud-infra'],
  'biz-cloud-software':    ['biz-platform', 'biz-cloud-infra', 'biz-consumer-hardware'],
  'biz-cloud-infra':       ['biz-platform', 'biz-digital-ads', 'biz-cloud-software'],
  'biz-platform':          ['biz-digital-ads', 'biz-cloud-software', 'biz-cloud-infra', 'biz-consumer-hardware'],
  'biz-semiconductor-ai':  ['biz-semiconductor-cpu', 'sector-tech'],
  'biz-semiconductor-cpu': ['biz-semiconductor-ai', 'biz-semiconductor-mobile'],
  'biz-semiconductor-mobile':['biz-semiconductor-cpu', 'biz-semiconductor-ai'],
  'biz-fintech-payments':  ['biz-bank-diversified', 'biz-investment-bank', 'sector-fin'],
  'biz-bank-diversified':  ['biz-investment-bank', 'biz-fintech-payments', 'sector-fin'],
  'biz-investment-bank':   ['biz-bank-diversified', 'biz-asset-mgmt', 'sector-fin'],
  'biz-asset-mgmt':        ['biz-investment-bank', 'biz-bank-diversified'],
  'biz-managed-care':      ['biz-pharma-large', 'sector-health'],
  'biz-pharma-large':      ['biz-managed-care', 'sector-health'],
  // Macro
  'commodity-gold':        ['commodity', 'fixed-income-tip'],
  'fixed-income-tip':      ['commodity-gold', 'fixed-income-core'],
  'fixed-income-core':     ['fixed-income-tip', 'high-yield'],
  'concentrated-equity':   [],
  // Crypto
  'crypto-btc':        ['crypto-layer1'],
  'crypto-layer1':     ['crypto-btc', 'crypto-defi'],
  'crypto-defi':       ['crypto-layer1'],
  'crypto-stablecoin': [],
}

const ROLE_ADJACENCY: Partial<Record<PortfolioRole, PortfolioRole[]>> = {
  'core':           ['core-income', 'growth-satellite'],
  'core-income':    ['core', 'income'],
  'income':         ['core-income', 'fixed-income'],
  'growth-satellite':['core'],
  'defensive':      ['core', 'fixed-income'],
  'inflation-hedge':['fixed-income', 'core'],
  'fixed-income':   ['income', 'inflation-hedge', 'defensive'],
  'alternatives':   [],
}

function isAdjacentUniverse(a: Universe, b: Universe): boolean {
  const adj: Partial<Record<Universe, Universe[]>> = {
    'us-large':       ['us-broad', 'us-mid'],
    'us-broad':       ['us-large', 'us-small', 'us-mid'],
    'us-mid':         ['us-large', 'us-small'],
    'intl-developed': ['global'],
    'emerging':       ['global', 'intl-developed'],
    'global':         ['intl-developed', 'emerging'],
  }
  return adj[a]?.includes(b) ?? false
}

// ETFs — Dividend Growth
const DG = (subStrategy: string, manager: string, benchmark?: string, tilts: string[] = ['quality', 'growth']): AssetClassification => ({
  strategy: 'dividend-growth', subStrategy, universe: 'us-large',
  portfolioRole: 'core-income', behaviorProfile: 'income-stable',
  factorTilts: tilts, manager, benchmark, isIndexFund: true,
  classificationConfidence: 92,
})
// ETFs — High Yield
const HY = (subStrategy: string, manager: string, tilts: string[] = ['value']): AssetClassification => ({
  strategy: 'high-yield', subStrategy, universe: 'us-large',
  portfolioRole: 'income', behaviorProfile: 'income-stable',
  factorTilts: tilts, manager, isIndexFund: true, classificationConfidence: 90,
})
// ETFs — Growth
const GR = (subStrategy: string, manager: string, benchmark?: string): AssetClassification => ({
  strategy: 'growth', subStrategy, universe: 'us-large',
  portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy',
  factorTilts: ['growth', 'momentum'], manager, benchmark, isIndexFund: true,
  classificationConfidence: 91,
})
// ETFs — Blend Large
const BL = (manager: string, benchmark: string): AssetClassification => ({
  strategy: 'blend-large', universe: 'us-large',
  portfolioRole: 'core', manager, benchmark, isIndexFund: true,
  classificationConfidence: 93,
})
// ETFs — Value
const VA = (manager: string, benchmark?: string): AssetClassification => ({
  strategy: 'value', universe: 'us-large',
  portfolioRole: 'core', behaviorProfile: 'cyclical',
  factorTilts: ['value'], manager, benchmark, isIndexFund: true,
  classificationConfidence: 90,
})
// ETFs — First Trust generic sector/thematic
const FT = (sub: string, strat: Strategy, univ: Universe = 'sector-specific', role: PortfolioRole = 'growth-satellite', beh?: BehaviorProfile): AssetClassification => ({
  strategy: strat, subStrategy: sub, universe: univ, portfolioRole: role,
  behaviorProfile: beh, manager: 'First Trust', isIndexFund: true, classificationConfidence: 87,
})
// ETFs — First Trust international
const FTI = (sub: string, strat: Strategy = 'intl-developed', univ: Universe = 'intl-developed'): AssetClassification => ({
  strategy: strat, subStrategy: sub, universe: univ, portfolioRole: 'international',
  manager: 'First Trust', isIndexFund: true, classificationConfidence: 87,
})

export const TAXONOMY: Record<string, AssetClassification> = {
  // ── Dividend Growth ────────────────────────────────────────────────────────
  RDVY:  DG('screened-quality-dividend', 'First Trust'),
  SCHD:  DG('quality-dividend', 'Schwab', 'dow-jones-us-dividend-100', ['quality', 'value']),
  VIG:   DG('dividend-appreciation', 'Vanguard', 's&p-us-dividend-growers'),
  DGRO:  DG('dividend-growth-screen', 'iShares', 'morningstar-us-dividend-growth'),
  NOBL:  DG('dividend-aristocrats', 'ProShares', 's&p500-dividend-aristocrats', ['quality']),
  SDY:   DG('dividend-achievers', 'SPDR', 's&p-high-yield-dividend-aristocrats', ['value', 'quality']),
  DGRW:  DG('quality-dividend-growth', 'WisdomTree', undefined, ['quality', 'growth', 'value']),
  FDVV:  DG('factor-dividend', 'Fidelity', undefined, ['quality', 'value']),

  // ── High Yield ─────────────────────────────────────────────────────────────
  DVY:   HY('select-high-dividend', 'iShares'),
  VYM:   HY('broad-high-yield', 'Vanguard', ['value']),
  HDV:   HY('quality-high-yield', 'iShares', ['quality', 'value']),
  SPHD:  HY('high-div-low-vol', 'Invesco', ['low-vol', 'value']),

  // ── Quality / Factor ───────────────────────────────────────────────────────
  QUAL:  { strategy: 'quality-blend', subStrategy: 'quality-factor', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality'], manager: 'iShares', benchmark: 'msci-usa-quality-factor', isIndexFund: true, classificationConfidence: 91 },
  MTUM:  { strategy: 'quality-blend', subStrategy: 'momentum-factor', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['momentum'], manager: 'iShares', isIndexFund: true, classificationConfidence: 88 },
  USMV:  { strategy: 'quality-blend', subStrategy: 'min-volatility', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', factorTilts: ['low-vol', 'quality'], manager: 'iShares', isIndexFund: true, classificationConfidence: 90 },

  // ── Growth ────────────────────────────────────────────────────────────────
  QQQ:   GR('nasdaq100-tech-heavy', 'Invesco', 'nasdaq-100'),
  QQQM:  GR('nasdaq100-tech-heavy', 'Invesco', 'nasdaq-100'),
  VUG:   GR('large-cap-growth', 'Vanguard', 'crsp-us-large-cap-growth'),
  SCHG:  GR('large-cap-growth', 'Schwab', 'dow-jones-us-large-cap-growth'),
  IWF:   GR('large-cap-growth', 'iShares', 'russell-1000-growth'),
  MGK:   GR('mega-cap-growth', 'Vanguard'),

  // ── Blend Large ───────────────────────────────────────────────────────────
  SPY:   BL('SPDR', 's&p-500'),
  IVV:   BL('iShares', 's&p-500'),
  VOO:   BL('Vanguard', 's&p-500'),
  VTI:   { ...BL('Vanguard', 'crsp-us-total-market'), subStrategy: 'total-market', universe: 'us-broad' },
  ITOT:  { ...BL('iShares', 's&p-total-market'), subStrategy: 'total-market', universe: 'us-broad' },
  SCHB:  { ...BL('Schwab', 'dow-jones-us-broad-market'), subStrategy: 'total-market', universe: 'us-broad' },

  // ── Value ─────────────────────────────────────────────────────────────────
  VTV:   VA('Vanguard', 'crsp-us-large-cap-value'),
  IVE:   VA('iShares', 's&p500-value'),
  SCHV:  VA('Schwab'),
  RPV:   { ...VA('Invesco'), subStrategy: 'pure-value' },
  VLUE:  { ...VA('iShares'), subStrategy: 'enhanced-value', benchmark: 'msci-usa-enhanced-value' },

  // ── Small Cap ─────────────────────────────────────────────────────────────
  IWM:   { strategy: 'blend-small', universe: 'us-small', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', manager: 'iShares', benchmark: 'russell-2000', isIndexFund: true, classificationConfidence: 92 },
  VB:    { strategy: 'blend-small', universe: 'us-small', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', manager: 'Vanguard', benchmark: 'crsp-us-small-cap', isIndexFund: true, classificationConfidence: 92 },
  IJR:   { strategy: 'blend-small', universe: 'us-small', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', manager: 'iShares', benchmark: 's&p600-small-cap', isIndexFund: true, classificationConfidence: 92 },
  VBR:   { strategy: 'blend-small', subStrategy: 'small-cap-value', universe: 'us-small', portfolioRole: 'core', factorTilts: ['value'], behaviorProfile: 'cyclical', manager: 'Vanguard', isIndexFund: true, classificationConfidence: 89 },

  // ── International Developed ───────────────────────────────────────────────
  VEA:   { strategy: 'intl-developed', universe: 'intl-developed', portfolioRole: 'international', manager: 'Vanguard', benchmark: 'ftse-developed-ex-us', isIndexFund: true, classificationConfidence: 92 },
  IEFA:  { strategy: 'intl-developed', universe: 'intl-developed', portfolioRole: 'international', manager: 'iShares', benchmark: 'msci-eafe-imi', isIndexFund: true, classificationConfidence: 92 },
  EFA:   { strategy: 'intl-developed', universe: 'intl-developed', portfolioRole: 'international', manager: 'iShares', benchmark: 'msci-eafe', isIndexFund: true, classificationConfidence: 92 },
  SCHF:  { strategy: 'intl-developed', universe: 'intl-developed', portfolioRole: 'international', manager: 'Schwab', isIndexFund: true, classificationConfidence: 90 },

  // ── Emerging ──────────────────────────────────────────────────────────────
  VWO:   { strategy: 'emerging', universe: 'emerging', portfolioRole: 'international', manager: 'Vanguard', benchmark: 'ftse-emerging', isIndexFund: true, classificationConfidence: 92 },
  EEM:   { strategy: 'emerging', universe: 'emerging', portfolioRole: 'international', manager: 'iShares', benchmark: 'msci-emerging-markets', isIndexFund: true, classificationConfidence: 92 },
  IEMG:  { strategy: 'emerging', universe: 'emerging', portfolioRole: 'international', manager: 'iShares', benchmark: 'msci-emerging-markets-imi', isIndexFund: true, classificationConfidence: 92 },

  // ── Sectors ───────────────────────────────────────────────────────────────
  XLK:   { strategy: 'sector-tech', universe: 'sector-specific', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', manager: 'SPDR', isIndexFund: true, classificationConfidence: 91 },
  VGT:   { strategy: 'sector-tech', universe: 'sector-specific', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', manager: 'Vanguard', isIndexFund: true, classificationConfidence: 91 },
  FTEC:  { strategy: 'sector-tech', universe: 'sector-specific', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', manager: 'Fidelity', isIndexFund: true, classificationConfidence: 90 },
  XLF:   { strategy: 'sector-fin', universe: 'sector-specific', portfolioRole: 'core', behaviorProfile: 'cyclical', manager: 'SPDR', isIndexFund: true, classificationConfidence: 90 },
  VFH:   { strategy: 'sector-fin', universe: 'sector-specific', portfolioRole: 'core', behaviorProfile: 'cyclical', manager: 'Vanguard', isIndexFund: true, classificationConfidence: 90 },
  XLV:   { strategy: 'sector-health', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'defensive', manager: 'SPDR', isIndexFund: true, classificationConfidence: 91 },
  VHT:   { strategy: 'sector-health', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'defensive', manager: 'Vanguard', isIndexFund: true, classificationConfidence: 91 },
  XLE:   { strategy: 'sector-energy', universe: 'sector-specific', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', manager: 'SPDR', isIndexFund: true, classificationConfidence: 90 },
  VDE:   { strategy: 'sector-energy', universe: 'sector-specific', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', manager: 'Vanguard', isIndexFund: true, classificationConfidence: 90 },
  XLP:   { strategy: 'sector-staples', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'defensive', manager: 'SPDR', isIndexFund: true, classificationConfidence: 90 },
  XLU:   { strategy: 'sector-util', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'rate-sensitive', manager: 'SPDR', isIndexFund: true, classificationConfidence: 90 },
  XLRE:  { strategy: 'sector-realestate', universe: 'sector-specific', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', manager: 'SPDR', isIndexFund: true, classificationConfidence: 90 },

  // ── Real Estate ───────────────────────────────────────────────────────────
  VNQ:   { strategy: 'real-estate', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', manager: 'Vanguard', benchmark: 'msci-us-reit', isIndexFund: true, classificationConfidence: 92 },
  SCHH:  { strategy: 'real-estate', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', manager: 'Schwab', isIndexFund: true, classificationConfidence: 90 },
  IYR:   { strategy: 'real-estate', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', manager: 'iShares', isIndexFund: true, classificationConfidence: 90 },

  // ── Fixed Income ──────────────────────────────────────────────────────────
  AGG:   { strategy: 'fixed-income-core', universe: 'us-broad', portfolioRole: 'fixed-income', behaviorProfile: 'rate-sensitive', manager: 'iShares', benchmark: 'us-agg-bond', isIndexFund: true, classificationConfidence: 93 },
  BND:   { strategy: 'fixed-income-core', universe: 'us-broad', portfolioRole: 'fixed-income', behaviorProfile: 'rate-sensitive', manager: 'Vanguard', benchmark: 'bloomberg-us-agg', isIndexFund: true, classificationConfidence: 93 },
  TLT:   { strategy: 'fixed-income-core', subStrategy: 'long-term-treasury', universe: 'us-broad', portfolioRole: 'defensive', behaviorProfile: 'rate-sensitive', manager: 'iShares', isIndexFund: true, classificationConfidence: 92 },
  IEF:   { strategy: 'fixed-income-core', subStrategy: 'intermediate-treasury', universe: 'us-broad', portfolioRole: 'fixed-income', behaviorProfile: 'rate-sensitive', manager: 'iShares', isIndexFund: true, classificationConfidence: 91 },
  LQD:   { strategy: 'fixed-income-core', subStrategy: 'investment-grade-corp', universe: 'us-broad', portfolioRole: 'fixed-income', behaviorProfile: 'rate-sensitive', manager: 'iShares', isIndexFund: true, classificationConfidence: 91 },
  HYG:   { strategy: 'fixed-income-hy', universe: 'us-broad', portfolioRole: 'income', manager: 'iShares', isIndexFund: true, classificationConfidence: 91 },
  JNK:   { strategy: 'fixed-income-hy', universe: 'us-broad', portfolioRole: 'income', manager: 'SPDR', isIndexFund: true, classificationConfidence: 91 },
  TIP:   { strategy: 'fixed-income-tip', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', manager: 'iShares', isIndexFund: true, classificationConfidence: 92 },
  SCHP:  { strategy: 'fixed-income-tip', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', manager: 'Schwab', isIndexFund: true, classificationConfidence: 92 },

  // ── Commodity ─────────────────────────────────────────────────────────────
  GLD:   { strategy: 'commodity-gold', universe: 'global', portfolioRole: 'inflation-hedge', behaviorProfile: 'commodity-linked', manager: 'SPDR', classificationConfidence: 92 },
  IAU:   { strategy: 'commodity-gold', universe: 'global', portfolioRole: 'inflation-hedge', behaviorProfile: 'commodity-linked', manager: 'iShares', classificationConfidence: 92 },
  SLV:   { strategy: 'commodity', subStrategy: 'silver', universe: 'global', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', manager: 'iShares', classificationConfidence: 88 },
  GDX:   { strategy: 'commodity-miners', universe: 'global', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', manager: 'VanEck', classificationConfidence: 85 },

  // ── Concentrated Equity / Hedge Fund Vehicles ─────────────────────────────
  'PSH.L':  { strategy: 'concentrated-equity', subStrategy: 'activist-value-concentrated', universe: 'global', portfolioRole: 'alternatives', behaviorProfile: 'event-driven', manager: 'Pershing Square', concentration: 'concentrated', benchmark: 'pershing-square-nav', classificationConfidence: 72 },
  PSHZF:    { strategy: 'concentrated-equity', subStrategy: 'activist-value-concentrated', universe: 'global', portfolioRole: 'alternatives', behaviorProfile: 'event-driven', manager: 'Pershing Square', concentration: 'concentrated', benchmark: 'pershing-square-nav', classificationConfidence: 72 },
  'BRK-B':  { strategy: 'concentrated-equity', subStrategy: 'value-conglomerate', universe: 'global', portfolioRole: 'alternatives', behaviorProfile: 'quality-compounder', manager: 'Berkshire Hathaway', concentration: 'concentrated', classificationConfidence: 75 },
  'BRK-A':  { strategy: 'concentrated-equity', subStrategy: 'value-conglomerate', universe: 'global', portfolioRole: 'alternatives', behaviorProfile: 'quality-compounder', manager: 'Berkshire Hathaway', concentration: 'concentrated', benchmark: 'brk-share-class', classificationConfidence: 75 },

  // ── Stocks — Digital Ads / Search ─────────────────────────────────────────
  GOOGL: { strategy: 'biz-digital-ads', subStrategy: 'search-cloud', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 78 },
  GOOG:  { strategy: 'biz-digital-ads', subStrategy: 'search-cloud', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], benchmark: 'googl-share-class', classificationConfidence: 78 },
  META:  { strategy: 'biz-digital-ads', subStrategy: 'social-advertising', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth', 'momentum'], classificationConfidence: 78 },

  // ── Stocks — Consumer Hardware ─────────────────────────────────────────────
  AAPL:  { strategy: 'biz-consumer-hardware', subStrategy: 'hardware-services-ecosystem', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 80 },
  SONY:  { strategy: 'biz-consumer-hardware', subStrategy: 'consumer-electronics', universe: 'global', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', factorTilts: ['value', 'growth'], classificationConfidence: 70 },

  // ── Stocks — Cloud Software / SaaS ────────────────────────────────────────
  MSFT:  { strategy: 'biz-cloud-software', subStrategy: 'enterprise-cloud-office', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 82 },
  CRM:   { strategy: 'biz-cloud-software', subStrategy: 'crm-saas', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth'], classificationConfidence: 78 },
  NOW:   { strategy: 'biz-cloud-software', subStrategy: 'enterprise-workflow-saas', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'quality-compounder', factorTilts: ['growth', 'quality'], classificationConfidence: 78 },
  ADBE:  { strategy: 'biz-cloud-software', subStrategy: 'creative-cloud-saas', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'quality-compounder', factorTilts: ['growth', 'quality'], classificationConfidence: 78 },
  SNOW:  { strategy: 'biz-cloud-software', subStrategy: 'data-cloud-saas', universe: 'us-large', portfolioRole: 'speculative', behaviorProfile: 'momentum-heavy', factorTilts: ['growth'], classificationConfidence: 75 },
  ORCL:  { strategy: 'biz-cloud-software', subStrategy: 'enterprise-db-cloud', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'value'], classificationConfidence: 75 },

  // ── Stocks — Cloud Infra / Platform ───────────────────────────────────────
  AMZN:  { strategy: 'biz-cloud-infra', subStrategy: 'ecommerce-aws', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth'], classificationConfidence: 78 },

  // ── Stocks — Semiconductors AI/GPU ────────────────────────────────────────
  NVDA:  { strategy: 'biz-semiconductor-ai', subStrategy: 'ai-gpu-datacenter', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth', 'momentum'], classificationConfidence: 85 },
  AVGO:  { strategy: 'biz-semiconductor-ai', subStrategy: 'ai-networking-chips', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth', 'quality'], classificationConfidence: 78 },

  // ── Stocks — Semiconductors CPU ───────────────────────────────────────────
  AMD:   { strategy: 'biz-semiconductor-cpu', subStrategy: 'cpu-gpu-datacenter', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth', 'momentum'], classificationConfidence: 82 },
  INTC:  { strategy: 'biz-semiconductor-cpu', subStrategy: 'cpu-foundry', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', factorTilts: ['value'], classificationConfidence: 78 },
  QCOM:  { strategy: 'biz-semiconductor-mobile', subStrategy: 'mobile-wireless-chips', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', factorTilts: ['value', 'quality'], classificationConfidence: 78 },

  // ── Stocks — Fintech / Payments ────────────────────────────────────────────
  V:     { strategy: 'biz-fintech-payments', subStrategy: 'card-network', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 82 },
  MA:    { strategy: 'biz-fintech-payments', subStrategy: 'card-network', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 82 },
  PYPL:  { strategy: 'biz-fintech-payments', subStrategy: 'digital-payments', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', factorTilts: ['growth'], classificationConfidence: 75 },

  // ── Stocks — Financials ────────────────────────────────────────────────────
  JPM:   { strategy: 'biz-bank-diversified', subStrategy: 'money-center-bank', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', factorTilts: ['value'], classificationConfidence: 82 },
  BAC:   { strategy: 'biz-bank-diversified', subStrategy: 'money-center-bank', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', factorTilts: ['value'], classificationConfidence: 82 },
  WFC:   { strategy: 'biz-bank-diversified', subStrategy: 'retail-commercial-bank', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', factorTilts: ['value'], classificationConfidence: 80 },
  GS:    { strategy: 'biz-investment-bank', subStrategy: 'bulge-bracket', universe: 'us-large', portfolioRole: 'speculative', behaviorProfile: 'cyclical', factorTilts: ['value'], classificationConfidence: 80 },
  MS:    { strategy: 'biz-investment-bank', subStrategy: 'bulge-bracket', universe: 'us-large', portfolioRole: 'speculative', behaviorProfile: 'cyclical', factorTilts: ['value'], classificationConfidence: 80 },
  BLK:   { strategy: 'biz-asset-mgmt', subStrategy: 'passive-active-mgmt', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 80 },
  TROW:  { strategy: 'biz-asset-mgmt', subStrategy: 'active-mgmt', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'value'], classificationConfidence: 78 },

  // ── Stocks — Healthcare ────────────────────────────────────────────────────
  UNH:   { strategy: 'biz-managed-care', subStrategy: 'managed-care-payer', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'quality-compounder', factorTilts: ['quality', 'growth'], classificationConfidence: 82 },
  CVS:   { strategy: 'biz-managed-care', subStrategy: 'managed-care-pharmacy', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', factorTilts: ['value', 'quality'], classificationConfidence: 75 },
  LLY:   { strategy: 'biz-pharma-large', subStrategy: 'innovative-pharma', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', factorTilts: ['growth', 'quality'], classificationConfidence: 80 },
  JNJ:   { strategy: 'biz-pharma-large', subStrategy: 'diversified-healthcare', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', factorTilts: ['quality', 'value'], classificationConfidence: 80 },
  PFE:   { strategy: 'biz-pharma-large', subStrategy: 'diversified-pharma', universe: 'us-large', portfolioRole: 'income', behaviorProfile: 'income-stable', factorTilts: ['value'], classificationConfidence: 78 },
  ABBV:  { strategy: 'biz-pharma-large', subStrategy: 'specialty-pharma', universe: 'us-large', portfolioRole: 'income', behaviorProfile: 'income-stable', factorTilts: ['value', 'quality'], classificationConfidence: 78 },

  // ── Crypto — Layer 1 Proof-of-Work ────────────────────────────────────────
  'BTC-USD': { strategy: 'crypto-btc', subStrategy: 'proof-of-work-store-of-value', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 85 },

  // ── Crypto — Layer 1 Smart Contract Platforms ─────────────────────────────
  'ETH-USD':   { strategy: 'crypto-layer1', subStrategy: 'evm-smart-contracts', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 82 },
  'SOL-USD':   { strategy: 'crypto-layer1', subStrategy: 'high-throughput-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 78 },
  'BNB-USD':   { strategy: 'crypto-layer1', subStrategy: 'exchange-chain', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 75 },
  'ADA-USD':   { strategy: 'crypto-layer1', subStrategy: 'peer-reviewed-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 72 },
  'AVAX-USD':  { strategy: 'crypto-layer1', subStrategy: 'subnet-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 72 },
  'XRP-USD':   { strategy: 'crypto-layer1', subStrategy: 'payments-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 70 },
  'DOT-USD':   { strategy: 'crypto-layer1', subStrategy: 'parachain-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 70 },
  'MATIC-USD': { strategy: 'crypto-layer1', subStrategy: 'evm-l2-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 70 },

  // ── Crypto — Layer 1 (additional) ────────────────────────────────────────
  'DOGE-USD': { strategy: 'crypto-layer1', subStrategy: 'meme-pow-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },
  'LTC-USD':  { strategy: 'crypto-layer1', subStrategy: 'payments-pow-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 68 },
  'ATOM-USD': { strategy: 'crypto-layer1', subStrategy: 'interchain-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 70 },
  'XLM-USD':  { strategy: 'crypto-layer1', subStrategy: 'payments-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },
  'ALGO-USD': { strategy: 'crypto-layer1', subStrategy: 'pure-pos-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },
  'NEAR-USD': { strategy: 'crypto-layer1', subStrategy: 'sharded-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 68 },
  'ARB11841-USD': { strategy: 'crypto-layer1', subStrategy: 'evm-l2', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 68 },
  'OP-USD':   { strategy: 'crypto-layer1', subStrategy: 'evm-l2', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 68 },
  'SUI20947-USD': { strategy: 'crypto-layer1', subStrategy: 'move-vm-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },
  'APT21794-USD': { strategy: 'crypto-layer1', subStrategy: 'move-vm-l1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },

  // ── Crypto — DeFi Tokens ──────────────────────────────────────────────────
  'LINK-USD': { strategy: 'crypto-defi', subStrategy: 'oracle-protocol', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 68 },
  'UNI7083-USD': { strategy: 'crypto-defi', subStrategy: 'dex-protocol', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },
  'AAVE-USD': { strategy: 'crypto-defi', subStrategy: 'lending-protocol', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 65 },
  'CRV-USD':  { strategy: 'crypto-defi', subStrategy: 'dex-protocol', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 62 },

  // ── Crypto — Stablecoins ──────────────────────────────────────────────────
  'USDT-USD': { strategy: 'crypto-stablecoin', subStrategy: 'fiat-backed', universe: 'crypto', portfolioRole: 'income', behaviorProfile: 'income-stable', classificationConfidence: 92 },
  'USDC-USD': { strategy: 'crypto-stablecoin', subStrategy: 'fiat-backed', universe: 'crypto', portfolioRole: 'income', behaviorProfile: 'income-stable', classificationConfidence: 92 },
  'DAI-USD':  { strategy: 'crypto-stablecoin', subStrategy: 'algorithmic-collateralized', universe: 'crypto', portfolioRole: 'income', behaviorProfile: 'income-stable', classificationConfidence: 88 },
  'BUSD-USD': { strategy: 'crypto-stablecoin', subStrategy: 'fiat-backed', universe: 'crypto', portfolioRole: 'income', behaviorProfile: 'income-stable', classificationConfidence: 85 },

  // ── First Trust — Factor / Dividend ───────────────────────────────────────
  DDIV:  { ...DG('momentum-dividend', 'First Trust'), factorTilts: ['momentum', 'quality', 'growth'] },
  TDIV:  FT('tech-nasdaq-dividend', 'sector-tech', 'sector-specific', 'core-income', 'momentum-heavy'),
  FDL:   HY('dividend-leaders', 'First Trust'),
  KNGZ:  DG('sp500-dividend-aristocrats', 'First Trust', 's&p500-dividend-aristocrats', ['quality']),
  FVD:   { ...DG('value-line-dividend', 'First Trust'), factorTilts: ['quality', 'low-vol'] },
  FTDS:  DG('dividend-strength', 'First Trust'),
  SDVY:  { ...DG('smid-rising-dividend', 'First Trust'), universe: 'us-small' },
  SHRY:  { ...DG('shareholder-yield', 'First Trust'), subStrategy: 'buyback-yield', factorTilts: ['value'] },
  FTC:   GR('large-cap-growth', 'First Trust'),
  FTA:   VA('First Trust'),
  FEX:   BL('First Trust', 'value-line-timeliness'),
  FAD:   { ...GR('multi-cap-growth', 'First Trust'), universe: 'us-broad' },
  FAB:   { ...VA('First Trust'), universe: 'us-broad' },
  FCFY:  { strategy: 'quality-blend', subStrategy: 'free-cash-flow', universe: 'us-large', portfolioRole: 'core', factorTilts: ['quality', 'value'], manager: 'First Trust', isIndexFund: true, classificationConfidence: 88 },
  FNY:   FT('mid-cap-growth', 'growth', 'us-mid', 'growth-satellite', 'momentum-heavy'),
  FNK:   FT('mid-cap-value', 'value', 'us-mid', 'core', 'cyclical'),
  FNX:   FT('mid-cap-core', 'blend-large', 'us-mid', 'core'),
  FYC:   FT('small-cap-growth', 'blend-small', 'us-small', 'growth-satellite', 'cyclical'),
  FYT:   FT('small-cap-value', 'blend-small', 'us-small', 'core', 'cyclical'),
  FYX:   FT('small-cap-core', 'blend-small', 'us-small', 'growth-satellite', 'cyclical'),
  FGD:   { ...DG('global-select-dividend', 'First Trust'), universe: 'global', portfolioRole: 'income' },
  FID:   { ...DG('intl-dividend-aristocrats', 'First Trust'), universe: 'intl-developed', portfolioRole: 'income' },
  FDD:   { ...DG('european-select-div', 'First Trust'), universe: 'intl-developed', portfolioRole: 'income' },

  // ── First Trust — Thematic / Technology ───────────────────────────────────
  FDN:   FT('internet-index', 'sector-tech'),
  FDNI:  FT('intl-internet', 'sector-tech', 'intl-developed'),
  SKYY:  FT('cloud-computing', 'sector-tech'),
  NXTG:  FT('5g-nextgen', 'sector-tech'),
  ISHP:  FT('ecommerce', 'sector-tech', 'global'),
  CIBR:  FT('cybersecurity', 'sector-tech'),
  ROBT:  FT('ai-robotics', 'sector-tech', 'global'),
  LEGR:  FT('blockchain', 'sector-tech', 'global', 'speculative', 'crypto-volatile'),
  ARVR:  FT('metaverse-arvr', 'sector-tech', 'global', 'speculative'),
  BNGE:  FT('gaming-streaming', 'sector-tech', 'global'),
  FTXL:  FT('semiconductors-alphaDEX', 'sector-tech'),
  CARZ:  FT('future-vehicles', 'sector-tech', 'global'),
  QTEC:  FT('nasdaq-100-tech', 'sector-tech'),

  // ── First Trust — Healthcare ───────────────────────────────────────────────
  FBT:   FT('biotech', 'sector-health', 'sector-specific', 'growth-satellite', 'momentum-heavy'),
  FTXH:  FT('pharma-alphaDEX', 'sector-health', 'sector-specific', 'defensive', 'defensive'),
  MDEV:  FT('medical-devices', 'sector-health', 'sector-specific', 'defensive', 'defensive'),
  EKG:   FT('digital-health', 'sector-health', 'global', 'growth-satellite', 'momentum-heavy'),

  // ── First Trust — Energy / Industrials / Commodities ─────────────────────
  QCLN:  FT('clean-energy', 'sector-energy', 'global', 'growth-satellite', 'momentum-heavy'),
  FAN:   FT('wind-energy', 'sector-energy', 'global', 'speculative', 'commodity-linked'),
  GRID:  FT('smart-grid', 'sector-energy', 'sector-specific', 'growth-satellite', 'momentum-heavy'),
  FIW:   FT('water', 'commodity', 'us-broad', 'inflation-hedge', 'commodity-linked'),
  RBLD:  FT('nextgen-infra', 'sector-energy', 'us-broad', 'core', 'cyclical'),
  AIRR:  FT('american-industrial', 'sector-energy', 'us-broad', 'core', 'cyclical'),
  FTRI:  FT('natural-resources', 'commodity', 'global', 'inflation-hedge', 'commodity-linked'),
  FTAG:  FT('agriculture', 'commodity', 'global', 'inflation-hedge', 'commodity-linked'),
  FCG:   FT('natural-gas', 'sector-energy', 'us-broad', 'speculative', 'commodity-linked'),
  FTXN:  FT('energy-alphaDEX', 'sector-energy', 'sector-specific', 'speculative', 'commodity-linked'),
  MISL:  FT('aero-defense', 'sector-energy', 'us-broad', 'core', 'cyclical'),

  // ── First Trust — Sectors ──────────────────────────────────────────────────
  FTXG:  FT('consumer-staples-alphaDEX', 'sector-staples', 'sector-specific', 'defensive', 'defensive'),
  QABA:  FT('community-banks', 'sector-fin', 'sector-specific', 'core', 'cyclical'),
  FTXO:  FT('bank-alphaDEX', 'sector-fin', 'sector-specific', 'core', 'cyclical'),
  FTXR:  FT('retail-alphaDEX', 'sector-staples', 'sector-specific', 'core', 'cyclical'),
  FRI:   FT('core-reit', 'real-estate', 'us-broad', 'inflation-hedge', 'rate-sensitive'),
  DTRE:  FT('disruptive-re', 'real-estate', 'us-broad', 'growth-satellite', 'momentum-heavy'),

  // ── First Trust — AlphaDEX International ─────────────────────────────────
  FDT:   FTI('developed-ex-us-value'),
  FDTS:  FTI('intl-small-cap', 'blend-small'),
  FEM:   FTI('em-alphaDEX', 'emerging', 'emerging'),
  FEMS:  FTI('em-small-cap', 'emerging', 'emerging'),
  FPA:   FTI('asia-pac-ex-japan'),
  FEP:   FTI('europe'),
  FEUZ:  FTI('eurozone'),
  FCA:   FTI('canada'),
  FGM:   FTI('germany'),
  FJP:   FTI('japan'),

  // ── First Trust — Global International ───────────────────────────────────
  RNEM:  FTI('em-equity', 'emerging', 'emerging'),
  IFV:   { ...FTI('intl-multi-asset-value', 'intl-developed', 'global'), factorTilts: ['value'] },
  NFTY:  FTI('india-nifty50', 'emerging', 'emerging'),
  FICS:  FT('intl-corp-bond', 'fixed-income-core', 'global', 'fixed-income', 'rate-sensitive'),
  FPXI:  FT('intl-ipo', 'intl-developed', 'intl-developed', 'growth-satellite', 'momentum-heavy'),
  FPXE:  FT('em-ipo', 'emerging', 'emerging', 'speculative', 'momentum-heavy'),
  EMDM:  FT('em-dividend', 'emerging', 'emerging', 'income', 'income-stable'),
  FTHF:  FTI('hedged-developed'),
}

// Curated peer lists for First Trust ETFs and CT funds (updated from Evolve peers taxonomy)
export const STATIC_PEERS: Record<string, string[]> = {
  // Factores
  DDIV:  ['QDF', 'LRGF', 'QUS', 'DGRW', 'TILT'],
  TDIV:  ['CLOU', 'KNCT', 'DAT', 'CHPX', 'IXN'],
  RDVY:  ['VIG', 'JQUA', 'RSP', 'QUAL', 'SPHQ'],
  FDL:   ['SCHD', 'HDV', 'WBIY', 'VYM', 'RDIV'],
  KNGZ:  ['QDPL', 'SDOG', 'DLN', 'DJD', 'NOBL'],
  FVD:   ['FDVV', 'DVY', 'SDY', 'VYM', 'SPYD'],
  FTDS:  ['FQAL', 'DIVB', 'QUAL', 'MOAT', 'PKW'],
  SDVY:  ['SPSM', 'FSMD', 'DES', 'XSVM', 'IWM'],
  SHRY:  ['PFM', 'DTD', 'DGRO', 'VIG', 'DURA'],
  FTC:   ['VUG', 'VONG', 'IWF', 'MGK', 'SCHG'],
  FTA:   ['MGV', 'VTV', 'VONV', 'SCHV', 'IWD'],
  FEX:   ['RECS', 'OMFL', 'GSLC', 'COWZ', 'VFLO'],
  FAD:   ['ILCG', 'GARP', 'BUL', 'IUSG', 'QGRO'],
  FAB:   ['VLUE', 'IUSV', 'ILCV', 'VLU', 'MVAL'],
  FCFY:  ['FNDX', 'RWL', 'PRF', 'SPHQ', 'RDVY'],
  FNY:   ['IJK', 'QMID', 'IWP', 'VOT', 'IMCG'],
  FNK:   ['IWS', 'MDYV', 'VOE', 'IJJ', 'XMVM'],
  FNX:   ['JPME', 'XMHQ', 'JHMM', 'QVMM', 'FLQM'],
  FYC:   ['QSML', 'VBK', 'IWO', 'VTWG', 'CAFG'],
  FYT:   ['IWN', 'XSVM', 'SVAL', 'VBR', 'VTWV'],
  FYX:   ['GSSC', 'SMLF', 'CALF', 'OUSM', 'NUSC'],
  FGD:   ['FDVV', 'QQQ', 'SPY', 'VOO', 'DIA'],
  FID:   ['DWX', 'BIDD', 'SCHY', 'VYMI', 'IDVZ'],
  FDD:   ['FEZ', 'IEV', 'QQQ', 'SPY', 'VOO'],
  // Tematicos
  FDN:   ['PNQI', 'QQQ', 'SPY', 'VOO', 'DIA'],
  FDNI:  ['ARKW', 'OGIG', 'FMET', 'METV'],
  SKYY:  ['WCLD', 'XSW', 'QQQ', 'SPY', 'VOO'],
  NXTG:  ['WUGI', 'QQQ', 'SPY', 'VOO', 'DIA'],
  ISHP:  ['FDIG', 'SOCL', 'DAPP', 'SATO', 'TRFK'],
  CIBR:  ['BUG', 'PSWD', 'WCBR', 'IHAK', 'HACK'],
  ROBT:  ['WTAI', 'KOID', 'AIVC', 'PRNT', 'ROBO'],
  LEGR:  ['IBLC', 'MNRS', 'BKCH', 'WGMI', 'BLOK'],
  ARVR:  ['OGIG', 'FMET', 'FMQQ', 'METV'],
  BNGE:  ['NERD', 'GAMR', 'HERO', 'ODDS', 'ESPO'],
  FBT:   ['BBP', 'SBIO', 'IBB', 'PBE', 'XBI'],
  FTXH:  ['PJP', 'XPH', 'IHE', 'QQQ', 'SPY'],
  MDEV:  ['GDOC', 'HTEC', 'EKG', 'LGHT'],
  EKG:   ['QQQ', 'SPY', 'VOO', 'DIA'],
  QCLN:  ['CNRG', 'CTEX', 'ACES', 'QQQ', 'SPY'],
  FAN:   ['TAN', 'PBD', 'ICLN', 'RNRG', 'PBW'],
  GRID:  ['XLU', 'XLI', 'PAVE', 'ICLN', 'IGF'],
  FIW:   ['PHO', 'QQQ', 'SPY', 'VOO', 'DIA'],
  RBLD:  ['ELFY', 'PAVE', 'SIMS', 'POWR', 'ZAP'],
  AIRR:  ['VIS', 'PRN', 'XLI', 'IYJ', 'XLII'],
  FTXL:  ['AMDY', 'PSI', 'NVDY', 'SOXY', 'SHOC'],
  FTRI:  ['MGNR', 'NDIV', 'GNR', 'GUNR', 'HAP'],
  FTAG:  ['MOO', 'VEGI', 'KROP', 'QQQ', 'SPY'],
  CARZ:  ['DRIV', 'BATT', 'HYDR', 'IDRV', 'LIT'],
  DTRE:  ['WTRE', 'RWO', 'DTCR', 'GQRE', 'DFGR'],
  // Sector / Industry
  FTXG:  ['PBJ', 'QQQ', 'SPY', 'VOO', 'DIA'],
  FCG:   ['DRLL', 'PXE', 'LNGX', 'XOP', 'USNG'],
  FTXN:  ['XLE', 'PXI', 'VDE', 'FXN', 'XLEI'],
  QABA:  ['KRE', 'IAT', 'QQQ', 'SPY', 'VOO'],
  FTXO:  ['KBWB', 'QQQ', 'SPY', 'VOO', 'DIA'],
  FTXR:  ['XTN', 'IYT', 'QQQ', 'SPY', 'VOO'],
  FRI:   ['RWR', 'NURE', 'USRT', 'BBRE', 'SCHH'],
  QTEC:  ['XNTK', 'IYW', 'XLK', 'RSPT', 'VGT'],
  MISL:  ['PPA', 'ITA', 'DUTY', 'TSSD', 'XAR'],
  // AlphaDEX Global / International
  FDT:   ['VEA', 'EPIN', 'EFA', 'KEMX'],
  FDTS:  ['SCHC', 'DFIS', 'GWX', 'VSS', 'AVDV'],
  FEM:   ['VWO', 'IEMG', 'EEM', 'EMEQ', 'EMSF'],
  FEMS:  ['AVEE', 'DGS', 'EEMS', 'VWO', 'IEMG'],
  FPA:   ['BBAX', 'EPP', 'VPL', 'EWY'],
  FEP:   ['VGK', 'OPPE', 'ENOR'],
  FEUZ:  ['VGK', 'OPPE', 'ENOR'],
  FCA:   ['FLCH', 'MCHI', 'ASHR', 'MCHS', 'KWEB'],
  FGM:   ['FLGR', 'EWG', 'VGK', 'ENOR'],
  FJP:   ['FLJH', 'EWJ', 'OPPJ', 'FLJP'],
  // Global International
  RNEM:  ['VWO', 'IEMG', 'EEM', 'EMEQ', 'EMSF'],
  IFV:   ['VEU', 'VXUS', 'PATN', 'SPGM', 'AVDE'],
  NFTY:  ['INDH', 'INDY', 'VPL', 'EWY'],
  FICS:  ['VEA', 'FDT', 'SPGM', 'AVDE', 'EWC'],
  FPXI:  ['VEU', 'VXUS', 'PATN', 'VEA', 'EFA'],
  FPXE:  ['VGK', 'OPPE', 'ENOR'],
  EMDM:  ['VWO', 'IEMG', 'EEM', 'EMEQ', 'TETH'],
  FTHF:  ['VWO', 'IEMG', 'EEM', 'EMEQ', 'TETH'],
  // Broad market ETFs & indices
  '^GSPC': ['IVV', 'VOO', 'SPY'],
  '^RUT':  ['IWM', 'VTWO', 'SWMK'],
  '^IXIC': ['QQQ', 'ONEQ', 'QQQM'],
  ACWI:  ['VT', 'VWRD', 'SSAC'],
  RECS:  ['QUAL', 'VQLT', 'SUSA'],
  IJR:   ['VIOO', 'SPSM', 'SCHA'],
  FAI:   ['FXL', 'XNTK', 'IYW'],
  // Japan
  EWJ:   ['BBJP', 'VJPN', 'FLJP'],
  DXJ:   ['HEWJ', 'DBJP', 'HJPX'],
  // Europe
  IEUR:  ['VGK', 'EZU', 'BBEU'],
  VGK:   ['IEUR', 'SPEU', 'FVEU'],
  // Emerging Markets
  XCEM:  ['EMXC', 'EMXF', 'KEMX'],
  EMXC:  ['XCEM', 'RNEM', 'KEMX'],
  MCHI:  ['FXI', 'GXC', 'KWEB'],
  // CT funds — UCITS mutual fund peers (all verified via Yahoo Finance API)
  // BGF Next Gen Tech (Frankfurt), Polar Capital Global Tech, JPM Pacific Tech, AB Intl Tech
  '0P0000NCAC':   ['0P0001FCAF.F', '0P0000M892', '0P00001DU6', '0P00000I4D'],
  // Ninety One American, Loomis Sayles US Growth, JPM America Equity
  '0P00000XBQ.L': ['0P00009DS2', '0P000186RT', '0P000019D5'],
  // Wellington Global Quality, MS INVF Global Brands, Ninety One GSF, PineBridge, Janus Henderson, JPM Global Select, AB Sustainable
  '0P0001CZXM.L': ['0P0000TJ9P', '0P0001IG5T', '0P0001IC7Y', '0P00000ROA', '0P0001HNBU', '0P00000DS4', '0P0000SAOI'],
  // BGF Japan Flexible Equity (Tokyo), Jupiter Japan Select (Frankfurt), JPM Japan Equity (OTC)
  '0P00000R12.L': ['0P0000PXXB.T', '0P00015NXL.F', '0P00011GXW'],
  // BSF European Absolute Return (Frankfurt), JPM Europe Select Equity (Frankfurt)
  '0P00000R0U.L': ['0P0000JCSG.F', '0P0000611O.F'],
  // Pershing Square holdings & proxies
  PSH:   ['GURU', 'ALFA', 'BRK-B'],
  PSUS:  ['GURU', 'ALFA', 'BRK-B'],
  HHH:   ['TPL', 'BXP', 'VNO'],
  BN:    ['BX', 'KKR', 'APO'],
  GOOG:  ['META', 'AMZN', 'TTD'],
  META:  ['GOOGL', 'SNAP', 'PINS'],
  AMZN:  ['MELI', 'WMT', 'BABA'],
  UBER:  ['LYFT', 'DASH', 'BKNG'],
  UMGNF: ['WMG', 'SONY', 'SPOT'],
  QSR:   ['MCD', 'YUM', 'DPZ'],
  HTZ:   ['CAR', 'UAL', 'CPRT'],
  FNMA:  ['NLY', 'AGNC', 'PFF'],
  FMCC:  ['RITM', 'TWO', 'PGX'],
  SEG:   ['COWZ', 'FNDX', 'QUAL'],
}

export function classifyAsset(ticker: string): AssetClassification | null {
  const upper = ticker.toUpperCase()
  return TAXONOMY[upper] ?? TAXONOMY[`${upper}-USD`] ?? null
}

// Infers classification from DB metadata fields when ticker is not in the static taxonomy.
// Returns null for stocks without sector data (not enough signal).
function classifyFromMetadata(asset: AssetMetadata): AssetClassification | null {
  const type = asset.type
  const sector = (asset.sector ?? '').toLowerCase()
  const industry = (asset.industry ?? '').toLowerCase()
  const name = (asset.name ?? '').toLowerCase()
  const ticker = asset.ticker.toUpperCase()

  if (type === 'crypto') {
    if (name.includes('stable') || name.includes('usd coin') || ticker.startsWith('USDT') || ticker.startsWith('USDC') || ticker.startsWith('BUSD') || ticker.startsWith('DAI')) {
      return { strategy: 'crypto-stablecoin', universe: 'crypto', portfolioRole: 'income', behaviorProfile: 'income-stable', classificationConfidence: 55 }
    }
    if (ticker === 'BTC' || ticker === 'BTC-USD' || name.includes('bitcoin')) {
      return { strategy: 'crypto-btc', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 68 }
    }
    if (name.includes('defi') || name.includes('swap') || name.includes('protocol') || name.includes('aave') || name.includes('uniswap') || name.includes('curve') || name.includes('chainlink')) {
      return { strategy: 'crypto-defi', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 52 }
    }
    return { strategy: 'crypto-layer1', universe: 'crypto', portfolioRole: 'speculative', behaviorProfile: 'crypto-volatile', classificationConfidence: 50 }
  }

  if (type === 'etf' || type === 'fund') {
    if (name.includes('bond') || name.includes('treasury') || name.includes('aggregate') || name.includes('credit') || name.includes('fixed income')) {
      if (name.includes('high yield') || name.includes('junk')) return { strategy: 'fixed-income-hy', universe: 'us-broad', portfolioRole: 'income', classificationConfidence: 52 }
      if (name.includes('tip') || name.includes('inflation')) return { strategy: 'fixed-income-tip', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', classificationConfidence: 55 }
      return { strategy: 'fixed-income-core', universe: 'us-broad', portfolioRole: 'fixed-income', behaviorProfile: 'rate-sensitive', classificationConfidence: 52 }
    }
    if (name.includes('gold') || name.includes('silver') || name.includes('precious')) return { strategy: 'commodity-gold', universe: 'global', portfolioRole: 'inflation-hedge', behaviorProfile: 'commodity-linked', classificationConfidence: 55 }
    if (name.includes('commodit') || name.includes('miner')) return { strategy: 'commodity', universe: 'global', portfolioRole: 'inflation-hedge', behaviorProfile: 'commodity-linked', classificationConfidence: 50 }
    if (name.includes('emerging')) return { strategy: 'emerging', universe: 'emerging', portfolioRole: 'international', classificationConfidence: 52 }
    if (name.includes('international') || name.includes('global') || name.includes('world') || name.includes('developed ex')) return { strategy: 'intl-developed', universe: 'intl-developed', portfolioRole: 'international', classificationConfidence: 50 }
    if (name.includes('reit') || name.includes('real estate') || sector.includes('real estate')) return { strategy: 'real-estate', universe: 'us-broad', portfolioRole: 'inflation-hedge', behaviorProfile: 'rate-sensitive', classificationConfidence: 52 }
    if (sector.includes('technology') || name.includes('technology') || name.includes('nasdaq')) return { strategy: 'sector-tech', universe: 'sector-specific', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', classificationConfidence: 52 }
    if (sector.includes('health') || name.includes('health') || name.includes('biotech') || name.includes('pharma')) return { strategy: 'sector-health', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'defensive', classificationConfidence: 52 }
    if (sector.includes('financial') || name.includes('financial') || name.includes('bank')) return { strategy: 'sector-fin', universe: 'sector-specific', portfolioRole: 'core', behaviorProfile: 'cyclical', classificationConfidence: 50 }
    if (sector.includes('energy') || name.includes('energy') || name.includes('oil')) return { strategy: 'sector-energy', universe: 'sector-specific', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', classificationConfidence: 50 }
    if (sector.includes('utilities') || name.includes('utilit')) return { strategy: 'sector-util', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'rate-sensitive', classificationConfidence: 50 }
    if (sector.includes('staples') || name.includes('staple')) return { strategy: 'sector-staples', universe: 'sector-specific', portfolioRole: 'defensive', behaviorProfile: 'defensive', classificationConfidence: 50 }
    if (name.includes('dividend') && (name.includes('growth') || name.includes('appreciat') || name.includes('aristocrat'))) return { strategy: 'dividend-growth', universe: 'us-large', portfolioRole: 'core-income', behaviorProfile: 'income-stable', factorTilts: ['quality'], classificationConfidence: 52 }
    if (name.includes('dividend') || name.includes('yield') || name.includes('income')) return { strategy: 'high-yield', universe: 'us-large', portfolioRole: 'income', behaviorProfile: 'income-stable', classificationConfidence: 50 }
    if (name.includes('growth')) return { strategy: 'growth', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', classificationConfidence: 50 }
    if (name.includes('value')) return { strategy: 'value', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', classificationConfidence: 50 }
    if (name.includes('small')) return { strategy: 'blend-small', universe: 'us-small', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', classificationConfidence: 50 }
    return { strategy: 'blend-large', universe: 'us-large', portfolioRole: 'core', classificationConfidence: 45 }
  }

  if (type === 'stock') {
    if (sector.includes('technology') || sector.includes('information technology')) {
      if (industry.includes('semiconductor')) return { strategy: 'biz-semiconductor-ai', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', classificationConfidence: 50 }
      if (industry.includes('software')) return { strategy: 'biz-cloud-software', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'quality-compounder', classificationConfidence: 50 }
      if (industry.includes('internet') || industry.includes('interactive')) return { strategy: 'biz-platform', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', classificationConfidence: 48 }
      return { strategy: 'sector-tech', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', classificationConfidence: 45 }
    }
    if (sector.includes('communication') || sector.includes('media')) {
      if (industry.includes('advertising') || industry.includes('search') || industry.includes('social')) return { strategy: 'biz-digital-ads', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'momentum-heavy', classificationConfidence: 50 }
      return { strategy: 'biz-platform', universe: 'us-large', portfolioRole: 'growth-satellite', behaviorProfile: 'cyclical', classificationConfidence: 45 }
    }
    if (sector.includes('health')) {
      if (industry.includes('managed care') || industry.includes('insurance')) return { strategy: 'biz-managed-care', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', classificationConfidence: 50 }
      if (industry.includes('pharma') || industry.includes('drug') || industry.includes('biotech')) return { strategy: 'biz-pharma-large', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', classificationConfidence: 50 }
      return { strategy: 'sector-health', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', classificationConfidence: 45 }
    }
    if (sector.includes('financial')) {
      if (industry.includes('capital market') || industry.includes('investment bank')) return { strategy: 'biz-investment-bank', universe: 'us-large', portfolioRole: 'speculative', behaviorProfile: 'cyclical', classificationConfidence: 50 }
      if (industry.includes('asset') || industry.includes('investment management')) return { strategy: 'biz-asset-mgmt', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', classificationConfidence: 50 }
      if (industry.includes('payment') || industry.includes('fintech') || industry.includes('data processing')) return { strategy: 'biz-fintech-payments', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'quality-compounder', classificationConfidence: 50 }
      return { strategy: 'biz-bank-diversified', universe: 'us-large', portfolioRole: 'core', behaviorProfile: 'cyclical', classificationConfidence: 45 }
    }
    if (sector.includes('energy')) return { strategy: 'sector-energy', universe: 'us-large', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', classificationConfidence: 50 }
    if (sector.includes('staples') || sector.includes('consumer staple')) return { strategy: 'sector-staples', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'defensive', classificationConfidence: 50 }
    if (sector.includes('real estate')) return { strategy: 'real-estate', universe: 'us-large', portfolioRole: 'income', behaviorProfile: 'rate-sensitive', classificationConfidence: 50 }
    if (sector.includes('utilit')) return { strategy: 'sector-util', universe: 'us-large', portfolioRole: 'defensive', behaviorProfile: 'rate-sensitive', classificationConfidence: 50 }
    if (sector.includes('material')) return { strategy: 'commodity', universe: 'global', portfolioRole: 'speculative', behaviorProfile: 'commodity-linked', classificationConfidence: 42 }
    return null
  }

  if (type === 'index') {
    return { strategy: 'blend-large', universe: 'us-broad', portfolioRole: 'core', classificationConfidence: 48 }
  }

  return null
}

export function scorePeerSimilarity(a: AssetClassification, b: AssetClassification): number {
  // Hard exclusions
  if (a.benchmark && b.benchmark && a.benchmark === b.benchmark) return 0
  if (a.manager && b.manager && a.manager === b.manager && a.strategy === b.strategy) return 0

  let score = 0

  // 1. Strategy (40 pts)
  if (a.strategy === b.strategy) {
    score += 40
  } else if (STRATEGY_ADJACENCY[a.strategy]?.includes(b.strategy)) {
    score += 20
  } else {
    return 0
  }

  // 2. SubStrategy (20 pts exact, 5 partial when both defined but differ)
  if (a.subStrategy && b.subStrategy) {
    score += a.subStrategy === b.subStrategy ? 20 : 5
  } else {
    score += 10
  }

  // 3. Portfolio role (15 pts)
  if (a.portfolioRole === b.portfolioRole) {
    score += 15
  } else if (ROLE_ADJACENCY[a.portfolioRole]?.includes(b.portfolioRole)) {
    score += 7
  }

  // 4. Universe (10 pts)
  if (a.universe === b.universe) score += 10
  else if (isAdjacentUniverse(a.universe, b.universe)) score += 5

  // 5. Factor tilts overlap (10 pts)
  if (a.factorTilts && b.factorTilts && a.factorTilts.length > 0 && b.factorTilts.length > 0) {
    const overlap = a.factorTilts.filter((f) => b.factorTilts!.includes(f)).length
    const maxLen = Math.max(a.factorTilts.length, b.factorTilts.length)
    score += Math.round((overlap / maxLen) * 10)
  } else {
    score += 5
  }

  // 6. Behavior profile (5 pts)
  if (a.behaviorProfile && b.behaviorProfile && a.behaviorProfile === b.behaviorProfile) {
    score += 5
  }

  return Math.min(score, 100)
}

export function computeInitialPeers(
  selectedAsset: AssetMetadata,
  allAssets: AssetMetadata[]
): AssetMetadata[] {
  const assetMap = new Map<string, AssetMetadata>(allAssets.map((a) => [a.ticker.toUpperCase(), a]))
  const upperTicker = selectedAsset.ticker.toUpperCase()

  // Use curated static peers when available (FT ETFs)
  const staticPeerTickers = STATIC_PEERS[upperTicker]
  if (staticPeerTickers) {
    return staticPeerTickers.map((t) => {
      const dbAsset = assetMap.get(t.toUpperCase())
      if (dbAsset) return dbAsset
      const tc = TAXONOMY[t.toUpperCase()]
      return {
        ticker: t, name: t,
        type: (tc?.universe === 'crypto' ? 'crypto' : 'etf') as AssetMetadata['type'],
        sector: null, region: null, industry: null,
        benchmark: tc?.benchmark ?? null, manager: tc?.manager ?? null,
      }
    })
  }

  // Fallback: algorithmic peer computation from taxonomy
  const selectedClass = classifyAsset(selectedAsset.ticker) ?? classifyFromMetadata(selectedAsset)
  if (!selectedClass) return []

  // Score every ticker in the taxonomy — candidates come from taxonomy, not from allAssets
  const scored = Object.entries(TAXONOMY)
    .filter(([ticker]) => ticker.toUpperCase() !== selectedAsset.ticker.toUpperCase())
    .map(([ticker, candidateClass]) => ({
      ticker,
      candidateClass,
      score: scorePeerSimilarity(selectedClass, candidateClass),
    }))
    .filter(({ score }) => score >= 60)
    .sort((a, b) => b.score - a.score)

  // Deduplicate by manager — keep highest-scoring per manager
  const seenManagers = new Set<string>()
  const result: AssetMetadata[] = []

  for (const { ticker, candidateClass } of scored) {
    const mgr = candidateClass.manager ?? null
    if (mgr) {
      if (seenManagers.has(mgr)) continue
      seenManagers.add(mgr)
    }

    // Use DB record when available (has full name), otherwise construct minimal from taxonomy
    const dbAsset = assetMap.get(ticker.toUpperCase())
    result.push(
      dbAsset ?? {
        ticker,
        name: ticker,
        type: candidateClass.universe === 'crypto' ? 'crypto'
              : candidateClass.isIndexFund ? 'etf'
              : 'stock',
        sector: null,
        region: null,
        industry: null,
        benchmark: candidateClass.benchmark ?? null,
        manager: candidateClass.manager ?? null,
      }
    )

    if (result.length >= 8) break
  }

  return result
}
