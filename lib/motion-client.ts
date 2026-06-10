'use client'

// Client-only motion mechanism: "the dashboard breathes with the market".
// usePulseOnChange compares the value prop to its previous render (useRef) — the
// SAME pattern as useRealtimePrices — and emits a one-shot tone when it changes.
// ZERO new data subscriptions: it only reacts to value props already updating on
// the 5s poll. <ValuePulse> wraps any readout to flash a subtle scale + ring pulse.

import { useEffect, useRef, useState, createElement } from 'react'
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export type PulseTone = 'up' | 'down' | 'neutral' | null

export function usePulseOnChange(value: number | null | undefined): PulseTone {
  const prev = useRef(value)
  const [tone, setTone] = useState<PulseTone>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const p = prev.current
    prev.current = value
    if (reduced || p == null || value == null || p === value) return
    setTone(value > p ? 'up' : 'down')
    const t = setTimeout(() => setTone(null), 900)
    return () => clearTimeout(t)
  }, [value, reduced])

  return tone
}

export function ValuePulse({
  value,
  tone = 'auto',
  children,
  className,
}: {
  value: number | null | undefined
  /** 'auto' colors by direction (gain/loss); 'teal' uses the rare spark for identity pulses. */
  tone?: 'auto' | 'teal'
  children: ReactNode
  className?: string
}) {
  const t = usePulseOnChange(value)
  const reduced = useReducedMotion()
  const ring =
    tone === 'teal'
      ? 'hsl(var(--electric) / 0.35)'
      : t === 'up'
        ? 'hsl(var(--gain) / 0.35)'
        : t === 'down'
          ? 'hsl(var(--loss) / 0.35)'
          : 'transparent'

  return createElement(
    motion.span,
    {
      className,
      style: { display: 'inline-flex', borderRadius: 8 },
      animate:
        reduced || !t
          ? { scale: 1, boxShadow: '0 0 0 0 transparent' }
          : {
              scale: [1, 1.035, 1],
              boxShadow: ['0 0 0 0 transparent', `0 0 0 4px ${ring}`, '0 0 0 0 transparent'],
            },
      transition: { duration: 0.85, ease: 'easeOut' },
    },
    children
  )
}
