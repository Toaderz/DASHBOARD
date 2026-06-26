'use client'

// Scene 2 — "Compárate con tus pares." Divergent won/lost bars that fill on scroll-in,
// mirroring PeerCard: each holding measured against its real competition. Scripted data.

import { motion, useReducedMotion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { EASE_OUT } from '@/lib/motion-tokens'
import { cn } from '@/lib/utils/cn'

const PEERS = [
  { ticker: 'RDVY', won: 5, total: 6 },
  { ticker: 'SDVY', won: 4, total: 6 },
  { ticker: 'VIG', won: 3, total: 6 },
]

export function PeersScene() {
  const reduced = useReducedMotion()
  return (
    <Card className="glass space-y-5 p-5 shadow-pop">
      {PEERS.map((p, i) => {
        const pctWon = (p.won / p.total) * 100
        return (
          <div key={p.ticker} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">{p.ticker}</span>
              <span className="font-mono text-xs text-muted-foreground">
                ganó a <span className="text-gain">{p.won}</span>/{p.total} pares
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-pill bg-muted/50">
              <motion.div
                className={cn('h-full rounded-pill', pctWon >= 50 ? 'bg-gain' : 'bg-loss')}
                initial={reduced ? false : { width: 0 }}
                whileInView={{ width: `${pctWon}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.1 + i * 0.08 }}
                style={reduced ? { width: `${pctWon}%` } : undefined}
              />
            </div>
          </div>
        )
      })}
    </Card>
  )
}
