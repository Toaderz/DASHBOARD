'use client'

// Lightweight toast system (no new dependency). Provider holds the queue and
// exposes `useToast().toast({...})`; the viewport renders glass cards bottom-right
// with framer-motion enter/exit and auto-dismiss. Accessible via aria-live.

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { EASE_OUT } from '@/lib/motion-tokens'

type Variant = 'success' | 'error' | 'info'
interface ToastItem { id: number; title: string; description?: string; variant: Variant }
interface ToastInput { title: string; description?: string; variant?: Variant; duration?: number }

const ToastCtx = createContext<{ toast: (t: ToastInput) => void } | null>(null)

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

const VARIANT: Record<Variant, { icon: typeof Info; color: string; ring: string }> = {
  success: { icon: CheckCircle2, color: 'text-gain', ring: 'border-gain/30' },
  error:   { icon: AlertCircle, color: 'text-loss', ring: 'border-loss/30' },
  info:    { icon: Info, color: 'text-signal', ring: 'border-signal/30' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const reduced = useReducedMotion()

  const remove = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), [])
  const toast = useCallback(({ title, description, variant = 'info', duration = 4000 }: ToastInput) => {
    const id = ++idRef.current
    setItems((s) => [...s, { id, title, description, variant }])
    setTimeout(() => remove(id), duration)
  }, [remove])

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const v = VARIANT[t.variant]
            const Icon = v.icon
            return (
              <motion.div
                key={t.id}
                layout
                initial={reduced ? false : { opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
                className={cn('glass pointer-events-auto flex items-start gap-3 rounded-card border p-3.5 shadow-pop', v.ring)}
                role="status"
              >
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', v.color)} strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
                </div>
                <button
                  onClick={() => remove(t.id)}
                  className="focus-ring -m-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Cerrar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
