'use client'

import { useState, useMemo } from 'react'
import { Loader2, TrendingDown } from 'lucide-react'
import { useAllWatchlistTickers, useTopPerformers, TOP_PERIODS } from '@/hooks/useTopPerformers'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { useFxData } from '@/hooks/useFxData'
import { formatPercent, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { METRIC_DEFINITIONS } from '@/types'
import type { MetricKey } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { SegmentedControl } from '@/components/dashboard/SegmentedControl'
import { EmptyState } from '@/components/dashboard/EmptyState'

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

  // Period options for the SegmentedControl (same values/order as TOP_PERIODS)
  const periodOptions = TOP_PERIODS.map(period => ({
    value: period,
    label: METRIC_DEFINITIONS.find(m => m.key === period)?.label ?? period,
  }))

  if (loadingTickers) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader
        icon={TrendingDown}
        title="Bottom 10 Performers"
        description="Worst 10 across all your watchlists — returns converted to USD."
        className="mb-4"
      />

      {/* Period selector — own row so the editorial title never gets squeezed */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={periodOptions}
          value={activePeriod}
          onChange={setActivePeriod}
          size="sm"
          aria-label="Período de retorno"
        />
        <button
          onClick={() => setAnnualize(a => !a)}
          disabled={forceAnnualize}
          title={forceAnnualize ? 'MAX is always annualized' : 'Toggle annualized returns (CAGR)'}
          className={cn(
            'focus-ring rounded-pill border px-3 py-1.5 text-[11px] font-mono tracking-wide transition-colors',
            isAnnualized
              ? 'border-foreground bg-foreground text-background'
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
        <EmptyState
          icon={TrendingDown}
          title="Sin datos de retorno"
          description="No return data available for this period yet."
        />
      ) : (
        <Card className="overflow-hidden">
          {/* Column labels */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <span className="w-5 shrink-0" />
            <span className="flex-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Asset</span>
            <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {isAnnualized ? 'CAGR USD' : 'Return USD'}
            </span>
          </div>

          <CardContent className="p-0">
            {bottom.map((entry, i) => (
              <div
                key={entry.ticker}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-accent/40"
              >
                {/* Rank */}
                <span className="w-5 shrink-0 text-right text-xs font-mono font-bold tabular-nums text-muted-foreground">
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
                        className="font-mono text-[10px] text-muted-foreground bg-ink-elevated px-1.5 py-0.5 rounded-pill"
                      >
                        {wl}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Return value */}
                <span className={cn(
                  'shrink-0 text-sm font-mono font-semibold tabular-nums',
                  percentColor(entry.returnValue)
                )}>
                  {formatPercent(entry.returnValue)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
