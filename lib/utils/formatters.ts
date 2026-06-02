export function formatPrice(value: number | undefined | null, currency = 'USD'): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number | undefined | null, decimals = 2): string {
  if (value == null) return '—'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', GBP: '£', GBX: '£', EUR: '€', JPY: '¥',
  CHF: 'Fr', CAD: 'C$', AUD: 'A$', HKD: 'HK$',
}

export function getCurrencySymbol(currency?: string | null): string {
  return CURRENCY_SYMBOLS[currency ?? ''] ?? '$'
}

export function formatMarketCap(value: number | undefined | null, symbol = '$'): string {
  if (value == null) return '—'
  if (value >= 1e12) return `${symbol}${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `${symbol}${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M`
  return `${symbol}${value.toFixed(0)}`
}

export function formatRatio(value: number | undefined | null): string {
  if (value == null) return '—'
  return value.toFixed(2)
}

export function formatVolume(value: number | undefined | null): string {
  if (value == null) return '—'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(value)
}

// Converts a cumulative return (%) over `years` to annualized CAGR (%).
// Requires at least 1 full year of data — sub-annual CAGR is mathematically
// explosive and misleading (e.g. 20% over 0.1 yr → 520% annualized).
export function annualizeReturn(value: number | null | undefined, years: number): number | null {
  if (value == null || years < 1) return null
  return (Math.pow(1 + value / 100, 1 / years) - 1) * 100
}

export function formatExpenseRatio(value: number | undefined | null): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(2)}%`
}

export function percentColor(value: number | undefined | null): string {
  if (value == null) return 'text-muted-foreground'
  if (value > 0) return 'text-gain'
  if (value < 0) return 'text-loss'
  return 'text-muted-foreground'
}
