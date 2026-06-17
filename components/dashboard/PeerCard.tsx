'use client'

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, TrendingDown, TrendingUp } from 'lucide-react'
import { formatPercent, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { DUR, EASE_OUT, STAGGER_FAST, fadeUp } from '@/lib/motion-tokens'
import { Card } from '@/components/ui/card'
import { PEER_CMP_PERIODS, type AssetComparison, type PeriodResult } from '@/hooks/usePeerComparison'
import { type AssetType, METRIC_DEFINITIONS } from '@/types'

const TOTAL_PERIODS = PEER_CMP_PERIODS.length

function periodLabel(period: string): string {
  return METRIC_DEFINITIONS.find((m) => m.key === period)?.label?.replace(' %', '') ?? period
}

interface ReturnRow {
  ticker: string
  name: string
  hideTicker: boolean
  ret: number | null
  isAsset: boolean
}

// Solo los fondos ocultan su ticker (ISIN críptico) y se identifican por nombre. ETFs y acciones
// conservan ticker + nombre (ahora con nombre real gracias al backfill desde Yahoo).
const hidesTicker = (type: AssetType | null): boolean => type === 'fund'

// Construye las filas ordenadas (activo primero, peers por retorno desc, sin-dato al fondo).
function buildRows(asset: AssetComparison, r: PeriodResult): ReturnRow[] {
  const assetRow: ReturnRow = { ticker: asset.ticker, name: asset.name, hideTicker: hidesTicker(asset.type), ret: r.assetReturn, isAsset: true }
  const peerRows: ReturnRow[] = asset.peers.map((p) => ({
    ticker: p,
    name: asset.peerNames[p] ?? p,
    hideTicker: hidesTicker(asset.peerTypes[p]),
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

// Escala común del grupo para las barras ranqueadas: baseline en 0, posición del activo de referencia.
interface BarScale {
  lo: number      // extremo izq. (= min(0, mínimo del grupo))
  span: number    // rango total (hi − lo), nunca 0
  zeroPct: number // posición del 0 dentro del track (%)
  assetPct: number | null // posición del retorno del activo (línea de referencia)
}

function ReturnRowItem({ row, assetReturn, scale }: { row: ReturnRow; assetReturn: number | null; scale: BarScale }) {
  const reduced = useReducedMotion()
  const noData = row.ret == null
  const v = noData ? 0 : (row.ret as number)
  const valPct = noData ? 0 : ((v - scale.lo) / scale.span) * 100
  const isNeg = v < 0
  // La barra crece desde el 0: positivos hacia la derecha, negativos hacia la izquierda.
  const barWidthPct = noData ? 0 : Math.abs(valPct - scale.zeroPct)

  // Veredicto 1-a-1 (solo peers con dato): el activo le gana si su retorno es estrictamente mayor.
  // OJO: distinto del veredicto del período (r.state === 'won', umbral ≥ 0.75) — no se recalcula aquí.
  const delta = !row.isAsset && !noData && assetReturn != null ? assetReturn - v : null
  const beats = delta != null && delta > 0
  const ties = delta != null && delta === 0

  return (
    <motion.div
      variants={fadeUp}
      className={cn(
        'flex items-center gap-2 py-1',
        row.isAsset && 'rounded-md bg-brand-teal/10 px-2 ring-1 ring-inset ring-brand-teal/25'
      )}
    >
      {/* Etiqueta: chip "Tú" para el activo; ticker (oculto en fondos) + nombre para peers */}
      <div className="flex w-24 shrink-0 items-center gap-1.5 sm:w-40">
        {row.isAsset && (
          <span className="rounded-pill bg-brand-teal px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Tú
          </span>
        )}
        {!row.isAsset && !row.hideTicker && (
          <span className="font-mono text-[11px] font-semibold">{row.ticker}</span>
        )}
        <span className={cn('truncate text-[10px]', row.isAsset ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {row.name}
        </span>
      </div>

      {/* Barra de retorno en escala común (baseline 0). Color = quién gana: teal=tú · azul=le ganas · rojo=te gana */}
      <div className="relative h-2.5 min-w-0 flex-1 rounded-sm bg-foreground/[0.05]">
        {/* Línea del cero */}
        <span className="absolute top-0 h-full w-px bg-border" style={{ left: `${scale.zeroPct}%` }} />
        {/* Marcador punteado del nivel del activo (referencia en filas de peers) */}
        {!row.isAsset && scale.assetPct != null && (
          <span
            className="absolute top-[-2px] h-[calc(100%+4px)] border-l border-dashed border-brand-teal/70"
            style={{ left: `${scale.assetPct}%` }}
            aria-hidden
          />
        )}
        {!noData && (
          <motion.span
            className={cn(
              'absolute top-0 h-full rounded-sm',
              row.isAsset ? 'bg-brand-teal' : beats ? 'bg-chart-1' : 'bg-loss/80'
            )}
            style={isNeg ? { right: `${100 - scale.zeroPct}%` } : { left: `${scale.zeroPct}%` }}
            initial={reduced ? false : { width: 0 }}
            animate={{ width: `${barWidthPct}%` }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          />
        )}
      </div>

      {/* Retorno */}
      <span className={cn('w-14 shrink-0 text-right font-mono text-[11px] sm:w-16', noData ? 'text-muted-foreground' : percentColor(row.ret))}>
        {noData ? '—' : formatPercent(row.ret)}
      </span>

      {/* Veredicto en lenguaje claro */}
      <span className="w-[64px] shrink-0 sm:w-28">
        {row.isAsset ? null : noData ? (
          <span className="block text-right text-[10px] text-muted-foreground">sin dato</span>
        ) : (
          <span
            className={cn(
              'inline-flex w-full items-center justify-end gap-1 text-[10px] font-semibold',
              ties ? 'text-muted-foreground' : beats ? 'text-gain' : 'text-loss'
            )}
          >
            {!ties && (beats ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
            <span className="hidden sm:inline">{ties ? 'empata' : beats ? 'le ganas' : 'te gana'}</span>
            {delta != null && <span className="tabular-nums">{`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`}</span>}
          </span>
        )}
      </span>
    </motion.div>
  )
}

export function PeerCard({ asset }: { asset: AssetComparison }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {asset.type === 'fund' ? (
              // Fondos: el nombre es el identificador legible (el ISIN/ticker críptico se omite).
              <span className="truncate text-sm font-semibold">{asset.name}</span>
            ) : (
              <>
                <span className="font-mono text-sm font-semibold">{asset.ticker}</span>
                {asset.name !== asset.ticker && (
                  <span className="hidden sm:block truncate text-xs text-muted-foreground">{asset.name}</span>
                )}
              </>
            )}
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
              'font-editorial text-xl font-bold tabular-nums leading-none',
              asset.metricsWon >= 4 ? 'text-gain' : asset.metricsWon > 0 ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {asset.metricsWon}<span className="text-sm text-muted-foreground">/{TOTAL_PERIODS}</span>
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

              {/* Detalle expandido: barras de retorno ranqueadas en escala común + veredicto por peer */}
              <AnimatePresence initial={false}>
                {isOpen && hasData && (() => {
                  const rows = buildRows(asset, r)
                  // Escala común del grupo: rango [lo,hi] sobre activo + peers con dato, siempre incluyendo el 0.
                  const vals = rows.filter((row) => row.ret != null).map((row) => row.ret as number)
                  const lo = Math.min(0, ...vals)
                  const hi = Math.max(0, ...vals)
                  const span = (hi - lo) || 1
                  const zeroPct = ((0 - lo) / span) * 100
                  const assetPct = r.assetReturn != null ? ((r.assetReturn - lo) / span) * 100 : null
                  const scale = { lo, span, zeroPct, assetPct }
                  return (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: DUR.base, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-2.5 pl-4 pt-1 sm:pl-12">
                        {/* Cabecera del desglose — contexto legible */}
                        <p className="mb-1.5 text-[10px] text-muted-foreground">
                          <span className="font-mono font-semibold text-foreground">{periodLabel(period)}</span>
                          {' · tú vs peers · '}
                          <span className={cn('font-semibold', r.won ? 'text-gain' : 'text-foreground')}>
                            ganaste a {r.beaten.length}/{r.assigned}
                          </span>
                        </p>
                        <motion.div
                          className="space-y-0.5"
                          variants={{ hidden: {}, show: { transition: { staggerChildren: STAGGER_FAST } } }}
                          initial="hidden"
                          animate="show"
                        >
                          {rows.map((row) => (
                            <ReturnRowItem key={row.ticker} row={row} assetReturn={r.assetReturn} scale={scale} />
                          ))}
                        </motion.div>
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
