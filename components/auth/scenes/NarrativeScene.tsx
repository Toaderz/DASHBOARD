'use client'

// Shared shell for a login narrative scene: an eyebrow kicker + editorial headline +
// one-line description + a product-language visual. Reveals on scroll-in (once), fully
// gated by reduced motion. Pure presentational — no data, no network.

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { fadeUp, staggerContainer } from '@/lib/motion-tokens'
import { cn } from '@/lib/utils/cn'

type Accent = 'signal' | 'gain' | 'loss'

const ACCENT_TEXT: Record<Accent, string> = {
  signal: 'text-signal',
  gain: 'text-gain',
  loss: 'text-loss',
}

interface NarrativeSceneProps {
  eyebrow: string
  title: ReactNode
  desc: string
  accent?: Accent
  children: ReactNode
  className?: string
}

export function NarrativeScene({ eyebrow, title, desc, accent = 'signal', children, className }: NarrativeSceneProps) {
  const reduced = useReducedMotion()
  return (
    <motion.section
      variants={reduced ? undefined : staggerContainer}
      initial={reduced ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '-12% 0px -12% 0px' }}
      className={cn('py-14 lg:py-20', className)}
    >
      <motion.p variants={reduced ? undefined : fadeUp} className={cn('eyebrow', ACCENT_TEXT[accent])}>
        {eyebrow}
      </motion.p>
      <motion.h3
        variants={reduced ? undefined : fadeUp}
        className="mt-3 font-editorial text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl"
      >
        {title}
      </motion.h3>
      <motion.p variants={reduced ? undefined : fadeUp} className="mt-3 max-w-md text-[15px] leading-7 text-muted-foreground">
        {desc}
      </motion.p>
      <motion.div variants={reduced ? undefined : fadeUp} className="mt-7">
        {children}
      </motion.div>
    </motion.section>
  )
}
