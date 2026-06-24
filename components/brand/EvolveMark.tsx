'use client'

// Evolve living brand mark — a SINGLE source reused everywhere (login, sidebar,
// loaders, transitions, empty states). The emblem: an ascending network of nodes
// climbing to a bright "signal" apex — evolution + connected intelligence, NOT a
// market chart line. The chrome (line + base nodes) uses `currentColor` (mist), the
// apex uses the brand accent. Movement is disciplined and reduced-motion-aware.

import { useRef } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { SPRING_CURSOR, EASE_OUT } from '@/lib/motion-tokens'

// Ascending node path (viewBox 0 0 40 40). Apex = last point (the bright signal).
const NODES = [
  { x: 8,  y: 28 },
  { x: 16, y: 19 },
  { x: 24, y: 24 },
  { x: 32, y: 9 },
]
const PATH_D = `M${NODES.map((n) => `${n.x} ${n.y}`).join(' L')}`
const APEX = NODES[NODES.length - 1]

interface EvolveMarkProps {
  size?: number
  className?: string
  /** Cursor-reactive parallax tilt + apex glow (login hero). */
  interactive?: boolean
  /** Very subtle idle breathing on the apex (sidebar). */
  idle?: boolean
  /** Ambient accent glow behind the apex. */
  withGlow?: boolean
  strokeWidth?: number
}

export function EvolveMark({
  size = 32,
  className,
  interactive = false,
  idle = false,
  withGlow = true,
  strokeWidth = 2.2,
}: EvolveMarkProps) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), SPRING_CURSOR)
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-10, 10]), SPRING_CURSOR)

  const handleMove = (e: React.PointerEvent) => {
    if (reduced || !interactive) return
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }
  const reset = () => { mx.set(0); my.set(0) }

  return (
    <motion.div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      className={cn('relative inline-flex shrink-0', className)}
      style={{
        width: size,
        height: size,
        perspective: interactive ? 400 : undefined,
      }}
    >
      <motion.svg
        viewBox="0 0 40 40"
        width={size}
        height={size}
        fill="none"
        style={interactive && !reduced ? { rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' } : undefined}
        whileHover={interactive && !reduced ? { scale: 1.05 } : undefined}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        aria-hidden
      >
        {/* connecting edges (mist / currentColor) */}
        <path
          d={PATH_D}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
        {/* base nodes */}
        {NODES.slice(0, -1).map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={2.4} fill="currentColor" opacity={0.9} />
        ))}
        {/* apex glow */}
        {withGlow && (
          <circle
            cx={APEX.x}
            cy={APEX.y}
            r={5.5}
            fill="hsl(var(--electric))"
            opacity={0.28}
            style={{ filter: 'blur(3px)' }}
          />
        )}
        {/* apex signal node */}
        <motion.circle
          cx={APEX.x}
          cy={APEX.y}
          r={3.1}
          fill="hsl(var(--electric))"
          animate={idle && !reduced ? { opacity: [1, 0.55, 1], scale: [1, 0.9, 1] } : undefined}
          transition={idle && !reduced ? { duration: 2.6, ease: 'easeInOut', repeat: Infinity } : undefined}
          style={{ transformOrigin: `${APEX.x}px ${APEX.y}px` }}
        />
      </motion.svg>
    </motion.div>
  )
}

interface EvolveLoaderProps {
  size?: number
  className?: string
  label?: string
}

/** Brand loader — the mark draws itself in a loop. Replaces generic spinners. */
export function EvolveLoader({ size = 40, className, label = 'Cargando' }: EvolveLoaderProps) {
  const reduced = useReducedMotion()

  return (
    <div className={cn('inline-flex flex-col items-center gap-3 text-mist-dim', className)} role="status" aria-label={label}>
      <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden>
        <motion.path
          d={PATH_D}
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? { pathLength: 1, opacity: 0.9 } : { pathLength: 0, opacity: 0.4 }}
          animate={reduced ? undefined : { pathLength: [0, 1, 1], opacity: [0.4, 1, 0.4] }}
          transition={reduced ? undefined : { duration: 1.8, ease: 'easeInOut', repeat: Infinity, times: [0, 0.7, 1] }}
        />
        <motion.circle
          cx={APEX.x}
          cy={APEX.y}
          r={3.4}
          fill="hsl(var(--electric))"
          initial={{ opacity: reduced ? 1 : 0, scale: reduced ? 1 : 0.4 }}
          animate={reduced ? undefined : { opacity: [0, 1, 0.5], scale: [0.4, 1.1, 1] }}
          transition={reduced ? undefined : { duration: 1.8, ease: 'easeOut', repeat: Infinity, times: [0, 0.75, 1] }}
          style={{ transformOrigin: `${APEX.x}px ${APEX.y}px` }}
        />
      </svg>
      {label && <span className="sr-only">{label}</span>}
    </div>
  )
}
