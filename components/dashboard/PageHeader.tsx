import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

type Accent = 'signal' | 'gain' | 'loss' | 'mist'

interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  /** Small uppercase label above the title — part of each view's identity. */
  eyebrow?: React.ReactNode
  icon?: LucideIcon
  /** Per-view accent applied to the eyebrow + icon chip. Default 'mist'. */
  accent?: Accent
  actions?: React.ReactNode
  className?: string
}

const ACCENT: Record<Accent, { text: string; chip: string }> = {
  signal: { text: 'text-signal', chip: 'text-signal border-signal/25 bg-signal/[0.06]' },
  gain:   { text: 'text-gain',   chip: 'text-gain border-gain/25 bg-gain/[0.06]' },
  loss:   { text: 'text-loss',   chip: 'text-loss border-loss/25 bg-loss/[0.06]' },
  mist:   { text: 'text-bone-dim', chip: 'text-bone-dim border-border bg-card' },
}

// Consistent masthead: eyebrow + editorial title + optional icon, description, and
// a right-aligned actions slot. The `accent` + `eyebrow` give each view a subtle,
// recognizable identity while sharing one system.
export function PageHeader({ title, description, eyebrow, icon: Icon, accent = 'mist', actions, className }: PageHeaderProps) {
  const a = ACCENT[accent]
  return (
    <div className={cn('flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex items-start gap-3.5 min-w-0">
        {Icon && (
          <span className={cn('mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-card border shadow-card', a.chip)}>
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className={cn('mb-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]', a.text)}>{eyebrow}</p>}
          <h1 className="font-editorial text-2xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
