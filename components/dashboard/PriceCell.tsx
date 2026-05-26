'use client'

import { cn } from '@/lib/utils/cn'
import { formatPrice } from '@/lib/utils/formatters'
import { AnimatedPrice } from '@/components/dashboard/AnimatedPrice'
import type { FlashState } from '@/types'

interface PriceCellProps {
  price: number | undefined
  flashState: FlashState
  currency?: string | null
}

export function PriceCell({ price, flashState, currency }: PriceCellProps) {
  const formatted = formatPrice(price, currency && currency !== 'GBX' ? currency : 'USD')
  return (
    <span
      className={cn(
        'inline-block rounded-sm px-1 transition-colors duration-100',
        flashState === 'up' && 'animate-flash-green',
        flashState === 'down' && 'animate-flash-red'
      )}
    >
      <AnimatedPrice value={formatted} flash={flashState} />
    </span>
  )
}
