import { cn } from '@/lib/utils/cn'

// Deterministic monogram chip for an asset — no network, full coverage.
// V2 "color escaso = caro": a single calm BONE chip (no rainbow hash) — the chip is
// chrome, the ticker text beside it carries identity. Same look for every asset.
const MONO_STYLE = 'bg-foreground/[0.08] text-foreground/80 border border-border/60'

export function AssetMonogram({
  ticker,
  size = 'md',
  className,
}: {
  ticker: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const clean = ticker.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const initials = clean.slice(0, 2) || '?'
  const dims = size === 'sm' ? 'h-5 w-5 text-[9px]' : 'h-8 w-8 text-xs'
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-mono font-bold leading-none tracking-tight',
        dims,
        MONO_STYLE,
        className
      )}
    >
      {initials}
    </span>
  )
}
