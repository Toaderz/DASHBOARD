'use client'

// Scene 1 — "Precios en vivo." Mock watchlist rows that tick and flash green/red, with
// the signature Live pill. Speaks the platform's real table language (PriceCell flash +
// LiveIndicator) with scripted data — no network, no hooks. Ticking pauses under reduced
// motion and while the tab is hidden.

import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { AssetType } from '@/types'
import { Card } from '@/components/ui/card'
import { LiveIndicator } from '@/components/dashboard/LiveIndicator'
import { typeBadgeClass, typeLabel } from '@/lib/asset-style'
import { formatPrice, formatPercent, percentColor } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'

interface Row {
  ticker: string
  name: string
  type: AssetType
  price: number
  pct: number
  tone: 'up' | 'down' | null
  key: number
}

const SEED: Omit<Row, 'tone' | 'key'>[] = [
  { ticker: 'NVDA', name: 'NVIDIA', type: 'stock', price: 184.32, pct: 2.14 },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', type: 'etf', price: 512.88, pct: 0.92 },
  { ticker: 'SPY', name: 'SPDR S&P 500', type: 'etf', price: 642.17, pct: -0.38 },
  { ticker: 'AAPL', name: 'Apple Inc.', type: 'stock', price: 268.05, pct: 1.27 },
]

export function LivePricesScene() {
  const reduced = useReducedMotion()
  const [rows, setRows] = useState<Row[]>(() => SEED.map((r, i) => ({ ...r, tone: null, key: i })))

  useEffect(() => {
    if (reduced) return
    const id = window.setInterval(() => {
      if (document.hidden) return
      setRows((prev) => {
        const i = Math.floor(Math.random() * prev.length)
        return prev.map((r, idx) => {
          if (idx !== i) return r
          const delta = (Math.random() - 0.45) * (r.price * 0.0016)
          const price = Math.max(1, r.price + delta)
          const up = delta >= 0
          return { ...r, price, pct: r.pct + (up ? 0.03 : -0.03), tone: up ? 'up' : 'down', key: r.key + 1 }
        })
      })
    }, 1700)
    return () => window.clearInterval(id)
  }, [reduced])

  return (
    <Card className="glass overflow-hidden p-0 shadow-pop">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Tu watchlist</span>
        <LiveIndicator />
      </div>
      <div className="divide-y divide-border/50">
        {rows.map((r) => (
          <div key={r.ticker} className="flex items-center gap-3 px-4 py-3">
            <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold', typeBadgeClass(r.type))}>
              {typeLabel(r.type)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{r.ticker}</p>
              <p className="truncate text-xs text-muted-foreground">{r.name}</p>
            </div>
            <span
              key={r.key}
              className={cn(
                'rounded px-1.5 font-mono text-sm tabular text-foreground',
                r.tone === 'up' && 'animate-flash-green',
                r.tone === 'down' && 'animate-flash-red',
              )}
            >
              {formatPrice(r.price)}
            </span>
            <span className={cn('w-16 text-right font-mono text-xs tabular', percentColor(r.pct))}>
              {formatPercent(r.pct)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
