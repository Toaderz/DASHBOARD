import type { AssetType } from '@/types'
import { seriesColor } from '@/lib/chart-theme'

// The navy→teal→sky CHART_SERIES ramp is monochromatic, so consecutive indices
// (0,1,2) read as nearly the same blue when used for adjacent compared assets.
// This permutation reorders the SAME 8 palette colors (we don't touch --chart-1..8)
// so the first assets land on maximally-spaced lightness steps:
// dark navy → light cyan → mid teal → light blue → … (readable in both themes).
const COMPARE_ORDER = [0, 4, 2, 6, 1, 3, 5, 7] as const

/** Per-asset chart color for the compare module — high-contrast ordering of CHART_SERIES. */
export function compareSeriesColor(i: number): string {
  return seriesColor(COMPARE_ORDER[((i % 8) + 8) % 8])
}

// Comparison compatibility groups. The user's rule: ETFs and indices compare with
// each other; funds only with funds; stocks only with stocks. The first ticker locks
// the group and the search disables anything outside it.
export type CompareGroup = 'etf' | 'fund' | 'stock' | 'crypto'

export function compatGroup(type: AssetType): CompareGroup {
  switch (type) {
    case 'etf':
    case 'index':
      return 'etf'
    case 'fund':
      return 'fund'
    case 'crypto':
      return 'crypto'
    default:
      return 'stock'
  }
}

const GROUP_NOUN: Record<CompareGroup, string> = {
  etf: 'ETFs o índices',
  fund: 'fondos',
  stock: 'acciones',
  crypto: 'cripto',
}

export function groupLockReason(group: CompareGroup): string {
  return `Solo se compara con ${GROUP_NOUN[group]}`
}

// Maps Yahoo's instrument_type (EQUITY/ETF/MUTUALFUND/INDEX/CRYPTOCURRENCY) to our
// AssetType. Used to recover an asset's group from live quotes on reload (the URL
// only stores tickers, not types).
export function instrumentToType(instrument?: string | null): AssetType {
  switch ((instrument ?? '').toUpperCase()) {
    case 'ETF':
      return 'etf'
    case 'MUTUALFUND':
      return 'fund'
    case 'INDEX':
      return 'index'
    case 'CRYPTOCURRENCY':
      return 'crypto'
    default:
      return 'stock'
  }
}
