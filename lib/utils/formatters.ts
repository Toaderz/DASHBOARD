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

export function formatMarketCap(value: number | undefined | null): string {
  if (value == null) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toFixed(0)}`
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

// Converts a cumulative return (%) over `years` to annualized CAGR (%)
export function annualizeReturn(value: number | null | undefined, years: number): number | null {
  if (value == null) return null
  return (Math.pow(1 + value / 100, 1 / years) - 1) * 100
}

export function percentColor(value: number | undefined | null): string {
  if (value == null) return 'text-muted-foreground'
  if (value > 0) return 'text-green-500'
  if (value < 0) return 'text-red-500'
  return 'text-muted-foreground'
}
