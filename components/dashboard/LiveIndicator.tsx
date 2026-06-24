import { cn } from '@/lib/utils/cn'

interface LiveIndicatorProps {
  label?: string
  className?: string
  /** Dot only, no pill chrome (for inline use next to a heading). */
  bare?: boolean
}

// Signature "● Live" pulse — one component, used consistently wherever data is
// streaming (marquee, brief, prices). The halo respects reduced motion.
export function LiveIndicator({ label = 'Live', className, bare = false }: LiveIndicatorProps) {
  const dot = (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-signal opacity-70 animate-ping motion-reduce:hidden" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
    </span>
  )

  if (bare) return <span className={cn('inline-flex items-center', className)}>{dot}</span>

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-pill border border-border bg-card/60 px-2.5 py-1 font-mono text-[11px] text-foreground', className)}>
      {dot}
      {label}
    </span>
  )
}
