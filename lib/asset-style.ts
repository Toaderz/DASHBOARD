import type { AssetType } from '@/types'

// Shared asset-type labels + badge classes. Single source so AssetDetailModal and
// TickerSearch stay consistent. ETF recolored off purple → brand teal/petróleo.
export const TYPE_LABELS: Record<AssetType, string> = {
  stock: 'Stock',
  etf: 'ETF',
  index: 'Index',
  fund: 'Fund',
  crypto: 'Crypto',
}

export const TYPE_BADGE: Record<AssetType, string> = {
  stock:  'bg-electric/10 text-electric',
  etf:    'bg-brand-teal/15 text-brand-teal dark:text-chart-5',
  index:  'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  fund:   'bg-chart-3/15 text-chart-3 dark:text-chart-4',
  crypto: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
}

export function typeLabel(type: AssetType): string {
  return TYPE_LABELS[type] ?? type
}

export function typeBadgeClass(type: AssetType): string {
  return TYPE_BADGE[type] ?? TYPE_BADGE.stock
}
