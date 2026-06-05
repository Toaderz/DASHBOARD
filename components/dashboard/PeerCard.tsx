'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, TrendingDown, TrendingUp } from 'lucide-react'
import { formatPercent, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import { PEER_CMP_PERIODS, type AssetComparison, type PeriodResult } from '@/hooks/usePeerComparison'
import { METRIC_DEFINITIONS } from '@/types'

const TOTAL_PERIODS = PEER_CMP_PERIODS.length
const BAR_WIDTH_PX = 56 // ancho máximo de la mini-barra de contexto

function periodLabel(period: string): string {
  return METRIC_DEFINITIONS.find((m) => m.key === period)?.label?.replace(' %', '') ?? period
}

interface ReturnRow {
  ticker: string
  name: string
  ret: number | null
  isAsset: boolean
}

// Construye las filas ordenadas (activo primero, peers por retorno desc, sin-dato al fondo).
function buildRows(asset: AssetComparison, r: PeriodResult): ReturnRow[] {
  const assetRow: ReturnRow = { ticker: asset.ticker, name: asset.name, ret: r.assetReturn, isAsset: true }
  const peerRows: ReturnRow[] = asset.peers.map((p) => ({
    ticker: p,
    name: asset.peerNames[p] ?? p,
    ret: r.peerReturns[p] ?? null,
    isAsset: false,
  }))
  peerRows.sort((a, b) => {
    if (a.ret == null && b.ret == null) return a.ticker.localeCompare(b.ticker)
    if (a.ret == null) return 1
    if (b.ret == null) return -1
    return b.ret - a.ret
  })
  return [assetRow, ...peerRows]
}

function ReturnRowItem({ row, assetReturn, min, max }: { row: ReturnRow; assetReturn: number | null; min: number; max: number }) {
  const noData = row.ret == null
  // Icono ✓/✗: comparación 1-a-1 activo↔peer (estricta; empate no cuenta). OJO: es distinta del
  // veredicto del período (r.state === 'won', umbral beaten/evaluated ≥ 0.75) — un período puede
  // estar 'lost' aunque el activo gane a algún peer individual. No recalcular el estado aquí.
  const assetBeatsPeer = !row.isAsset && !noData && assetReturn != null && assetReturn > (row.ret as number)
  const delta = !row.isAsset && !noData && assetReturn != null ? assetReturn - (row.ret as number) : null
  const range = max - min || 1
  const barWidth = noData ? 0 : Math.max(4, Math.round(((((row.ret as number) - min) / range) * BAR_WIDTH_PX)))
  const barColor = row.isAsset ? 'bg-brand-teal' : assetBeatsPeer ? 'bg-chart-1' : 'bg-muted'

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-0.5',
        row.isAsset && 'bg-brand-teal/10 border border-brand-teal/20 rounded-md px-2'
      )}
    >
      {/* Icono ✓/✗ */}
      <span className="w-3 shrink-0">
        {!row.isAsset && !noData &&
          (assetBeatsPeer ? (
            <TrendingUp className="h-3 w-3 text-gain" />
          ) : (
            <TrendingDown className="h-3 w-3 text-loss" />
          ))}
      </span>

      {/* Ticker */}
      <span className="w-12 shrink-0 font-mono text-[11px] font-semibold">{row.ticker}</span>

      {/* Nombre */}
      <span className="flex-1 truncate text-[10px] text-muted-foreground">
        {row.isAsset ? 'Tu activo' : row.name}
      </span>

      {/* Mini-barra de contexto */}
      <span className="w-[56px] shrink-0">
        {!noData && <span className={cn('block h-1.5 rounded-full', barColor)} style={{ width: `${barWidth}px` }} />}
      </span>

      {/* Retorno */}
      <span className={cn('w-16 shrink-0 text-right font-mono text-[11px]', noData ? 'text-muted-foreground' : percentColor(row.ret))}>
        {noData ? '— sin dato' : formatPercent(row.ret)}
      </span>

      {/* Delta pp vs tú (oculto en mobile) */}
      <span className={cn('hidden sm:block w-20 shrink-0 text-right font-mono text-[10px]', delta != null ? percentColor(delta) : 'text-transparent')}>
        {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp vs tú` : ''}
      </span>
    </div>
  )
}

export function PeerCard({ asset }: { asset: AssetComparison }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Card className="overflow-hidden">
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
              asset.metricsWon >= 4 ? 'text-gain' : asset.metricsWon > 0 ? 'text-foreground' : 'text-muted-foreground'
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
          const hasData = r.evaluated.length > 0
          const isOpen = expanded === period
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
                        r.won ? 'text-gain' : 'text-muted-foreground'
                      )}
                    >
                      ganó a {r.beaten.length}/{r.assigned}
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

              {/* Expanded detail: retorno del activo y de cada peer + delta pp + barra de contexto */}
              <AnimatePresence initial={false}>
                {isOpen && hasData && (() => {
                  const rows = buildRows(asset, r)
                  const vals = rows.map((row) => row.ret).filter((v): v is number => v != null)
                  const min = Math.min(...vals)
                  const max = Math.max(...vals)
                  return (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-0.5 px-3 pb-2 pl-12">
                        {rows.map((row) => (
                          <ReturnRowItem key={row.ticker} row={row} assetReturn={r.assetReturn} min={min} max={max} />
                        ))}
                      </div>
                    </motion.div>
                  )
                })()}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
