'use client'

import { motion } from 'framer-motion'
import { Newspaper } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { fadeUp, staggerContainer } from '@/lib/motion-tokens'
import { useNewsBrief } from '@/hooks/useNewsBrief'
import { useWatchlists, useWatchlistAssets } from '@/hooks/useWatchlistAssets'
import { WeeklyBriefCard } from '@/components/dashboard/WeeklyBriefCard'
import { NewsCard } from '@/components/dashboard/NewsCard'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { LiveIndicator } from '@/components/dashboard/LiveIndicator'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ActiveWatchlistTickers({ watchlistId, children }: { watchlistId: string; children: (tickers: string[]) => React.ReactNode }) {
  const { assets } = useWatchlistAssets(watchlistId)
  return <>{children(assets.map((a) => a.ticker))}</>
}

export function NewsBlock() {
  const { data, isLoading } = useNewsBrief()
  const { watchlists } = useWatchlists()
  const firstWatchlistId = watchlists[0]?.id ?? ''

  if (isLoading) {
    return (
      <div className="space-y-8 px-4 py-6 sm:px-6">
        <div className="space-y-2 border-b border-border pb-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-64 w-full rounded-card" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full rounded-card" />
          ))}
        </div>
      </div>
    )
  }

  const brief = data?.data
  const stale = data?.stale ?? false

  if (!brief) {
    return (
      <div className="space-y-6 px-4 py-6 sm:px-6">
        <header className="border-b border-border pb-5">
          <p className="eyebrow">Brief semanal · EE.UU. / México</p>
          <h1 className="mt-1 font-editorial text-3xl font-bold leading-none tracking-tight text-foreground sm:text-4xl">
            Market Brief
          </h1>
        </header>
        <EmptyState
          icon={Newspaper}
          title="No hay un brief disponible todavía"
          description="El pipeline corre los lunes y viernes a las 07:00 MX."
        />
      </div>
    )
  }

  const sortedNews = [...(brief.market_news ?? [])].sort((a, b) => a.rank - b.rank)

  const grid = (tickers: string[]) => (
    <motion.div
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      variants={staggerContainer}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-10%' }}
    >
      {sortedNews.map((news, i) => (
        <motion.div key={news.id} variants={fadeUp} className={i === 0 ? 'md:col-span-2' : ''}>
          <NewsCard news={news} userTickers={tickers} index={i} featured={i === 0} />
        </motion.div>
      ))}
    </motion.div>
  )

  return (
    <div className="space-y-8 px-4 py-6 sm:px-6">
      {/* Masthead */}
      <header className="border-b border-border pb-5">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Brief semanal · EE.UU. / México</p>
            <h1 className="mt-1 font-editorial text-3xl font-bold leading-none tracking-tight text-foreground sm:text-4xl">
              Market Brief
            </h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {formatDate(brief.period_start)} – {formatDate(brief.period_end)}
            </p>
          </div>
          {stale ? (
            <span className="shrink-0 rounded-pill border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              Hace {Math.floor((Date.now() - new Date(brief.created_at).getTime()) / 86400000)}d
            </span>
          ) : (
            <LiveIndicator />
          )}
        </div>
      </header>

      {/* Stale banner */}
      {stale && (
        <div className="rounded-card border-l-2 border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          Mostrando brief del {formatDate(brief.created_at)} — próxima actualización el lunes o viernes a las 07:00 MX.
        </div>
      )}

      {/* Editorial cover */}
      <WeeklyBriefCard brief={brief} />

      {/* Coverage */}
      {sortedNews.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <p className="eyebrow shrink-0">Cobertura · {sortedNews.length} {sortedNews.length === 1 ? 'nota' : 'notas'}</p>
            <span className="h-px flex-1 bg-border" />
          </div>
          {firstWatchlistId ? (
            <ActiveWatchlistTickers watchlistId={firstWatchlistId}>
              {(tickers) => grid(tickers)}
            </ActiveWatchlistTickers>
          ) : (
            grid([])
          )}
        </section>
      )}
    </div>
  )
}
