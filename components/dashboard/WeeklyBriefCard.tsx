'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NumberTicker } from '@/components/dashboard/NumberTicker'
import type { MarketBrief, WatchlistItem } from '@/types'

const intFmt = (v: number) => Math.round(v).toString()

interface Props {
  brief: MarketBrief
}

// Editorial priority colors (red/amber/neutral dots) — intentional, do not change.
const priorityConfig: Record<WatchlistItem['priority'], { badge: string; dot: string }> = {
  Alta:  { badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',     dot: 'bg-red-500' },
  Media: { badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300', dot: 'bg-amber-400' },
  Baja:  { badge: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', dot: 'bg-gray-400' },
}

export function WeeklyBriefCard({ brief }: Props) {
  const paragraphs = (brief.context_md ?? '').split('\n\n').filter(Boolean)
  const watchlistItems = brief.metadata?.watchlist_items ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-editorial text-sm tracking-tight">
          Resumen de la semana
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Signal counts */}
        <div className="flex flex-wrap gap-4 text-sm">
          <span>🔴 <strong className="tabular-nums"><NumberTicker target={brief.strong_signals} format={intFmt} startOnView /></strong> señales fuertes</span>
          <span>🟡 <strong className="tabular-nums"><NumberTicker target={brief.moderate_signals} format={intFmt} startOnView /></strong> señales moderadas</span>
          <span>⚪ <strong className="tabular-nums"><NumberTicker target={brief.weak_noise} format={intFmt} startOnView /></strong> ruido / baja relevancia</span>
        </div>

        {/* Tema + riesgo */}
        {brief.top_theme && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Tema dominante:</span>{' '}
            {brief.top_theme}
          </p>
        )}
        {brief.key_risk && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Riesgo clave:</span>{' '}
            {brief.key_risk}
          </p>
        )}

        {/* Narrativa macro (3 párrafos) */}
        {paragraphs.length > 0 && (
          <div className="border-t border-border pt-3 space-y-2">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        )}

        {/* Watchlist de seguimiento */}
        {watchlistItems.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-[11px] font-mono text-muted-foreground mb-2 uppercase tracking-wider">
              Qué vigilar esta semana
            </p>
            <ul className="space-y-1.5">
              {watchlistItems.map((w, i) => {
                const cfg = priorityConfig[w.priority]
                return (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1 shrink-0 inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-mono font-semibold ${cfg.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                      {w.priority}
                    </span>
                    <span className="text-muted-foreground leading-snug">{w.item}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
