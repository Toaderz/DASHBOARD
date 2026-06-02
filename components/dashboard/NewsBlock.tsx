'use client'

import { Newspaper } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useNewsBrief } from '@/hooks/useNewsBrief'
import { useWatchlists, useWatchlistAssets } from '@/hooks/useWatchlistAssets'
import { WeeklyBriefCard } from '@/components/dashboard/WeeklyBriefCard'
import { NewsCard } from '@/components/dashboard/NewsCard'
import { PageHeader } from '@/components/dashboard/PageHeader'
import { EmptyState } from '@/components/dashboard/EmptyState'

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
      <div className="px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-card" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-card" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      <div className="px-4 py-6 space-y-5">
        <PageHeader title="Market Brief" icon={Newspaper} />
        <EmptyState
          icon={Newspaper}
          title="No hay un brief disponible todavía"
          description="El pipeline corre los lunes y viernes a las 07:00 MX."
        />
      </div>
    )
  }

  const sortedNews = [...(brief.market_news ?? [])].sort((a, b) => a.rank - b.rank)

  return (
    <div className="px-4 py-6 space-y-5">
      {/* Header */}
      <PageHeader
        title="Market Brief"
        icon={Newspaper}
        description={
          <span className="font-mono text-xs">
            {formatDate(brief.period_start)} – {formatDate(brief.period_end)}
          </span>
        }
        actions={
          stale ? (
            <span className="rounded-pill bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 px-2.5 py-1 text-[11px] font-mono">
              Actualizado hace {Math.floor((Date.now() - new Date(brief.created_at).getTime()) / 86400000)}d
            </span>
          ) : (
            <span className="rounded-pill bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-2.5 py-1 text-[11px] font-mono">
              ● Live
            </span>
          )
        }
      />

      {/* Stale banner */}
      {stale && (
        <div className="rounded-card border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          Mostrando brief del {formatDate(brief.created_at)} — próxima actualización el lunes o viernes a las 07:00 MX.
        </div>
      )}

      {/* Weekly summary card */}
      <WeeklyBriefCard brief={brief} />

      {/* News grid */}
      {firstWatchlistId ? (
        <ActiveWatchlistTickers watchlistId={firstWatchlistId}>
          {(tickers) => (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedNews.map((news) => (
                <NewsCard key={news.id} news={news} userTickers={tickers} />
              ))}
            </div>
          )}
        </ActiveWatchlistTickers>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedNews.map((news) => (
            <NewsCard key={news.id} news={news} userTickers={[]} />
          ))}
        </div>
      )}
    </div>
  )
}
