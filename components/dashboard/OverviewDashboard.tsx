'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, TrendingUp, TrendingDown, Swords, Newspaper,
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
import { PageHeader } from '@/components/dashboard/PageHeader'
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
      <div className="p-4 sm:p-6">
        <PageHeader
          icon={LayoutDashboard}
          title="Overview"
          description="Una vista agregada de todas tus watchlists."
          className="mb-6"
        />
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
    <div className="p-4 sm:p-6 max-w-7xl space-y-5">
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        description="Resumen agregado de todas tus watchlists — retornos en USD."
        actions={
          <SegmentedControl
            options={periodOptions}
            value={period}
            onChange={setPeriod}
            size="sm"
            aria-label="Período de retorno"
          />
        }
      />

      <div data-tour="overview-grid" className="space-y-5">
        {/* ── Hero band (full width): best dominates, worst + KPIs inline ── */}
        <HeroBand
          best={best}
          worst={worst}
          periodLabel={periodLabel}
          period={period}
          loading={loadingReturns}
          tickerCount={tickers.length}
          beatingCount={beatingCount}
          loadingPeers={loadingPeers}
        />

        {/* ── 3 equal data panels (instrument grid) ────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Leaderboard
            title="Top performers"
            icon={TrendingUp}
            entries={top.slice(0, 5)}
            loading={loadingReturns}
            href="/top10"
            rankAccent
          />
          <Leaderboard
            title="Bottom performers"
            icon={TrendingDown}
            entries={bottom.slice(0, 5)}
            loading={loadingReturns}
            href="/bottom10"
          />
          <PeersMiniList
            results={peerResults}
            loading={loadingPeers}
          />
        </div>

        {/* ── Market Snapshot (live heartbeat) + Brief ─────────────────── */}
        <MarketSnapshot />
        <BriefTeaser />
      </div>
    </div>
  )
}

