'use client'

// Login background — a "living market depth" field. A row of bars diverges up/down
// from a central returns baseline: gains rise (green), losses fall (red), all at low
// saturation so it reads as quiet market data, never an audio equalizer. The field
// breathes slowly (the market is alive); where the cursor passes, bars grow taller and
// illuminate to signal-teal — capital concentrating where attention goes. This is the
// brand promise made literal: raw market → signal.
//
// Native Canvas 2D (no dependency). One requestAnimationFrame, paused when the tab is
// hidden, a single static frame under reduced motion, lighter on mobile. Mirrors the
// proven lifecycle of the former IntelligenceField.

import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'

interface Bar {
  sign: number // +1 gain, -1 loss
  mag: number // resting magnitude (0..1)
  phase: number // breathing phase
  speed: number // breathing speed
  w: number // current cursor weight (eased 0..1)
}

export function MarketDepthField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const context = el.getContext('2d')
    if (!context) return
    const cnv = el
    const ctx = context

    const root = getComputedStyle(document.documentElement)
    const gainVar = root.getPropertyValue('--gain').trim() || '152 56% 50%'
    const lossVar = root.getPropertyValue('--loss').trim() || '5 76% 64%'
    const accentVar = root.getPropertyValue('--electric').trim() || '184 80% 50%'
    const mistVar = root.getPropertyValue('--bone').trim() || '210 22% 88%'
    const gain = (a: number) => `hsl(${gainVar} / ${a})`
    const loss = (a: number) => `hsl(${lossVar} / ${a})`
    const accent = (a: number) => `hsl(${accentVar} / ${a})`
    const mist = (a: number) => `hsl(${mistVar} / ${a})`

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    let baseY = 0
    let maxBar = 0
    let spacing = 0
    let radius = 0
    let bars: Bar[] = []
    let raf = 0
    const mouse = { x: -9999, active: false }

    function resize() {
      const rect = cnv.parentElement?.getBoundingClientRect()
      width = rect?.width ?? window.innerWidth
      height = rect?.height ?? window.innerHeight
      cnv.width = Math.round(width * dpr)
      cnv.height = Math.round(height * dpr)
      cnv.style.width = `${width}px`
      cnv.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const isMobile = width < 640
      spacing = isMobile ? 26 : 22
      radius = isMobile ? 150 : 240
      baseY = height * 0.5
      maxBar = Math.min(height * 0.32, 240)
      const count = Math.max(8, Math.floor(width / spacing) + 1)
      bars = Array.from({ length: count }, () => ({
        sign: Math.random() > 0.46 ? 1 : -1,
        mag: 0.16 + Math.random() * 0.42,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.5,
        w: 0,
      }))
    }

    function draw(t: number) {
      ctx.clearRect(0, 0, width, height)

      // Returns baseline — the zero line bars diverge from.
      ctx.strokeStyle = mist(0.07)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, baseY)
      ctx.lineTo(width, baseY)
      ctx.stroke()

      const barW = Math.max(2, spacing * 0.34)
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i]
        const x = i * spacing + spacing / 2

        // Cursor lens: bars near the pointer ease toward full weight.
        const target = mouse.active ? Math.max(0, 1 - Math.abs(x - mouse.x) / radius) : 0
        b.w += (target - b.w) * 0.12

        const breathe = reduced ? 1 : 0.82 + 0.18 * Math.sin(t * b.speed + b.phase)
        const baseH = maxBar * b.mag * breathe
        const activeH = baseH + maxBar * b.w * 0.95
        const top = b.sign > 0 ? baseY - activeH : baseY
        const restColor = b.sign > 0 ? gain : loss

        // Resting market bar (muted gain/loss) — fades out as the signal takes over.
        const restH = b.sign > 0 ? baseH : baseH
        ctx.fillStyle = restColor(0.1 * (1 - b.w) + 0.04)
        if (b.sign > 0) ctx.fillRect(x - barW / 2, baseY - restH, barW, restH)
        else ctx.fillRect(x - barW / 2, baseY, barW, restH)

        // Signal overlay — grows taller and illuminates to teal under the lens.
        if (b.w > 0.01) {
          ctx.fillStyle = accent(b.w * 0.5)
          ctx.fillRect(x - barW / 2, top, barW, activeH)
          // Bright tip — the signal apex.
          ctx.fillStyle = accent(b.w * 0.85)
          const tipY = b.sign > 0 ? top : baseY + activeH - 2
          ctx.fillRect(x - barW / 2, tipY, barW, 2)
        }
      }

      // Concentrated glow under the pointer.
      if (mouse.active) {
        const g = ctx.createRadialGradient(mouse.x, baseY, 0, mouse.x, baseY, radius)
        g.addColorStop(0, accent(0.1))
        g.addColorStop(1, accent(0))
        ctx.fillStyle = g
        ctx.fillRect(0, 0, width, height)
      }
    }

    function step() {
      draw(performance.now() / 1000)
      raf = requestAnimationFrame(step)
    }

    resize()
    if (reduced) {
      draw(0)
    } else {
      raf = requestAnimationFrame(step)
    }

    const onMove = (e: PointerEvent) => {
      const rect = cnv.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.active = true
    }
    const onLeave = () => { mouse.active = false; mouse.x = -9999 }
    const onResize = () => resize()
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
      else if (!reduced && !raf) raf = requestAnimationFrame(step)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [reduced])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
