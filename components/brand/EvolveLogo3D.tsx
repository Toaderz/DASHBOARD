'use client'

// Evolve hero logo — the OFFICIAL circle-"e" monogram (concentric ring + a slashed
// inner circle, the brand's signature "e") rendered as a premium 3D object: a minted
// medallion turning slowly on a tilted turntable, catching a fixed sweep of signal-light.
//
// No 3D engine, no dependency: depth is built by extruding the SVG mark — stacking N
// thin copies along Z so the edge reads as a solid metal rim. The geometry/recognizability
// of the mark is preserved; only the material adapts to the dark hero (silver→signal-teal).
// Reduced motion → a single static tilted frame. Rotation pauses when the tab is hidden.

import { useEffect, useId } from 'react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'

interface EvolveLogo3DProps {
  /** Rendered width/height in px (the mark is square). */
  size?: number
  className?: string
  /** Seconds per full turn. Slower = more premium. */
  spinSeconds?: number
}

// Extrusion: thin stacked copies → coin thickness.
const LAYERS = 16
const DEPTH = 1.15 // px between layers
const VIEW = 120 // viewBox units
const TILT = 14 // fixed turntable tilt so it's never perfectly edge-on

export function EvolveLogo3D({ size = 240, className, spinSeconds = 20 }: EvolveLogo3DProps) {
  const reduced = useReducedMotion()
  const controls = useAnimationControls()
  const uid = useId().replace(/[:]/g, '')
  const faceGrad = `evolveFace-${uid}`
  const rimGrad = `evolveRim-${uid}`

  useEffect(() => {
    if (reduced) {
      controls.set({ rotateY: 26 }) // a flattering static three-quarter view
      return
    }
    let cancelled = false
    const spin = () => controls.start({ rotateY: 360 }, { duration: spinSeconds, ease: 'linear', repeat: Infinity })
    controls.set({ rotateY: 0 })
    spin()
    const onVis = () => {
      if (document.hidden) controls.stop()
      else if (!cancelled) spin()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      controls.stop()
    }
  }, [reduced, controls, spinSeconds])

  // The official monogram: outer ring + inner slashed circle (the Evolve "e").
  const Mark = ({ stroke }: { stroke: string }) => (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width={size}
      height={size}
      fill="none"
      stroke={stroke}
      strokeWidth={5}
      strokeLinecap="round"
      aria-hidden
      style={{ position: 'absolute', inset: 0, display: 'block' }}
    >
      <circle cx="60" cy="60" r="48" />
      <circle cx="60" cy="60" r="27" />
      <line x1="40" y1="80" x2="80" y2="40" />
    </svg>
  )

  return (
    <div
      className={className}
      style={{ width: size, height: size, perspective: size * 3.4, position: 'relative' }}
      role="img"
      aria-label="Evolve"
    >
      {/* Gradient defs (shared by all layers via id) */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient id={faceGrad} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor="hsl(var(--bone-bright))" />
            <stop offset="42%" stopColor="hsl(var(--electric-bright))" />
            <stop offset="100%" stopColor="hsl(var(--electric-dim))" />
          </linearGradient>
          <linearGradient id={rimGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--brand-teal))" />
            <stop offset="100%" stopColor="hsl(220 30% 16%)" />
          </linearGradient>
        </defs>
      </svg>

      {/* Soft contact glow under the medallion */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: '12% 8%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, hsl(var(--electric) / 0.30), transparent 68%)',
          filter: 'blur(22px)',
        }}
      />

      {/* Fixed turntable tilt */}
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateX(${TILT}deg)` }}>
        {/* Rotating group */}
        <motion.div animate={controls} style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
          {Array.from({ length: LAYERS }).map((_, i) => {
            const z = (i - (LAYERS - 1) / 2) * DEPTH
            const isFace = i === 0 || i === LAYERS - 1
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: `translateZ(${z}px)`,
                  transformStyle: 'preserve-3d',
                }}
              >
                <Mark stroke={isFace ? `url(#${faceGrad})` : `url(#${rimGrad})`} />
              </div>
            )
          })}
        </motion.div>
      </div>

      {/* Fixed specular sweep — the metal turns beneath a stationary light */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'radial-gradient(120% 90% at 32% 22%, hsl(var(--bone-bright) / 0.22), transparent 52%)',
          mixBlendMode: 'screen',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
