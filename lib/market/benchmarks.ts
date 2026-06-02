// Global benchmark tickers shown in the header marquee and reused by the Overview
// market snapshot. Single source of truth so both stay in sync.
export const BENCHMARK_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'BND', 'DX-Y.NYB', 'CL=F', 'GC=F', 'BTC-USD',
] as const

// Friendly labels for the Overview snapshot (marquee shows raw tickers).
export const BENCHMARK_LABELS: Record<string, string> = {
  SPY: 'S&P 500',
  QQQ: 'Nasdaq 100',
  IWM: 'Russell 2000',
  GLD: 'Gold',
  TLT: '20Y Treasuries',
  BND: 'US Agg Bonds',
  'DX-Y.NYB': 'Dollar Index',
  'CL=F': 'Crude Oil',
  'GC=F': 'Gold Futures',
  'BTC-USD': 'Bitcoin',
}
