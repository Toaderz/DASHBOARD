'use client'

import { useMemo, useRef, useLayoutEffect, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { useAllWatchlistTickers } from '@/hooks/useTopPerformers'

const BENCHMARK_TICKERS = ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT', 'BND', 'DX-Y.NYB', 'CL=F', 'GC=F', 'BTC-USD']
// Target pixels per second — constant regardless of how many tickers there are
const PIXELS_PER_SECOND = 80

export function PriceMarquee() {
  const { tickers: watchlistTickers, loading } = useAllWatchlistTickers()
  const trackRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState<number>(70)

  const allTickers = useMemo(() => {
    const watchlistSet = new Set(watchlistTickers.map((t) => t.ticker))
    return [
      ...BENCHMARK_TICKERS.filter((t) => !watchlistSet.has(t)),
      ...watchlistTickers.map((t) => t.ticker),
    ]
  }, [watchlistTickers])

  const tickers = loading ? BENCHMARK_TICKERS : allTickers

  const { prices } = useRealtimePrices(tickers)

  const items = tickers
    .map((ticker) => ({ ticker, data: prices[ticker] }))
    .filter((item) => item.data != null)

  // Recalculate duration whenever the rendered content changes so speed stays constant.
  // scrollWidth = doubled content; the animation travels exactly half (one full set).
  useLayoutEffect(() => {
    if (!trackRef.current || items.length === 0) return
    const halfWidth = trackRef.current.scrollWidth / 2
    if (halfWidth > 0) setDuration(Math.round(halfWidth / PIXELS_PER_SECOND))
  }, [items.length])

  if (items.length === 0) return null

  const doubled = [...items, ...items]

  return (
    <div className="overflow-hidden border-b border-border bg-ink-base h-8 flex items-center shrink-0">
      <div
        ref={trackRef}
        className="flex animate-marquee pause-on-hover whitespace-nowrap"
        style={{ animationDuration: `${duration}s` }}
      >
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
