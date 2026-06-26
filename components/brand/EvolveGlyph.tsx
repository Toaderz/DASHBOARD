// Evolve official mark — the circle-"e" monogram, drawn flat in `currentColor`.
// SINGLE source of the brand geometry: an outer ring with a gap at ~1 o'clock, an inner
// loop OPEN at the upper-right aperture, and a diagonal spine exiting through that opening.
// The open loop + asymmetric spine is what makes it read as a lowercase "e" — NOT a "ø".
// Reused in the dashboard sidebar/header; its path constants are the source the 3D hero
// logo (EvolveLogo3D) extrudes, so the two can never drift apart.
//
// Pure/presentational (no hooks) → importable from Server Components.

import { cn } from '@/lib/utils/cn'

// viewBox 0 0 120 120, center (60,60). Faithful to the official circle-"e" mark.
// The outer ring is a FULL closed circle; the inner loop is closed across the top and opens
// ONLY at the top-right (the "e" mouth) where the diagonal spine exits; the spine's lower end
// sits exactly on the rim (no poke-out) — reading unmistakably as a lowercase "e", not a "ø".
export const EVOLVE_OUTER_D = 'M60 10 A50 50 0 0 1 60 110 A50 50 0 0 1 60 10' // closed ring
export const EVOLVE_INNER_D = 'M84.7 52 A26 26 0 1 1 77.4 40.7' // inner loop, mouth at top-right only
export const EVOLVE_BAR_D = 'M43.3 79.9 L81.8 45.8' // diagonal spine, both ends on the rim
export const EVOLVE_VIEWBOX = 120

interface EvolveGlyphProps {
  size?: number
  className?: string
  /** Stroke in viewBox units (120-wide). */
  strokeWidth?: number
}

export function EvolveGlyph({ size = 26, className, strokeWidth = 6 }: EvolveGlyphProps) {
  return (
    <svg
      viewBox={`0 0 ${EVOLVE_VIEWBOX} ${EVOLVE_VIEWBOX}`}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path d={EVOLVE_OUTER_D} />
      <path d={EVOLVE_INNER_D} />
      <path d={EVOLVE_BAR_D} />
    </svg>
  )
}
