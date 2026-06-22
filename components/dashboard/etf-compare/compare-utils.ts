import type { AssetType } from '@/types'

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
