'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import type { FlashState } from '@/types'

interface AnimatedPriceProps {
  value: string
  flash: FlashState
  className?: string
}

export function AnimatedPrice({ value, flash, className }: AnimatedPriceProps) {
  return (
    <span className={cn('relative inline-block overflow-hidden', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: flash === 'up' ? 10 : flash === 'down' ? -10 : 0, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: flash === 'up' ? -10 : flash === 'down' ? 10 : 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={cn(
            'inline-block font-mono tabular-nums',
            flash === 'up' && 'text-gain',
            flash === 'down' && 'text-loss',
            !flash && 'text-foreground'
          )}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
