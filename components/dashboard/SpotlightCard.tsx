'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'

// Card with a cursor-following radial spotlight (the .spotlight CSS reads
// --mx/--my). Pure pointer handler, no state/re-render, no extra deps.
// Falls back gracefully under prefers-reduced-motion (overlay hidden by CSS).
export function SpotlightCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return (
    // .spotlight > * is lifted above the ::before layer via globals.css,
    // so we keep Card as the direct flex parent (no wrapper that breaks layout).
    <Card onMouseMove={onMove} className={cn('spotlight gradient-border card-lift relative overflow-hidden', className)} {...props}>
      {children}
    </Card>
  )
}
