'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTour } from '@/components/onboarding/TourProvider'

const PAD = 8 // padding del cut-out alrededor del ancla
const TOOLTIP_W = 320

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

// En móvil los pasos de navegación apuntan al botón hamburguesa.
function resolveSelector(anchor: string, fallback: string | undefined, isMobile: boolean): string[] {
  const navAnchors = ['nav-overview', 'nav-watchlists', 'nav-peers', 'nav-news', 'watchlists', 'add-ticker']
  const wantsNav = navAnchors.some((a) => anchor.includes(a))
  if (isMobile && wantsNav) return ['[data-tour="mobile-menu"]', anchor, ...(fallback ? [fallback] : [])]
  return [anchor, ...(fallback ? [fallback] : [])]
}

export function TourSpotlight() {
  const { running, stepIndex, steps, next, prev, skip } = useTour()
  const [rect, setRect] = useState<Rect | null>(null)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const step = running ? steps[stepIndex] : undefined

  const measure = useCallback(() => {
    if (!step) {
      setRect(null)
      return
    }
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
    const selectors = resolveSelector(step.anchor, step.fallback, isMobile)
    let el: Element | null = null
    for (const sel of selectors) {
      el = document.querySelector(sel)
      if (el) break
    }
    if (!el) {
      // Ancla no encontrada → saltar el paso.
      setRect(null)
      next()
      return
    }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step, next])

  useLayoutEffect(() => {
    if (!running) return
    measure()
  }, [running, stepIndex, measure])

  // Recalcular en resize / scroll mientras el recorrido está activo.
  useEffect(() => {
    if (!running) return
    const onChange = () => measure()
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [running, measure])

  // Escape para salir.
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, skip])

  if (!running || !step || !rect) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const cut = {
    top: Math.max(0, rect.top - PAD),
    left: Math.max(0, rect.left - PAD),
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  }

  // Posición del tooltip: debajo del ancla si cabe, si no encima.
  const below = cut.top + cut.height + 12
  const placeBelow = below + 180 < vh
  const tooltipTop = placeBelow ? below : Math.max(12, cut.top - 12 - 180)
  let tooltipLeft = cut.left + cut.width / 2 - TOOLTIP_W / 2
  tooltipLeft = Math.min(Math.max(12, tooltipLeft), vw - TOOLTIP_W - 12)

  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1
  const anim = reduced ? '' : 'animate-fade-in-up'

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Recorrido guiado">
      {/* Dimmer con cut-out: 4 paneles alrededor del ancla (mismo lenguaje que el overlay móvil) */}
      <div className="absolute inset-x-0 top-0 bg-black/70 backdrop-blur-sm" style={{ height: cut.top }} onClick={skip} />
      <div
        className="absolute left-0 bg-black/70 backdrop-blur-sm"
        style={{ top: cut.top, height: cut.height, width: cut.left }}
        onClick={skip}
      />
      <div
        className="absolute bg-black/70 backdrop-blur-sm"
        style={{ top: cut.top, height: cut.height, left: cut.left + cut.width, right: 0 }}
        onClick={skip}
      />
      <div
        className="absolute inset-x-0 bg-black/70 backdrop-blur-sm"
        style={{ top: cut.top + cut.height, bottom: 0 }}
        onClick={skip}
      />

      {/* Highlight del ancla */}
      <div
        className="pointer-events-none absolute rounded-card ring-2 ring-electric shadow-glow"
        style={{ top: cut.top, left: cut.left, width: cut.width, height: cut.height }}
      />

      {/* Tooltip */}
      <Card
        className={`absolute shadow-pop ${anim}`}
        style={{ top: tooltipTop, left: tooltipLeft, width: TOOLTIP_W }}
      >
        <CardHeader className="pb-2">
          <CardTitle className="font-editorial text-base">{step.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {stepIndex + 1} / {steps.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost-dim" size="sm" onClick={skip}>
                Saltar
              </Button>
              {!isFirst && (
                <Button variant="outline" size="sm" onClick={prev}>
                  Atrás
                </Button>
              )}
              <Button size="sm" onClick={next}>
                {isLast ? 'Listo' : 'Siguiente'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
