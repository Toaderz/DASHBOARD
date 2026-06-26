'use client'

// Scene — "Tus mejores activos." A ranked leaderboard of top performers that fills in on
// scroll, mirroring the Overview's mini-leaderboard: rank + ticker + name + return, each
// with a magnitude bar proportional to the best. Scripted/illustrative data — no network.

import { motion, useReducedMotion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { formatPercent, percentColor } from '@/lib/utils/formatters'
import { EASE_OUT } from '@/lib/motion-tokens'

const TOP = [
  { ticker: 'PS', name: 'Pershing Square', pct: 6.82 },
  { ticker: 'UBER', name: 'Uber Technologies', pct: 5.26 },
  { ticker: 'MSFT', name: 'Microsoft', pct: 5.09 },
  { ticker: 'FTNL', name: 'First Trust Nasdaq Lux', pct: 3.46 },
]

const MAX = Math.max(...TOP.map((t) => t.pct))

export function TopAssetsScene() {
  const reduced = useReducedMotion()
  return (
    <Card className="glass space-y-4 p-5 shadow-pop">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Mejores activos</span>
        <span className="font-mono text-[11px] text-muted-foreground">30D · USD</span>
      </div>
      <div className="space-y-3.5">
        {TOP.map((t, i) => {
          const w = (t.pct / MAX) * 100
          return (
            <div key={t.ticker} className="space-y-1.5">
              <div className="flex items-center gap-3 text-sm">
                <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <span className="shrink-0 font-semibold text-foreground">{t.ticker}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.name}</span>
                <span className={cnPct(t.pct)}>{formatPercent(t.pct)}</span>
              </div>
              <div className="ml-7 h-1.5 overflow-hidden rounded-pill bg-muted/50">
                <motion.div
                  className="h-full rounded-pill bg-gain"
                  initial={reduced ? false : { width: 0 }}
                  whileInView={{ width: `${w}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.1 + i * 0.08 }}
                  style={reduced ? { width: `${w}%` } : undefined}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function cnPct(pct: number) {
  return `shrink-0 font-mono text-sm tabular ${percentColor(pct)}`
}