// ── Internal: live benchmark snapshot ─────────────────────────────────────
function MarketSnapshot() {
  const { prices } = useRealtimePrices(BENCHMARKS)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-editorial flex items-center gap-2 text-sm tracking-tight">
          <Activity className="h-4 w-4 text-spark" strokeWidth={1.75} />
          Market Snapshot
        </CardTitle>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-spark/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-spark" />
          </span>
          En vivo
        </span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          {BENCHMARKS.map((ticker) => {
            const q = prices[ticker]
            const label = BENCHMARK_LABELS[ticker] ?? ticker
            return (
              <div key={ticker} className="flex flex-col gap-0.5 bg-card p-3">
                <span className="truncate text-[11px] text-muted-foreground" title={label}>{label}</span>
                <ValuePulse value={q?.price} tone="auto" className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {q ? formatPrice(q.price) : <Skeleton className="inline-block h-4 w-16" />}
                </ValuePulse>
                <span className={cn('font-mono text-xs font-semibold tabular-nums', percentColor(q?.change_percent ?? null))}>
                  {q ? formatPercent(q.change_percent) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Internal: hero band — full-width instrument header ────────────────────
function HeroBand({
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
    <SpotlightCard className="grain relative overflow-hidden p-5 sm:p-6">
      {/* Faint bone accent wash + slow gradient sweep (decorative, aria-hidden) */}
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-bone/[0.05] blur-3xl" aria-hidden />
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ background: 'linear-gradient(115deg, transparent 30%, hsl(var(--bone)) 50%, transparent 70%)', backgroundSize: '250% 100%' }}
          animate={{ backgroundPosition: ['150% 0%', '-50% 0%'] }}
          transition={{ duration: 9, ease: 'linear', repeat: Infinity }}
        />
      )}

      <span className="eyebrow">Pulso del portafolio · {periodLabel}</span>

      <div className="mt-4 grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-5">
          <HeroStat label="Mejor activo" icon={TrendingUp} entry={best} loading={loading} period={period} dominant />
        </div>
        <div className="lg:col-span-3">
          <HeroStat label="Peor activo" icon={TrendingDown} entry={worst} loading={loading} period={period} />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:col-span-4 lg:border-l lg:border-border lg:pl-6">
          <MiniKpi label="Activos seguidos" value={<span className="tabular-nums">{tickerCount}</span>} sub="En tus watchlists" />
          <MiniKpi
            label="Beating Peers"
            value={loadingPeers
              ? <Skeleton className="h-7 w-10" />
              : <NumberTicker target={beatingCount} format={(v) => Math.round(v).toString()} startOnView />}
            sub={`≥${BEATING_THRESHOLD}/6 vs peers`}
          />
        </div>
      </div>
    </SpotlightCard>
  )
}

function HeroStat({
  label, icon: Icon, entry, loading, period, dominant = false,
}: {
  label: string
  icon: typeof TrendingUp
  entry: TopEntry | null
  loading: boolean
  period: MetricKey
  dominant?: boolean
}) {
  const reduced = useReducedMotion()
  const numClass = dominant
    ? 'text-5xl sm:text-6xl lg:text-7xl'
    : 'text-3xl sm:text-4xl lg:text-5xl'
  const up = (entry?.returnValue ?? 0) >= 0
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3 w-3" strokeWidth={2} />
        {label}
      </span>
      {loading ? (
        <Skeleton className={dominant ? 'h-14 w-44' : 'h-10 w-28'} />
      ) : entry ? (
        <>
          <div className="flex items-center gap-2">
            <ValuePulse value={entry.returnValue} tone="auto">
              <NumberTicker
                key={`${period}-${entry.ticker}`}
                target={entry.returnValue}
                format={formatPercent}
                className={cn('font-editorial font-bold leading-[0.95] tabular-nums tracking-[-0.03em]', numClass, percentColor(entry.returnValue))}
              />
            </ValuePulse>
            <motion.span
              initial={reduced ? false : { scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING_SNAP}
              className={cn(
                'shrink-0 rounded-pill px-1.5 py-0.5 text-[10px] font-mono font-semibold',
                up ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'
              )}
            >
              {up ? '▲' : '▼'}
            </motion.span>
          </div>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{entry.ticker}</span>
            {entry.name ? ` · ${entry.name}` : ''}
          </span>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Sin datos de retorno</span>
      )}
    </div>
  )
}

// ── Internal: compact KPI used inline in the hero band ─────────────────────
function MiniKpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="font-editorial text-2xl font-bold tabular-nums leading-none text-foreground">{value}</span>
      {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

// ── Internal: a "View all" link used in card headers ──────────────────────
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

// ── Internal: top/bottom mini-leaderboard ─────────────────────────────────
function Leaderboard({
  title, icon: Icon, entries, loading, href, rankAccent,
}: {
  title: string
  icon: typeof TrendingUp
  entries: TopEntry[]
  loading: boolean
  href: string
  rankAccent?: boolean
}) {
  return (
    <Card className="card-lift flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-editorial flex items-center gap-2 text-sm tracking-tight">
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          {title}
        </CardTitle>
        <ViewAllLink href={href} />
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-4 text-xs text-muted-foreground">Sin datos de retorno.</p>
        ) : (
          <motion.div className="-mx-2 flex flex-col" variants={staggerContainer} initial="hidden" animate="show">
            {(() => {
              const maxAbs = Math.max(...entries.map((e) => Math.abs(e.returnValue)), 0.01)
              return entries.map((entry, i) => (
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
                  <span className="flex-1 truncate font-mono text-sm font-semibold tracking-wide">{entry.ticker}</span>
                  {/* Inline magnitude bar (CSS only, from the scalar return — no fetch) */}
                  <div className="hidden h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-foreground/[0.06] sm:block" aria-hidden>
                    <div
                      className={cn('h-full rounded-full', entry.returnValue >= 0 ? 'bg-gain' : 'bg-loss')}
                      style={{ width: `${Math.min(100, (Math.abs(entry.returnValue) / maxAbs) * 100)}%` }}
                    />
                  </div>
                  <span className={cn('shrink-0 font-editorial text-base font-bold tabular-nums', percentColor(entry.returnValue))}>
                    {formatPercent(entry.returnValue)}
                  </span>
                </motion.div>
              ))
            })()}
          </motion.div>
        )}
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
                  <span className="flex-1 truncate font-mono text-sm font-semibold tracking-wide">{asset.ticker}</span>
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
              <span className="text-muted-foreground">🔴 <strong className="tabular-nums text-foreground"><NumberTicker target={brief.strong_signals} format={(v) => Math.round(v).toString()} startOnView /></strong> fuertes</span>
              <span className="text-muted-foreground">🟡 <strong className="tabular-nums text-foreground"><NumberTicker target={brief.moderate_signals} format={(v) => Math.round(v).toString()} startOnView /></strong> moderadas</span>
              <span className="text-muted-foreground">⚪ <strong className="tabular-nums text-foreground"><NumberTicker target={brief.weak_noise} format={(v) => Math.round(v).toString()} startOnView /></strong> ruido</span>
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
    <div className="p-4 sm:p-6 max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-card" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
      </div>
      <Skeleton className="h-40 rounded-card" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-card" />)}
      </div>
      <Skeleton className="h-44 rounded-card" />
    </div>
  )
}
