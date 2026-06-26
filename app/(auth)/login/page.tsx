'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { fadeBlur, staggerContainer, EASE_OUT } from '@/lib/motion-tokens'
import { EvolveLogo3D } from '@/components/brand/EvolveLogo3D'
import { MarketDepthField } from '@/components/auth/MarketDepthField'
import { NarrativeScene } from '@/components/auth/scenes/NarrativeScene'
import { LivePricesScene } from '@/components/auth/scenes/LivePricesScene'
import { PeersScene } from '@/components/auth/scenes/PeersScene'
import { CompareScene } from '@/components/auth/scenes/CompareScene'
import { IntelligenceScene } from '@/components/auth/scenes/IntelligenceScene'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const reduced = useReducedMotion()

  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        router.push('/')
        router.refresh()
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) {
        setError(error.message)
      } else {
        setSuccess(true)
      }
    }

    setLoading(false)
  }

  // ── Atmospheric backdrop: living market depth + faint grid + ambient glows.
  // Fixed to the viewport so it stays steady while the narrative scrolls over it. ──
  const Backdrop = (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <MarketDepthField className="absolute inset-0" />
      <div className="ambient-grid absolute inset-0" />
      <div className="absolute -left-32 top-1/4 h-[34rem] w-[34rem] rounded-full bg-signal/[0.06] blur-[120px]" />
      <div className="absolute -right-40 bottom-0 h-[30rem] w-[30rem] rounded-full bg-mist/[0.04] blur-[120px]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mist/15 to-transparent" />
    </div>
  )

  if (success) {
    return (
      <div className="theme-dark relative flex min-h-dvh items-center justify-center overflow-hidden p-4 text-foreground" style={{ background: 'hsl(var(--ink-void))' }}>
        {Backdrop}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="glass relative z-10 w-full max-w-md overflow-hidden rounded-card p-8 text-center shadow-pop"
        >
          <div className="mb-5 flex justify-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-card bg-gain/12 text-gain shadow-glow">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
          </div>
          <h2 className="font-editorial text-xl font-bold tracking-tight text-foreground">Revisa tu correo</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Enviamos un enlace de confirmación a <strong className="text-foreground">{email}</strong>. Haz clic en él para activar tu cuenta.
          </p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => { setSuccess(false); setMode('login') }}>
            Volver a iniciar sesión
          </Button>
        </motion.div>
      </div>
    )
  }

  const titleCopy = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'
  const subCopy = mode === 'login' ? 'Accede a tu inteligencia de mercado.' : 'Crea tu cuenta en la plataforma Evolve.'

  return (
    <div className="theme-dark relative min-h-dvh overflow-x-clip text-foreground" style={{ background: 'hsl(var(--ink-void))' }}>
      {Backdrop}

      <div className="relative z-10 mx-auto max-w-6xl px-6 lg:grid lg:grid-cols-[1.1fr_minmax(0,400px)] lg:gap-16 lg:px-10">
        {/* ── Hero: the brand made physical (col 1, row 1) ── */}
        <motion.header
          variants={reduced ? undefined : staggerContainer}
          initial={reduced ? false : 'hidden'}
          animate="show"
          className="flex flex-col justify-center py-16 text-center lg:col-start-1 lg:row-start-1 lg:min-h-dvh lg:py-0 lg:text-left"
        >
          <motion.div variants={reduced ? undefined : fadeBlur}>
            <EvolveLogo3D size={240} className="mx-auto lg:mx-0" />
          </motion.div>
          <motion.h1 variants={reduced ? undefined : fadeBlur} className="mt-9 font-editorial text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
            Evolve
          </motion.h1>
          <motion.p variants={reduced ? undefined : fadeBlur} className="mt-3 text-xs font-semibold uppercase tracking-[0.34em] text-signal sm:text-sm">
            Transforming Investments
          </motion.p>
          <motion.p variants={reduced ? undefined : fadeBlur} className="mx-auto mt-6 max-w-md text-[15px] leading-7 text-muted-foreground lg:mx-0">
            La inteligencia de tus inversiones, viva — en tiempo real, comparada con sus pares y explicada con claridad.
          </motion.p>
          <motion.p variants={reduced ? undefined : fadeBlur} className="mt-10 hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span className="inline-block h-4 w-px bg-mist/30" />
            Desplázate para conocer la plataforma
          </motion.p>
        </motion.header>

        {/* ── Auth card: sticky, always accessible (col 2, spans both rows) ── */}
        <div className="pb-16 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:h-dvh lg:items-center lg:self-start lg:sticky lg:top-0">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 18, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
              e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
            }}
            className="glass spotlight-accent relative w-full rounded-card p-7 shadow-pop sm:p-8"
          >
            <div className="mb-6 space-y-1">
              <h2 className="font-editorial text-2xl font-bold tracking-tight text-foreground">{titleCopy}</h2>
              <p className="text-sm text-muted-foreground">{subCopy}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fullName" className="text-xs font-medium text-muted-foreground">Nombre completo</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Pérez"
                    required
                    autoComplete="name"
                    className="border-input bg-ink-elevated/60 font-ui"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tú@empresa.com"
                  required
                  className="border-input bg-ink-elevated/60 font-ui"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  className="border-input bg-ink-elevated/60 font-mono"
                />
              </div>

              {error && (
                <p className="rounded-md border border-loss/30 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'login' ? 'Acceder' : 'Crear cuenta'}
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              {mode === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
              <button
                type="button"
                className="focus-ring rounded font-medium text-foreground underline-offset-2 transition-colors hover:text-signal hover:underline"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
              >
                {mode === 'login' ? 'Crear una' : 'Inicia sesión'}
              </button>
            </p>
          </motion.div>
        </div>

        {/* ── Scrolling narrative: the product, told in its own visual language (col 1, row 2) ── */}
        <div className="lg:col-start-1 lg:row-start-2">
          <NarrativeScene
            eyebrow="En vivo"
            title="Sigue cada activo, en tiempo real."
            desc="Cotizaciones que se actualizan cada 5 segundos — cada movimiento, en el momento en que ocurre."
            accent="gain"
          >
            <LivePricesScene />
          </NarrativeScene>

          <NarrativeScene
            eyebrow="Vs. pares"
            title="Sabes a quién le estás ganando."
            desc="Mide cada posición contra su competencia real, periodo por periodo. No contra un índice genérico."
            accent="signal"
          >
            <PeersScene />
          </NarrativeScene>

          <NarrativeScene
            eyebrow="Comparar"
            title="Lado a lado, sin ruido."
            desc="Crecimiento de $10,000 de cada activo en una sola vista, para decidir con la evidencia enfrente."
            accent="signal"
          >
            <CompareScene />
          </NarrativeScene>

          <NarrativeScene
            eyebrow="Inteligencia de mercado"
            title="Señal, no ruido."
            desc="Lo que de verdad mueve a tu portafolio esta semana, separado del flujo interminable de titulares."
            accent="signal"
          >
            <IntelligenceScene />
          </NarrativeScene>

          <div className="py-20 text-center lg:text-left">
            <p className="font-editorial text-3xl font-bold tracking-tight text-foreground">Transforming Investments.</p>
            <p className="mt-3 text-[15px] text-muted-foreground">Crea tu cuenta y empieza a transformar la tuya.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
