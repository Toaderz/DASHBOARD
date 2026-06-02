'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  LayoutDashboard, TrendingUp, TrendingDown, Swords, Newspaper,
  ArrowUpRight, Trophy, Activity, ListPlus,
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
import { PageHeader } from '@/components/dashboard/PageHeader'
import { StatCard } from '@/components/dashboard/StatCard'
import { NumberTicker } from '@/components/dashboard/NumberTicker'
import { SegmentedControl } from '@/components/dashboard/SegmentedControl'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'

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
      <div className="p-6">
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
              className="focus-ring inline-flex items-center gap-1.5 rounded-pill border border-electric/50 bg-electric/10 px-3 py-1.5 text-xs font-mono text-electric transition-colors hover:bg-electric/20"
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
    <div className="p-6 max-w-6xl space-y-6">
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

      <div data-tour="overview-grid" className="space-y-6">
        {/* ── KPI row ──────────────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={`Mejor activo · ${periodLabel}`}
            icon={Trophy}
            value={loadingReturns ? <Skeleton className="h-6 w-24" /> : best ? best.ticker : '—'}
            delta={loadingReturns ? null : best?.returnValue ?? null}
            sub={best ? best.name : 'Sin datos de retorno'}
            hint="Activo con mayor retorno (USD) en el período seleccionado."
          />
          <StatCard
            label={`Peor activo · ${periodLabel}`}
            icon={TrendingDown}
            value={loadingReturns ? <Skeleton className="h-6 w-24" /> : worst ? worst.ticker : '—'}
            delta={loadingReturns ? null : worst?.returnValue ?? null}
            sub={worst ? worst.name : 'Sin datos de retorno'}
            hint="Activo con menor retorno (USD) en el período seleccionado."
          />
          <StatCard
            label="Beating Peers"
            icon={Swords}
            value={
              loadingPeers
                ? <Skeleton className="h-6 w-16" />
                : <NumberTicker target={beatingCount} format={(v) => Math.round(v).toString()} />
            }
            sub={`Activos que ganan ≥${BEATING_THRESHOLD}/6 métricas vs sus peers`}
            hint="Cuántos de tus activos superan a ≥75% de sus peers en al menos 4 de los 6 períodos."
          />
        </div>

        {/* ── Market Snapshot ──────────────────────────────────────────── */}
        <MarketSnapshot />

        {/* ── Mini-leaderboards ────────────────────────────────────────── */}
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

        {/* ── Latest Market Brief ──────────────────────────────────────── */}
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
          <Activity className="h-4 w-4 text-electric" strokeWidth={1.75} />
          Market Snapshot
        </CardTitle>
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">En vivo</span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
          {BENCHMARKS.map((ticker) => {
            const q = prices[ticker]
            const label = BENCHMARK_LABELS[ticker] ?? ticker
            return (
              <div key={ticker} className="flex flex-col gap-0.5 bg-card p-3">
                <span className="truncate text-[11px] text-muted-foreground" title={label}>{label}</span>
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {q ? formatPrice(q.price) : <Skeleton className="inline-block h-4 w-16" />}
                </span>
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

// ── Internal: a "View all" link used in card headers ──────────────────────
function ViewAllLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex items-center gap-0.5 rounded-pill text-[11px] font-mono text-muted-foreground transition-colors hover:text-electric"
    >
      Ver todo
      <ArrowUpRight className="h-3 w-3" />
    </Link>
  )
}

const LEADER_RANK_STYLE: Record<number, string> = {
  0: 'text-electric',
  1: 'text-chart-3',
  2: 'text-chart-5',
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
    <Card className="flex flex-col">
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
          <div className="space-y-0.5">
            {entries.map((entry, i) => (
              <div key={entry.ticker} className="flex items-center gap-2 py-1">
                <span className={cn(
                  'w-4 shrink-0 text-right text-[11px] font-mono font-bold tabular-nums',
                  rankAccent ? (LEADER_RANK_STYLE[i] ?? 'text-muted-foreground') : 'text-muted-foreground'
                )}>
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-mono text-sm font-semibold">{entry.ticker}</span>
                <span className={cn('shrink-0 font-mono text-sm font-semibold tabular-nums', percentColor(entry.returnValue))}>
                  {formatPercent(entry.returnValue)}
                </span>
              </div>
            ))}
          </div>
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
    <Card className="flex flex-col">
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
          <div className="space-y-0.5">
            {top.map((asset) => (
              <div key={asset.ticker} className="flex items-center gap-2 py-1">
                <span className="flex-1 truncate font-mono text-sm font-semibold">{asset.ticker}</span>
                <span className={cn(
                  'shrink-0 font-mono text-sm font-semibold tabular-nums',
                  asset.metricsWon >= BEATING_THRESHOLD ? 'text-gain' : 'text-muted-foreground'
                )}>
                  {asset.metricsWon}/6
                </span>
              </div>
            ))}
          </div>
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
          <Newspaper className="h-4 w-4 text-electric" strokeWidth={1.75} />
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
              <span className="text-muted-foreground">🔴 <strong className="tabular-nums text-foreground">{brief.strong_signals}</strong> fuertes</span>
              <span className="text-muted-foreground">🟡 <strong className="tabular-nums text-foreground">{brief.moderate_signals}</strong> moderadas</span>
              <span className="text-muted-foreground">⚪ <strong className="tabular-nums text-foreground">{brief.weak_noise}</strong> ruido</span>
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
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-electric" />
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
    <div className="p-6 max-w-6xl space-y-6">
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
