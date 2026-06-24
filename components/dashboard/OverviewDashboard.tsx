'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, Swords, Newspaper,
  ArrowUpRight, Activity, ListPlus,
} from 'lucide-react'
import { useAllWatchlistTickers, useTopPerformers } from '@/hooks/useTopPerformers'
import { useRealtimePrices } from '@/hooks/useRealtimePrices'
import { useFxData } from '@/hooks/useFxData'
import { usePeerComparison } from '@/hooks/usePeerComparison'
import { useNewsBrief } from '@/hooks/useNewsBrief'
import { BENCHMARK_TICKERS, BENCHMARK_LABELS } from '@/lib/market/benchmarks'
import { formatPercent, formatPrice, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { METRIC_DEFINITIONS } from '@/types'
import type { MetricKey } from '@/types'
import type { TopEntry } from '@/hooks/useTopPerformers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SpotlightCard } from '@/components/dashboard/SpotlightCard'
import { NumberTicker } from '@/components/dashboard/NumberTicker'
import { SegmentedControl } from '@/components/dashboard/SegmentedControl'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { motion, useReducedMotion } from 'framer-motion'
import { fadeUp, staggerContainer, SPRING_SNAP } from '@/lib/motion-tokens'
import { ValuePulse } from '@/lib/motion-client'

// KPI period switcher — same metric keys as Top/Bottom performers.
const KPI_PERIODS: MetricKey[] = ['1D', '1W', '1M', 'YTD', '1Y']
// Stable reference for useFxData (avoids re-keying the query each render).
const FX_PERIODS: MetricKey[] = ['1W', '1M', 'YTD', '1Y']
// usePeerComparison counts a "beating peers" win when an asset tops ≥4/6 periods.
const BEATING_THRESHOLD = 4
// Benchmark tickers are a readonly tuple — copy to a mutable array for the hook.
const BENCHMARKS: string[] = [...BENCHMARK_TICKERS]
const intFmt = (v: number) => Math.round(v).toString()

export function OverviewDashboard() {
  const [period, setPeriod] = useState<MetricKey>('1D')

  const { tickers, loading: loadingTickers } = useAllWatchlistTickers()
  const tickerKeys = useMemo(() => tickers.map((t) => t.ticker), [tickers])
  const { prices } = useRealtimePrices(tickerKeys)

  // Non-USD currencies present in the loaded prices → FX conversion to USD.
  const currencies = useMemo(
    () => [...new Set(Object.values(prices).map((p) => p.currency).filter((c): c is string => !!c && c !== 'USD'))],
    [prices]
  )
  const { fxRates, fxPeriodReturns } = useFxData(currencies, FX_PERIODS)

  const { top, bottom, loading: loadingReturns } = useTopPerformers(
    tickers, prices, period, fxRates, fxPeriodReturns, false
  )

  const { results: peerResults, loading: loadingPeers } = usePeerComparison()
  const beatingCount = useMemo(
    () => peerResults.filter((r) => r.metricsWon >= BEATING_THRESHOLD).length,
    [peerResults]
  )

  const periodOptions = KPI_PERIODS.map((p) => ({
    value: p,
    label: METRIC_DEFINITIONS.find((m) => m.key === p)?.label ?? p,
  }))

  // ── Loading / empty gates ──────────────────────────────────────────────
  if (loadingTickers) return <OverviewSkeleton />

  if (tickers.length === 0) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <header className="border-b border-border pb-5">
          <p className="eyebrow">Resumen agregado · Retornos en USD</p>
          <h1 className="mt-1 font-editorial text-3xl font-bold leading-none tracking-tight text-foreground sm:text-4xl">
            Overview
          </h1>
        </header>
        <EmptyState
          icon={ListPlus}
          title="Aún no tienes activos"
          description="Crea una watchlist y añade activos desde la barra lateral para ver tu resumen agregado: mejores y peores activos, comparativa contra peers y el brief de mercado."
          action={
            <Link
              href="/"
              className="focus-ring inline-flex items-center gap-1.5 rounded-pill border border-bone/40 bg-bone/[0.08] px-3 py-1.5 text-xs font-mono text-foreground transition-colors hover:bg-bone/[0.14]"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Crear watchlist
            </Link>
          }
        />
      </div>
    )
  }

  const best = top[0] ?? null
  const worst = bottom[0] ?? null
  const periodLabel = METRIC_DEFINITIONS.find((m) => m.key === period)?.label ?? period

  return (
    <div className="space-y-8 px-4 py-6 sm:px-6">
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Resumen agregado · Retornos en USD</p>
            <h1 className="mt-1 font-editorial text-3xl font-bold leading-none tracking-tight text-foreground sm:text-4xl">
              Overview
            </h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {tickers.length} {tickers.length === 1 ? 'activo' : 'activos'} seguidos
              {!loadingPeers && <> · {beatingCount} batiendo a sus peers</>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="eyebrow">Período</span>
            <SegmentedControl
              options={periodOptions}
              value={period}
              onChange={setPeriod}
              size="sm"
              aria-label="Período de retorno"
            />
          </div>
        </div>
      </header>

      <div data-tour="overview-grid" className="space-y-8">
        {/* ── Hero cluster: dominant best + stacked stat rail ───────────── */}
        <HeroCluster
          best={best}
          worst={worst}
          periodLabel={periodLabel}
          period={period}
          loading={loadingReturns}
          tickerCount={tickers.length}
          beatingCount={beatingCount}
          loadingPeers={loadingPeers}
        />

        {/* ── Movers (top + bottom merged) + peers ──────────────────────── */}
        <section className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
          <Movers top={top.slice(0, 5)} bottom={bottom.slice(0, 5)} loading={loadingReturns} />
          <PeersMiniList results={peerResults} loading={loadingPeers} />
        </section>

        {/* ── Market Snapshot (live heartbeat) ──────────────────────────── */}
        <MarketSnapshot />

        {/* ── Brief teaser ──────────────────────────────────────────────── */}
        <BriefTeaser />
      </div>
    </div>
  )
}

