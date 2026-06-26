'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { fadeBlur, staggerContainer, EASE_OUT } from '@/lib/motion-tokens'
import { EvolveLogo3D } from '@/components/brand/EvolveLogo3D'
import { EvolveGlyph } from '@/components/brand/EvolveGlyph'
import { MarketDepthField } from '@/components/auth/MarketDepthField'
import { NarrativeScene } from '@/components/auth/scenes/NarrativeScene'
import { LivePricesScene } from '@/components/auth/scenes/LivePricesScene'
import { TopAssetsScene } from '@/components/auth/scenes/TopAssetsScene'
import { PeersScene } from '@/components/auth/scenes/PeersScene'
import { CompareScene } from '@/components/auth/scenes/CompareScene'
import { IntelligenceScene } from '@/components/auth/scenes/IntelligenceScene'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [authOpen, setAuthOpen] = useState(false)
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

  // Minimal top-bar entry (Lovable-style): a button opens the auth form in a dialog —
  // the same modal pattern used across the dashboard. Auth itself is untouched.
  const openAuth = (m: Mode) => { setMode(m); setError(null); setSuccess(false); setAuthOpen(true) }
  const onDialogChange = (open: boolean) => { setAuthOpen(open); if (!open) setError(null) }

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

  // ── Atmospheric backdrop: living market depth + ambient glows + soft depth vignette.
  // Fixed to the viewport so it stays steady while the narrative scrolls over it. No grid —
  // the market-depth field is the motif; a radial vignette adds depth without a hard lattice. ──
  const Backdrop = (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <MarketDepthField className="absolute inset-0" />
      <div className="absolute -left-32 top-1/4 h-[34rem] w-[34rem] rounded-full bg-signal/[0.07] blur-[120px]" />
      <div className="absolute -right-40 bottom-0 h-[30rem] w-[30rem] rounded-full bg-mist/[0.04] blur-[120px]" />
      {/* Depth vignette — focuses the eye to center, softens the field's edges. */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 50% 38%, transparent 36%, hsl(var(--ink-void) / 0.72) 100%)' }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mist/15 to-transparent" />
    </div>
  )

  const titleCopy = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'
  const subCopy = mode === 'login' ? 'Accede a tu inteligencia de mercado.' : 'Crea tu cuenta en la plataforma Evolve.'

  return (
    <div className="theme-dark relative min-h-dvh overflow-x-clip text-foreground" style={{ background: 'hsl(var(--ink-void))' }}>
      {Backdrop}

      {/* ── Minimal top bar (Lovable-style): brand left, auth entry right, always reachable ── */}
      <header className="sticky top-0 z-20 border-b border-mist/[0.07] bg-ink-void/55 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 lg:px-10">
          <div className="flex items-center gap-2.5">
            <EvolveGlyph size={24} className="text-foreground" />
            <span className="font-editorial text-base font-bold tracking-tight">Evolve</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => openAuth('login')}>Iniciar sesión</Button>
            <Button size="sm" onClick={() => openAuth('register')}>Crear cuenta</Button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-3xl px-6 lg:px-10">
        {/* ── Hero: the brand made physical ── */}
        <motion.header
          variants={reduced ? undefined : staggerContainer}
          initial={reduced ? false : 'hidden'}
          animate="show"
          className="flex flex-col items-center justify-center py-16 text-center lg:min-h-[calc(100dvh-3.75rem)] lg:py-0"
        >
          <motion.div variants={reduced ? undefined : fadeBlur}>
            <EvolveLogo3D size={240} />
          </motion.div>
          <motion.h1 variants={reduced ? undefined : fadeBlur} className="mt-9 font-editorial text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
            Evolve
          </motion.h1>
          <motion.p variants={reduced ? undefined : fadeBlur} className="mt-3 text-xs font-semibold uppercase tracking-[0.34em] text-foreground sm:text-sm">
            Transforming Investments
          </motion.p>
          <motion.p variants={reduced ? undefined : fadeBlur} className="mx-auto mt-6 max-w-md text-[15px] leading-7 text-muted-foreground">
            La inteligencia de tus inversiones, viva — en tiempo real, comparada con sus pares y explicada con claridad.
          </motion.p>
          <motion.div variants={reduced ? undefined : fadeBlur} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={() => openAuth('register')}>Crear cuenta</Button>
            <Button size="lg" variant="outline" onClick={() => openAuth('login')}>Iniciar sesión</Button>
          </motion.div>
          <motion.p variants={reduced ? undefined : fadeBlur} className="mt-10 hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span className="inline-block h-4 w-px bg-mist/30" />
            Desplázate para conocer la plataforma
          </motion.p>
        </motion.header>

        {/* ── Scrolling narrative: the product, told in its own visual language ── */}
        <div>
          <NarrativeScene
            eyebrow="En vivo"
            title="Sigue cada activo, en tiempo real."
            desc="Cotizaciones que se actualizan cada 5 segundos — cada movimiento, en el momento en que ocurre."
            accent="gain"
          >
            <LivePricesScene />
          </NarrativeScene>

          <NarrativeScene
            eyebrow="Mejores activos"
            title="Sabes qué está rindiendo más."
            desc="Tus mejores posiciones, ordenadas por retorno y normalizadas a USD — de un vistazo, sin armar hojas de cálculo."
            accent="gain"
          >
            <TopAssetsScene />
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

          <div className="py-20 text-center">
            <p className="font-editorial text-3xl font-bold tracking-tight text-foreground">Transforming Investments.</p>
            <p className="mt-3 text-[15px] text-muted-foreground">Crea tu cuenta y empieza a transformar la tuya.</p>
            <Button size="lg" className="mt-7" onClick={() => openAuth('register')}>Crear cuenta</Button>
          </div>
        </div>
      </div>

      {/* ── Auth dialog: opens from the top-bar / CTA, the dashboard's modal pattern. ──
           Portals to <body> (outside the .theme-dark wrapper) → re-scope dark here. */}
      <Dialog open={authOpen} onOpenChange={onDialogChange}>
        <DialogContent
          aria-describedby={undefined}
          className="theme-dark w-full max-w-md gap-0 overflow-hidden rounded-card border border-mist/15 bg-ink-surface/90 p-7 text-foreground shadow-pop backdrop-blur-xl sm:rounded-card sm:p-8"
        >
          {success ? (
            <div className="text-center">
              <div className="mb-5 flex justify-center">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-card bg-gain/12 text-gain shadow-glow">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
              </div>
              <DialogTitle className="font-editorial text-xl font-bold tracking-tight text-foreground">Revisa tu correo</DialogTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Enviamos un enlace de confirmación a <strong className="text-foreground">{email}</strong>. Haz clic en él para activar tu cuenta.
              </p>
              <Button variant="outline" className="mt-6 w-full" onClick={() => { setSuccess(false); setMode('login') }}>
                Volver a iniciar sesión
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-6 space-y-1">
                <DialogTitle className="font-editorial text-2xl font-bold tracking-tight text-foreground">{titleCopy}</DialogTitle>
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
