'use client'

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/card'
import { formatPercent, percentColor } from '@/lib/utils/formatters'
import { Tooltip } from '@/components/ui/tooltip'

interface StatCardProps {
  label: string
  value: React.ReactNode
  /** Optional signed % shown as a colored delta chip. */
  delta?: number | null
  /** Secondary line under the value (e.g. ticker name). */
  sub?: React.ReactNode
  icon?: LucideIcon
  hint?: string
  className?: string
}

export function StatCard({ label, value, delta, sub, icon: Icon, hint, className }: StatCardProps) {
  const labelEl = (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
      {label}
    </span>
  )
  return (
    <Card className={cn('flex flex-col gap-1.5 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        {hint ? <Tooltip content={hint}>{labelEl}</Tooltip> : labelEl}
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={1.75} />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums leading-none text-foreground">{value}</span>
        {delta != null && (
          <span className={cn('text-xs font-mono font-semibold tabular-nums', percentColor(delta))}>
            {formatPercent(delta)}
          </span>
        )}
      </div>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </Card>
  )
}