// ── Internal: live benchmark snapshot ─────────────────────────────────────
function MarketSnapshot() {
  const { prices } = useRealtimePrices(BENCHMARKS)

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <p className="eyebrow inline-flex shrink-0 items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-spark" strokeWidth={2} />
          Market Snapshot
        </p>
        <span className="h-px flex-1 bg-border" />
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-spark/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-spark" />
          </span>
          En vivo
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-card sm:grid-cols-3 lg:grid-cols-5">
        {BENCHMARKS.map((ticker) => {
          const q = prices[ticker]
          const label = BENCHMARK_LABELS[ticker] ?? ticker
          return (
            <div key={ticker} className="flex flex-col gap-1 bg-card p-3.5">
              <span className="truncate text-[11px] text-muted-foreground" title={label}>{label}</span>
              <ValuePulse value={q?.price} tone="auto" className="font-editorial text-lg font-bold tabular-nums leading-none text-foreground">
                {q ? formatPrice(q.price) : <Skeleton className="inline-block h-5 w-16" />}
              </ValuePulse>
              <span className={cn('font-mono text-xs font-semibold tabular-nums', percentColor(q?.change_percent ?? null))}>
                {q ? formatPercent(q.change_percent) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Internal: hero cluster — dominant best + stacked stat rail ────────────
function HeroCluster({
  best, worst, periodLabel, period, loading, tickerCount, beatingCount, loadingPeers,
}: {
  best: TopEntry | null
  worst: TopEntry | null
  periodLabel: string
  period: MetricKey
  loading: boolean
  tickerCount: number
  beatingCount: number
  loadingPeers: boolean
}) {
  const reduced = useReducedMotion()
  return (
    <SpotlightCard className="grain relative overflow-hidden p-6 sm:p-8">
      {/* Decorative washes (aria-hidden). Inline position wins over `.spotlight > *`. */}
      <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-bone/[0.05] blur-3xl" style={{ position: 'absolute' }} aria-hidden />
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ position: 'absolute', background: 'linear-gradient(115deg, transparent 30%, hsl(var(--bone)) 50%, transparent 70%)', backgroundSize: '250% 100%' }}
          animate={{ backgroundPosition: ['150% 0%', '-50% 0%'] }}
          transition={{ duration: 9, ease: 'linear', repeat: Infinity }}
        />
      )}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        {/* ── Dominant best ──────────────────────────────────────────────── */}
        <div className="min-w-0">
          <span className="eyebrow inline-flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
            Mejor activo · {periodLabel}
          </span>
          {loading ? (
            <Skeleton className="mt-3 h-20 w-56" />
          ) : best ? (
            <>
              <div className="mt-2 flex items-center gap-3">
                <ValuePulse value={best.returnValue} tone="auto">
                  <NumberTicker
                    key={`${period}-${best.ticker}`}
                    target={best.returnValue}
                    format={formatPercent}
                    className={cn(
                      'font-editorial text-6xl font-bold leading-[0.9] tabular-nums tracking-[-0.04em] sm:text-7xl lg:text-[5.5rem]',
                      percentColor(best.returnValue)
                    )}
                  />
                </ValuePulse>
                <motion.span
                  initial={reduced ? false : { scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={SPRING_SNAP}
                  className={cn(
                    'shrink-0 rounded-pill px-2 py-0.5 text-xs font-mono font-semibold',
                    best.returnValue >= 0 ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
                  )}
                >
                  {best.returnValue >= 0 ? '▲' : '▼'}
                </motion.span>
              </div>
              <p className="mt-3 truncate text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{best.ticker}</span>
                {best.name ? ` · ${best.name}` : ''}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Sin datos de retorno</p>
          )}
        </div>

        {/* ── Stat rail ──────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:border-l lg:border-border lg:pl-8">
          <RailStat
            label="Peor activo"
            icon={TrendingDown}
            loading={loading}
            value={worst ? <span className={percentColor(worst.returnValue)}>{formatPercent(worst.returnValue)}</span> : '—'}
            sub={worst ? <><span className="font-mono font-semibold text-foreground">{worst.ticker}</span>{worst.name ? ` · ${worst.name}` : ''}</> : undefined}
          />
          <RailStat
            label="Activos seguidos"
            value={<span className="tabular-nums text-foreground">{tickerCount}</span>}
            sub="En todas tus watchlists"
          />
          <RailStat
            label="Beating Peers"
            loading={loadingPeers}
            value={
              <span className="tabular-nums text-foreground">
                <NumberTicker target={beatingCount} format={intFmt} startOnView />
              </span>
            }
            sub={`Ganan ≥${BEATING_THRESHOLD} de 6 métricas`}
          />
        </div>
      </div>
    </SpotlightCard>
  )
}

// ── Internal: a single readout in the hero rail ───────────────────────────
function RailStat({
  label, icon: Icon, value, sub, loading,
}: {
  label: string
  icon?: typeof TrendingUp
  value: React.ReactNode
  sub?: React.ReactNode
  loading?: boolean
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-border/50 py-3.5 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
          {label}
        </span>
        {sub && <p className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
      <span className="shrink-0 font-editorial text-2xl font-bold leading-none tabular-nums sm:text-3xl">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </span>
    </div>
  )
}

// ── Internal: a "View all" link used in section headers ───────────────────
function ViewAllLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex items-center gap-0.5 rounded-pill text-[11px] font-mono text-muted-foreground transition-colors hover:text-foreground"
    >
      Ver todo
      <ArrowUpRight className="h-3 w-3" />
    </Link>
  )
}

// Rank-chip styles — bone-neutral chips (rank #1 a touch brighter); color stays scarce.
const LEADER_RANK_CHIP: Record<number, string> = {
  0: 'bg-foreground/[0.14] text-foreground',
  1: 'bg-foreground/[0.10] text-foreground/90',
  2: 'bg-foreground/[0.08] text-foreground/80',
}

// ── Internal: the row list shared by both Movers columns ──────────────────
function LeaderRows({ entries, loading, rankAccent }: { entries: TopEntry[]; loading: boolean; rankAccent?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
      </div>
    )
  }
  if (entries.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">Sin datos de retorno.</p>
  }
  const maxAbs = Math.max(...entries.map((e) => Math.abs(e.returnValue)), 0.01)
  return (
    <motion.div className="-mx-2 flex flex-col" variants={staggerContainer} initial="hidden" animate="show">
      {entries.map((entry, i) => (
        <motion.div
          key={entry.ticker}
          layout
          variants={fadeUp}
          className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-ink-elevated"
        >
          <span className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums',
            rankAccent ? (LEADER_RANK_CHIP[i] ?? 'bg-ink-elevated text-muted-foreground') : 'bg-ink-elevated text-muted-foreground'
          )}>
            {i + 1}
          </span>
          <span className="flex-1 truncate text-sm font-semibold">{entry.name || entry.ticker}</span>
          {/* Inline magnitude bar (CSS only, from the scalar return — no fetch) */}
          <div className="hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-foreground/[0.06] sm:block" aria-hidden>
            <div
              className={cn('h-full rounded-full', entry.returnValue >= 0 ? 'bg-gain' : 'bg-loss')}
              style={{ width: `${Math.min(100, (Math.abs(entry.returnValue) / maxAbs) * 100)}%` }}
            />
          </div>
          <span className={cn('shrink-0 font-editorial text-base font-bold tabular-nums', percentColor(entry.returnValue))}>
            {formatPercent(entry.returnValue)}
          </span>
        </motion.div>
      ))}
    </motion.div>
  )
}

// ── Internal: top + bottom merged into one panel (two columns) ────────────
function Movers({ top, bottom, loading }: { top: TopEntry[]; bottom: TopEntry[]; loading: boolean }) {
  return (
    <Card className="card-lift flex flex-col">
      <CardHeader>
        <CardTitle className="font-editorial text-sm tracking-tight">Movimientos</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="grid gap-6 sm:grid-cols-2 sm:gap-0">
          {/* Top */}
          <div className="sm:pr-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                Top performers
              </span>
              <ViewAllLink href="/top10" />
            </div>
            <LeaderRows entries={top} loading={loading} rankAccent />
          </div>
          {/* Bottom */}
          <div className="sm:border-l sm:border-border sm:pl-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                Bottom performers
              </span>
              <ViewAllLink href="/bottom10" />
            </div>
            <LeaderRows entries={bottom} loading={loading} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Internal: peers mini-list (top assets by metrics won) ─────────────────
function PeersMiniList({
  results, loading,
}: {
  results: ReturnType<typeof usePeerComparison>['results']
  loading: boolean
}) {
  const top = results.filter((r) => r.hasPeers).slice(0, 5)
  return (
    <Card className="card-lift flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-editorial flex items-center gap-2 text-sm tracking-tight">
          <Swords className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          Beating Peers
        </CardTitle>
        <ViewAllLink href="/vs-peers" />
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : top.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">Ninguno de tus activos tiene peers asignados aún.</p>
        ) : (
          <motion.div className="-mx-2 flex flex-col" variants={staggerContainer} initial="hidden" animate="show">
            {top.map((asset) => {
              const winning = asset.metricsWon >= BEATING_THRESHOLD
              return (
                <motion.div
                  key={asset.ticker}
                  layout
                  variants={fadeUp}
                  className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-ink-elevated"
                >
                  <span className="flex-1 truncate text-sm font-semibold">{asset.name || asset.ticker}</span>
                  <div className="hidden shrink-0 items-center gap-0.5 sm:flex" aria-hidden>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <span
                        key={j}
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          j < asset.metricsWon ? (winning ? 'bg-gain' : 'bg-foreground/40') : 'bg-border'
                        )}
                      />
                    ))}
                  </div>
                  <span className={cn(
                    'shrink-0 font-editorial text-base font-bold tabular-nums',
                    winning ? 'text-gain' : 'text-muted-foreground'
                  )}>
                    {asset.metricsWon}<span className="text-xs text-muted-foreground">/6</span>
                  </span>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Internal: latest Market Brief teaser ──────────────────────────────────
function BriefTeaser() {
  const { data, isLoading } = useNewsBrief()
  const brief = data?.data ?? null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-editorial flex items-center gap-2 text-sm tracking-tight">
          <Newspaper className="h-4 w-4 text-bone-dim" strokeWidth={1.75} />
          Brief de mercado
          {data?.stale && (
            <span className="rounded-pill bg-ink-elevated px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
              previo
            </span>
          )}
        </CardTitle>
        <ViewAllLink href="/news" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : !brief ? (
          <EmptyState
            compact
            icon={Newspaper}
            title="Sin brief disponible"
            description="El brief semanal aún no se ha generado. Vuelve más tarde."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-red-500" /><strong className="tabular-nums text-foreground"><NumberTicker target={brief.strong_signals} format={intFmt} startOnView /></strong> fuertes</span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /><strong className="tabular-nums text-foreground"><NumberTicker target={brief.moderate_signals} format={intFmt} startOnView /></strong> moderadas</span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-bone-dim" /><strong className="tabular-nums text-foreground"><NumberTicker target={brief.weak_noise} format={intFmt} startOnView /></strong> ruido</span>
            </div>
            {brief.top_theme && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Tema dominante:</span> {brief.top_theme}
              </p>
            )}
            {brief.key_risk && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Riesgo clave:</span> {brief.key_risk}
              </p>
            )}
            {brief.market_news.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  Titulares
                </p>
                <ul className="space-y-1">
                  {brief.market_news.slice(0, 3).map((n) => (
                    <li key={n.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-bone-dim" />
                      <span className="truncate">{n.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Internal: full-page loading skeleton ──────────────────────────────────
function OverviewSkeleton() {
  return (
    <div className="space-y-8 px-4 py-6 sm:px-6">
      <div className="space-y-2 border-b border-border pb-5">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-48 rounded-card" />
      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
      <Skeleton className="h-28 rounded-card" />
      <Skeleton className="h-44 rounded-card" />
    </div>
  )
}
