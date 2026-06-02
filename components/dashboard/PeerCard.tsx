'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatPercent, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { PEER_CMP_PERIODS, type AssetComparison } from '@/hooks/usePeerComparison'
import { METRIC_DEFINITIONS } from '@/types'

const TOTAL_PERIODS = PEER_CMP_PERIODS.length

function periodLabel(period: string): string {
  return METRIC_DEFINITIONS.find((m) => m.key === period)?.label?.replace(' %', '') ?? period
}

export function PeerCard({ asset }: { asset: AssetComparison }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="rounded-sm border border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{asset.ticker}</span>
            <span className="hidden sm:block truncate text-xs text-muted-foreground">{asset.name}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {asset.watchlistNames.map((wl) => (
              <span
                key={wl}
                className="font-mono text-[10px] text-muted-foreground bg-ink-elevated px-1.5 py-0.5 rounded-sm"
              >
                {wl}
              </span>
            ))}
            <span className="font-mono text-[10px] text-muted-foreground px-1.5 py-0.5">
              {asset.peers.length} peers
            </span>
          </div>
        </div>

        {/* Metrics-won summary */}
        <div className="shrink-0 text-right">
          <div
            className={cn(
              'text-sm font-mono font-bold',
              asset.metricsWon >= 4 ? 'text-green-500' : asset.metricsWon > 0 ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {asset.metricsWon}/{TOTAL_PERIODS}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">won</div>
        </div>
      </div>

      {/* Per-period rows */}
      <div className="border-t border-border">
        {PEER_CMP_PERIODS.map((period) => {
          const r = asset.byPeriod[period]
          const hasData = r.total > 0
          const isOpen = expanded === period
          const notBeaten = r.evaluated.filter((p) => !r.beaten.includes(p))
          return (
            <div key={period} className="border-b border-border/60 last:border-0">
              <button
                onClick={() => setExpanded(isOpen ? null : period)}
                disabled={!hasData}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors',
                  hasData ? 'hover:bg-accent/40' : 'cursor-default opacity-60'
                )}
              >
                <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{periodLabel(period)}</span>

                {/* Asset return (USD) */}
                <span className={cn('w-16 shrink-0 text-right font-mono text-xs', percentColor(r.assetReturn))}>
                  {formatPercent(r.assetReturn)}
                </span>

                {/* Beaten count */}
                <span className="flex-1 text-right">
                  {hasData ? (
                    <span
                      className={cn(
                        'font-mono text-xs font-semibold',
                        r.won ? 'text-green-500' : 'text-muted-foreground'
                      )}
                    >
                      ganó a {r.beaten.length}/{r.total}
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">—</span>
                  )}
                </span>

                {hasData && (
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                  />
                )}
              </button>

              {/* Expanded detail: which peers beaten / not beaten */}
              {isOpen && hasData && (
                <div className="space-y-1 px-3 pb-2 pl-12">
                  {r.beaten.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-1">
                      <span className="text-[10px] font-mono uppercase tracking-wide text-green-500">le ganó a:</span>
                      {r.beaten.map((t) => (
                        <span key={t} className="font-mono text-[11px] text-foreground bg-ink-elevated px-1.5 py-0.5 rounded-sm">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {notBeaten.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-1">
                      <span className="text-[10px] font-mono uppercase tracking-wide text-red-500">no le ganó a:</span>
                      {notBeaten.map((t) => (
                        <span key={t} className="font-mono text-[11px] text-muted-foreground bg-ink-elevated px-1.5 py-0.5 rounded-sm">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
