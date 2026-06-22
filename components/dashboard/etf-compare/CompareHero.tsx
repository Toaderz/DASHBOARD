'use client'

import { Fragment } from 'react'
import { formatPrice, formatPercent, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import type { QuoteData } from '@/types'

interface CompareHeroProps {
  tickers: string[]
  names: Record<string, string>
  quotes: Record<string, QuoteData>
}

// ETF.com-style hero: oversized editorial tickers separated by "VS." with name +
// live price beneath each. Tickers are bone/foreground — NOT teal (V2 invariant).
export function CompareHero({ tickers, names, quotes }: CompareHeroProps) {
  return (
    <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-5 rounded-card border border-border bg-card px-4 py-6 shadow-card">
      {tickers.map((t, i) => {
        const q = quotes[t]
        // Intl currency needs a valid ISO code; GBX (pence) and odd values fall back to USD.
        const ccy = q?.currency && /^[A-Z]{3}$/.test(q.currency) && q.currency !== 'GBX' ? q.currency : 'USD'
        return (
          <Fragment key={t}>
            {i > 0 && (
              <span className="self-center font-editorial text-base font-medium text-muted-foreground sm:text-lg">
                VS.
              </span>
            )}
            <div className="flex min-w-[7rem] flex-col items-center gap-1 px-2 text-center sm:px-4">
              <span className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
                {t}
              </span>
              <span className="line-clamp-2 max-w-[11rem] text-xs text-muted-foreground">
                {names[t] ?? ''}
              </span>
              {q?.price != null && (
                <span className="mt-0.5 font-mono text-sm tabular-nums text-foreground">
                  {formatPrice(q.price, ccy)}{' '}
                  <span className={cn('text-xs', percentColor(q.change_percent))}>
                    {formatPercent(q.change_percent)}
                  </span>
                </span>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
