'use client'

// Login "intelligence field" — an abstract, alive constellation rendered on a
// native Canvas 2D (no dependency). Drifting nodes connected by hairlines (a
// network of intelligence), a soft cursor parallax, and accent links that light
// up near the pointer. NOT a market chart. One requestAnimationFrame, paused when
// the tab is hidden, a single static frame under reduced-motion, lighter on mobile.

import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'

interface Node { x: number; y: number; vx: number; vy: number; r: number }

export function IntelligenceField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const context = el.getContext('2d')
    if (!context) return
    // Capture narrowed (non-null) refs so closures keep the non-null type.
    const cnv = el
    const ctx = context

    const root = getComputedStyle(document.documentElement)
    const mistVar = root.getPropertyValue('--bone').trim() || '210 22% 88%'
    const accentVar = root.getPropertyValue('--electric').trim() || '184 80% 50%'
    const mist = (a: number) => `hsl(${mistVar} / ${a})`
    const accent = (a: number) => `hsl(${accentVar} / ${a})`

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    let nodes: Node[] = []
    let px = 0
    let py = 0
    let raf = 0
    const mouse = { x: -9999, y: -9999, active: false }
    const LINK = 132
    const CURSOR_LINK = 184

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
      const count = Math.min(isMobile ? 28 : 70, Math.round((width * height) / (isMobile ? 16000 : 12500)))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: Math.random() * 1.2 + 0.8,
      }))
    }

    function draw() {
      ctx.clearRect(0, 0, width, height)
      const sx = (n: Node) => n.x + px
      const sy = (n: Node) => n.y + py

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        const ax = sx(a)
        const ay = sy(a)
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const dx = ax - sx(b)
          const dy = ay - sy(b)
          const d = Math.hypot(dx, dy)
          if (d < LINK) {
            ctx.strokeStyle = mist((1 - d / LINK) * 0.15)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            ctx.lineTo(sx(b), sy(b))
            ctx.stroke()
          }
        }
        if (mouse.active) {
          const d = Math.hypot(ax - mouse.x, ay - mouse.y)
          if (d < CURSOR_LINK) {
            ctx.strokeStyle = accent((1 - d / CURSOR_LINK) * 0.42)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(ax, ay)
            ctx.lineTo(mouse.x, mouse.y)
            ctx.stroke()
          }
        }
      }

      for (const a of nodes) {
        const ax = sx(a)
        const ay = sy(a)
        const near = mouse.active && Math.hypot(ax - mouse.x, ay - mouse.y) < 120
        ctx.fillStyle = near ? accent(0.95) : mist(0.5)
        ctx.beginPath()
        ctx.arc(ax, ay, a.r + (near ? 0.9 : 0), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function step() {
      const targetX = mouse.active ? (mouse.x / width - 0.5) * 18 : 0
      const targetY = mouse.active ? (mouse.y / height - 0.5) * 18 : 0
      px += (targetX - px) * 0.05
      py += (targetY - py) * 0.05
      for (const a of nodes) {
        a.x += a.vx
        a.y += a.vy
        if (a.x < 0 || a.x > width) a.vx *= -1
        if (a.y < 0 || a.y > height) a.vy *= -1
      }
      draw()
      raf = requestAnimationFrame(step)
    }

    resize()
    if (reduced) {
      draw()
    } else {
      raf = requestAnimationFrame(step)
    }

    const onMove = (e: PointerEvent) => {
      const rect = cnv.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
      mouse.active = true
    }
    const onLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999 }
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
