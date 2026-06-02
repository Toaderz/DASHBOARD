'use client'

import { useState, useEffect } from 'react'
import { useMotionValue, useSpring } from 'framer-motion'

// Animates from 0 → `target`, rendering each frame through `format`.
// Extracted from FundamentalsPanel so Overview StatCards can reuse it.
export function NumberTicker({
  target,
  format,
  className = 'tabular-nums',
}: {
  target: number
  format: (v: number) => string
  className?: string
}) {
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { stiffness: 50, damping: 15 })
  const [display, setDisplay] = useState(format(0))

  useEffect(() => { motionValue.set(target) }, [target, motionValue])
  useEffect(() => spring.on('change', (v) => setDisplay(format(v))), [spring, format])

  return <span className={className}>{display}</span>
}
