'use client'

import { Card } from '@/components/ui/card'
import { NumberTicker } from '@/components/dashboard/NumberTicker'
import type { MarketBrief, WatchlistItem } from '@/types'

const intFmt = (v: number) => Math.round(v).toString()

interface Props {
  brief: MarketBrief
}

// Editorial priority colors (red/amber/neutral) — documented V2 exception, signal-carrying.
const priorityDot: Record<WatchlistItem['priority'], string> = {
  Alta:  'bg-red-500',
  Media: 'bg-amber-400',
  Baja:  'bg-bone-dim',
}

export function WeeklyBriefCard({ brief }: Props) {
  const paragraphs = (brief.context_md ?? '').split('\n\n').filter(Boolean)
  const watchlistItems = brief.metadata?.watchlist_items ?? []

  const stats = [
    { label: 'Señales fuertes',    value: brief.strong_signals,   dot: 'bg-red-500' },
    { label: 'Moderadas',          value: brief.moderate_signals, dot: 'bg-amber-400' },
    { label: 'Ruido / baja rel.',  value: brief.weak_noise,       dot: 'bg-bone-dim' },
  ]

  return (
    <Card className="grain relative overflow-hidden p-0">
      <div className="grid lg:grid-cols-[1.7fr_1fr]">
        {/* Left — editorial narrative */}
        <div className="p-6 sm:p-8 lg:border-r lg:border-border">
          <p className="eyebrow">Resumen de la semana</p>

          {brief.top_theme && (
            <h2 className="mt-2 font-editorial text-2xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-[1.75rem]">
              {brief.top_theme}
            </h2>
          )}

          {brief.key_risk && (
            <div className="mt-3 flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-pill border border-red-500/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">
                Riesgo
              </span>
              <p className="text-sm leading-snug text-muted-foreground">{brief.key_risk}</p>
            </div>
          )}

          {paragraphs.length > 0 && (
            <div className="mt-6 max-w-prose space-y-3">
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  className={
                    i === 0
                      ? 'text-[15px] leading-7 text-foreground/90 first-letter:float-left first-letter:mr-2.5 first-letter:mt-1 first-letter:font-editorial first-letter:text-5xl first-letter:font-bold first-letter:leading-[0.7] first-letter:text-foreground'
                      : 'text-[15px] leading-7 text-foreground/80'
                  }
                >
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Right — signal pulse + watchlist (raised panel) */}
        <div className="space-y-6 bg-muted/30 p-6 sm:p-8">
          <div>
            <p className="eyebrow mb-3">Pulso de señales</p>
            <div className="space-y-3">
              {stats.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2.5 last:border-0 last:pb-0">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                    {s.label}
                  </span>
                  <strong className="font-editorial text-2xl tabular-nums text-foreground">
                    <NumberTicker target={s.value} format={intFmt} startOnView />
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {watchlistItems.length > 0 && (
            <div className="border-t border-border pt-5">
              <p className="eyebrow mb-3">Qué vigilar</p>
              <ul className="space-y-2.5">
                {watchlistItems.map((w, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${priorityDot[w.priority]}`} />
                    <span className="leading-snug text-muted-foreground">{w.item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
