'use client'

import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { DUR, EASE_OUT } from '@/lib/motion-tokens'

// Lightweight route cross-fade for the dashboard shell. Lives INSIDE DashboardShell's
// <main> (a client component) so we never touch the server layout. Opacity-only + a small
// rise keeps it robust against App Router's streaming/Suspense boundaries.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const reduced = useReducedMotion()

  if (reduced) return <>{children}</>

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: DUR.base, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
