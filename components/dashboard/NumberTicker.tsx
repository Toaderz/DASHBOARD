'use client'

import { useState, useEffect, useRef } from 'react'
import { useMotionValue, useSpring, useReducedMotion, useInView } from 'framer-motion'
import { TICKER_SPRING } from '@/lib/motion-tokens'

// Animates from 0 → `target`, rendering each frame through `format`.
// Reused by Overview StatCards, FundamentalsPanel, the hero, brief counts.
// Reduced-motion → shows the final value instantly. `startOnView` defers the
// count-up until the element scrolls into view (for below-the-fold KPIs).
export function NumberTicker({
  target,
  format,
  className = 'tabular-nums',
  startOnView = false,
}: {
  target: number
  format: (v: number) => string
  className?: string
  startOnView?: boolean
}) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10%' })
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, TICKER_SPRING)
  const [display, setDisplay] = useState(format(reduced ? target : 0))

  useEffect(() => {
    if (reduced) { setDisplay(format(target)); return }
    if (startOnView && !inView) return
    motionValue.set(target)
  }, [target, motionValue, reduced, startOnView, inView, format])

  useEffect(() => {
    if (reduced) return
    return spring.on('change', (v) => setDisplay(format(v)))
  }, [spring, format, reduced])

  return <span ref={ref} className={className}>{display}</span>
}
