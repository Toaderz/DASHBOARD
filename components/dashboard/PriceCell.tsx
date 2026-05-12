'use client'

import { cn } from '@/lib/utils/cn'
import { formatPrice } from '@/lib/utils/formatters'
import type { FlashState } from '@/types'

interface PriceCellProps {
  price: number | undefined
  flashState: FlashState
  currency?: string | null
}

export function PriceCell({ price, flashState, currency }: PriceCellProps) {
  return (
    <span
      className={cn(
        'inline-block rounded px-1 tabular-nums transition-colors duration-100',
        flashState === 'up' && 'animate-flash-green',
        flashState === 'down' && 'animate-flash-red'
      )}
    >
      {formatPrice(price, currency && currency !== 'GBX' ? currency : 'USD')}
    </span>
  )
}
