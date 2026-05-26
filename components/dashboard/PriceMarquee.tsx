'use client'

import { cn } from '@/lib/utils/cn'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import type { Watchlist } from '@/types'

const MARQUEE_TICKERS = ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'BND', 'DX-Y.NYB', 'CL=F', 'GC=F', 'BTC-USD']

interface PriceMarqueeProps {
  watchlists: Watchlist[]
}

export function PriceMarquee({ watchlists: _ }: PriceMarqueeProps) {
  const { prices } = useRealtimePrices(MARQUEE_TICKERS)

  const items = MARQUEE_TICKERS
    .map((ticker) => ({ ticker, data: prices[ticker] }))
    .filter((item) => item.data != null)

  if (items.length === 0) return null

  const doubled = [...items, ...items]

  return (
    <div className="overflow-hidden border-b border-border bg-ink-base h-8 flex items-center shrink-0">
      <div className="flex animate-marquee pause-on-hover whitespace-nowrap">
        {doubled.map((item, i) => {
          const pct = item.data?.change_percent ?? 0
          const positive = pct >= 0
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-4 font-mono text-[11px]"
            >
              <span className="text-muted-foreground tracking-wider">{item.ticker}</span>
              <span className="text-foreground tabular-nums">
                {item.data?.price != null
                  ? item.data.price < 10
                    ? item.data.price.toFixed(4)
                    : item.data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : '—'}
              </span>
              <span
                className={cn(
                  'tabular-nums',
                  positive ? 'text-gain' : 'text-loss'
                )}
              >
                {positive ? '+' : ''}{pct.toFixed(2)}%
              </span>
              <span className="text-border/60 mx-1">·</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
