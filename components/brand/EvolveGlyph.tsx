// Evolve official mark — the circle-"e" monogram, drawn flat in `currentColor`.
// SINGLE source of the brand geometry: an outer ring with a gap at ~1 o'clock, an inner
// loop OPEN at the upper-right aperture, and a diagonal spine exiting through that opening.
// The open loop + asymmetric spine is what makes it read as a lowercase "e" — NOT a "ø".
// Reused in the dashboard sidebar/header; its path constants are the source the 3D hero
// logo (EvolveLogo3D) extrudes, so the two can never drift apart.
//
// Pure/presentational (no hooks) → importable from Server Components.

import { cn } from '@/lib/utils/cn'

// viewBox 0 0 120 120, center (60,60). Long-way arcs leave the gap at the top-right.
// The inner loop opens generously at the top-right (the "e" aperture/mouth) and the spine
// enters low-left and exits through that mouth — reading unmistakably as a lowercase "e".
export const EVOLVE_OUTER_D = 'M98.3 27.9 A50 50 0 1 1 75.5 12.4' // outer ring, gap ~40°–72°
export const EVOLVE_INNER_D = 'M85.1 53.3 A26 26 0 1 1 65.4 34.6' // inner loop, aperture ~15°–78°
export const EVOLVE_BAR_D = 'M40 79 L80 40' // diagonal spine, terminates at the aperture
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
