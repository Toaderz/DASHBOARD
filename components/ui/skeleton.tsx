import { cn } from '@/lib/utils/cn'

// Shimmer skeleton — a light sweep crosses a faint surface (premium loading).
// Falls back to a static surface under reduced motion.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-foreground/[0.06]', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-foreground/10 to-transparent motion-reduce:hidden" />
    </div>
  )
}

export { Skeleton }
