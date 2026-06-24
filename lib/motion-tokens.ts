// Motion tokens — PURE constants, NO 'use client' (importable from Server Components).
// Single source of truth for durations/easings/variants so motion stays consistent,
// mirroring how lib/chart-theme.ts centralizes color.

import type { Variants, Transition } from 'framer-motion'

// Easing curves
export const EASE_OUT = [0.22, 1, 0.36, 1] as const // smooth "settle" (Fey-like)
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const

// Durations (seconds)
export const DUR = { fast: 0.18, base: 0.28, slow: 0.5, ambient: 0.9 } as const

// Spring presets
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 60, damping: 18 } // layout reorders
export const SPRING_SNAP: Transition = { type: 'spring', stiffness: 220, damping: 26 } // chips/badges
export const SPRING_CURSOR: Transition = { type: 'spring', stiffness: 120, damping: 20, mass: 0.6 } // cursor-follow parallax
export const TICKER_SPRING = { stiffness: 50, damping: 15 } as const // matches NumberTicker today

// Stagger gaps (seconds)
export const STAGGER = 0.05
export const STAGGER_FAST = 0.03

// Reusable variants
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
}
// Premium reveal — opacity + slight blur lift (calm, Lovable-like). Use for hero/cards.
export const fadeBlur: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: DUR.slow, ease: EASE_OUT } },
}
// Scale-in — for modals, popovers, command palette, toasts.
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 6 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: DUR.base, ease: EASE_OUT } },
}
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER, delayChildren: 0.04 } },
}

// Shared-element (row → modal) — same layoutId on both ends so they can't drift.
export const assetLayoutId = (ticker: string) => `asset-${ticker}`
export const morphTransition: Transition = { type: 'spring', stiffness: 380, damping: 34 }
