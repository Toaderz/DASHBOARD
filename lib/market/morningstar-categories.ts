// ─── Morningstar US Category → Global Category mapping ────────────────────────
// Shared across the fundamentals pipeline (finnhub.ts) and the peer-similarity
// engine (peer-taxonomy.ts). Keep this as the single source of truth.

export const MS_GLOBAL_CATEGORY: Record<string, string> = {
  'Large Blend':                'US Large-Cap Blend Equity',
  'Large Growth':               'US Large-Cap Growth Equity',
  'Large Value':                'US Large-Cap Value Equity',
  'Mid-Cap Blend':              'US Mid-Cap Blend Equity',
  'Mid-Cap Growth':             'US Mid-Cap Growth Equity',
  'Mid-Cap Value':              'US Mid-Cap Value Equity',
  'Small Blend':                'US Small-Cap Blend Equity',
  'Small Growth':               'US Small-Cap Growth Equity',
  'Small Value':                'US Small-Cap Value Equity',
  'Foreign Large Blend':        'Global Large-Cap Blend Equity',
  'Foreign Large Growth':       'Global Large-Cap Growth Equity',
  'Foreign Large Value':        'Global Large-Cap Value Equity',
  'Foreign Small/Mid Blend':    'Global Small/Mid-Cap Blend Equity',
  'World Large-Stock Blend':    'Global Large-Cap Blend Equity',
  'World Large-Stock Growth':   'Global Large-Cap Growth Equity',
  'Diversified Emerging Mkts':  'Global Emerging Markets Equity',
  'China Region':               'Greater China Equity',
  'Japan Stock':                'Japan Large-Cap Equity',
  'Europe Stock':               'Europe Large-Cap Blend Equity',
  'India Equity':               'India Equity',
  'Technology':                 'Technology Equity',
  'Technology Sector Equity':   'Technology Equity',
  'Health':                     'Healthcare Equity',
  'Healthcare':                 'Healthcare Equity',
  'Real Estate':                'Real Estate Equity',
  'Utilities':                  'Utilities Equity',
  'Natural Resources':          'Natural Resources Equity',
  'Infrastructure':             'Infrastructure Equity',
  'Energy Limited Partnership': 'Energy Equity',
  'Financial':                  'Financial Services Equity',
  'Industrials':                'Industrials Equity',
  'Communication':              'Communication Services Equity',
  'Consumer Cyclical':          'Consumer Goods & Services Equity',
  'Equity Income':              'Global Equity Income',
}

export function toGlobalCategory(msCategory: string | null | undefined): string | null {
  if (!msCategory) return null
  return MS_GLOBAL_CATEGORY[msCategory] ?? msCategory
}
