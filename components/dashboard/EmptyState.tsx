import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { EvolveMark } from '@/components/brand/EvolveMark'

interface EmptyStateProps {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  compact?: boolean
}

// Friendly empty/zero state. Defaults to the Evolve brand mark as its motif (so
// even empty screens feel like Evolve); falls back to a passed Lucide icon.
// Used across Overview, performers, peers, news and the watchlist table.
export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card/40 text-center',
        compact ? 'gap-2 p-6' : 'gap-4 p-12',
        className
      )}
    >
      {Icon ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-ink-elevated text-muted-foreground">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-card border border-border bg-ink-elevated text-bone-dim/70 shadow-card">
          <EvolveMark size={26} idle withGlow={false} />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && <p className="mx-auto max-w-sm text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
