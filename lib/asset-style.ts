import type { AssetType } from '@/types'

// Shared asset-type labels + badge classes. Single source so AssetDetailModal and
// TickerSearch stay consistent.
// V2 "color escaso = caro": stock/etf/fund are bone-neutral chips differentiated by
// their TEXT label (not color) — a watchlist of N ETFs no longer floods the most-used
// view with teal. Teal stays reserved for the ~4 high-signal spots. index/crypto keep
// their rare semantic amber/orange.
export const TYPE_LABELS: Record<AssetType, string> = {
  stock: 'Stock',
  etf: 'ETF',
  index: 'Index',
  fund: 'Fund',
  crypto: 'Crypto',
}

export const TYPE_BADGE: Record<AssetType, string> = {
  stock:  'bg-foreground/10 text-foreground',
  etf:    'bg-foreground/10 text-foreground',
  index:  'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  fund:   'bg-foreground/10 text-foreground',
  crypto: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
}

export function typeLabel(type: AssetType): string {
  return TYPE_LABELS[type] ?? type
}

export function typeBadgeClass(type: AssetType): string {
  return TYPE_BADGE[type] ?? TYPE_BADGE.stock
}
