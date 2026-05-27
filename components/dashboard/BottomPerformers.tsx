'use client'

import { useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useAllWatchlistTickers, useTopPerformers, TOP_PERIODS } from '@/hooks/useTopPerformers'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { useFxData } from '@/hooks/useFxData'
import { formatPercent } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { METRIC_DEFINITIONS } from '@/types'
import type { MetricKey } from '@/types'

// Stable reference — avoids re-running useFxData queryKey on every render
const FX_PERIODS: MetricKey[] = ['1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX']

export function BottomPerformers() {
  const [activePeriod, setActivePeriod] = useState<MetricKey>('1D')
  const [annualize, setAnnualize] = useState(false)

  const { tickers, loading: loadingTickers } = useAllWatchlistTickers()
  const tickerKeys = tickers.map(t => t.ticker)
  const { prices } = useRealtimePrices(tickerKeys)

  const currencies = useMemo(
    () => [...new Set(Object.values(prices).map(p => p.currency).filter((c): c is string => !!c && c !== 'USD'))],
    [prices]
  )
  const { fxRates, fxPeriodReturns } = useFxData(currencies, FX_PERIODS)

  const forceAnnualize = activePeriod === 'MAX'
  const isAnnualized = annualize || forceAnnualize

  const { bottom, loading } = useTopPerformers(
    tickers, prices, activePeriod, fxRates, fxPeriodReturns, annualize
  )

  if (loadingTickers) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Worst Performers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bottom 10 across all your watchlists — returns converted to USD.
        </p>
      </div>

      {/* Period selector + annualize toggle */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6">
        {TOP_PERIODS.map(period => {
          const label = METRIC_DEFINITIONS.find(m => m.key === period)?.label ?? period
          return (
            <button
              key={period}
              onClick={() => setActivePeriod(period)}
              className={cn(
                'px-3 py-1.5 text-xs font-mono rounded-sm transition-colors',
                activePeriod === period
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-ink-elevated'
              )}
            >
              {label}
            </button>
          )
        })}

        <button
          onClick={() => setAnnualize(a => !a)}
          disabled={forceAnnualize}
          title={forceAnnualize ? 'MAX is always annualized' : 'Toggle annualized returns (CAGR)'}
          className={cn(
            'ml-1 px-3 py-1.5 text-xs font-mono rounded-sm border transition-colors',
            isAnnualized
              ? 'border-foreground/50 bg-foreground/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-ink-elevated',
            forceAnnualize && 'cursor-default opacity-60'
          )}
        >
          Ann.
        </button>
      </div>

      {/* Ranked list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Fetching returns for {tickers.length} assets…</span>
        </div>
      ) : bottom.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No return data available for this period yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {/* Column labels */}
          <div className="flex items-center gap-3 px-3 pb-1">
            <span className="w-5 shrink-0" />
            <span className="flex-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Asset</span>
            <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {isAnnualized ? 'CAGR USD' : 'Return USD'}
            </span>
          </div>

          {bottom.map((entry, i) => (
            <div
              key={entry.ticker}
              className="flex items-center gap-3 rounded-sm border border-border bg-card px-3 py-2.5 hover:bg-accent/40 transition-colors"
            >
              {/* Rank */}
              <span className="w-5 shrink-0 text-right text-xs font-mono font-bold text-muted-foreground">
                {i + 1}
              </span>

              {/* Ticker + name + watchlist badges */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{entry.ticker}</span>
                  <span className="hidden sm:block truncate text-xs text-muted-foreground">{entry.name}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {entry.watchlistNames.map(wl => (
                    <span
                      key={wl}
                      className="font-mono text-[10px] text-muted-foreground bg-ink-elevated px-1.5 py-0.5 rounded-sm"
                    >
                      {wl}
                    </span>
                  ))}
                </div>
              </div>

              {/* Return value */}
              <span className={cn(
                'shrink-0 text-sm font-mono font-semibold',
                entry.returnValue > 0 ? 'text-green-500' : entry.returnValue < 0 ? 'text-red-500' : 'text-muted-foreground'
              )}>
                {formatPercent(entry.returnValue)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
