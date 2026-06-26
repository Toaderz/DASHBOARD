'use client'

// Scene 3 — "Compara lado a lado." Growth-of-$10,000 curves that draw in on scroll,
// mirroring CompareGrowthChart. Scripted series; colors from the chart token ramp.

import { motion, useReducedMotion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { EASE_OUT } from '@/lib/motion-tokens'

const SERIES = [
  { ticker: 'RDVY', color: 'hsl(var(--chart-1))', d: 'M8 112 L60 100 L112 96 L164 78 L216 68 L268 46 L312 28' },
  { ticker: 'SDVY', color: 'hsl(var(--chart-3))', d: 'M8 112 L60 104 L112 101 L164 92 L216 84 L268 72 L312 56' },
  { ticker: 'VIG', color: 'hsl(var(--chart-5))', d: 'M8 112 L60 108 L112 110 L164 101 L216 103 L268 92 L312 82' },
]

export function CompareScene() {
  const reduced = useReducedMotion()
  return (
    <Card className="glass p-5 shadow-pop">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">Crecimiento de $10,000</span>
        <div className="flex gap-3">
          {SERIES.map((s) => (
            <span key={s.ticker} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.ticker}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 320 130" className="w-full" fill="none" aria-hidden>
        <line x1="8" y1="118" x2="312" y2="118" stroke="hsl(var(--bone) / 0.12)" strokeWidth="1" />
        {SERIES.map((s, i) => (
          <motion.path
            key={s.ticker}
            d={s.d}
            stroke={s.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduced ? false : { pathLength: 0, opacity: 0.3 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.1 + i * 0.12 }}
          />
        ))}
      </svg>
    </Card>
  )
}
