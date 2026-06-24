'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Activity, Sparkles, Swords } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { fadeBlur, staggerContainer, EASE_OUT } from '@/lib/motion-tokens'
import { EvolveMark } from '@/components/brand/EvolveMark'
import { IntelligenceField } from '@/components/auth/IntelligenceField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

// Plain-language value props (Cash App clarity) — what Evolve does, at a glance.
const VALUE_PROPS = [
  { icon: Activity, title: 'Precios en vivo', desc: 'Cotizaciones que se actualizan cada 5 segundos.' },
  { icon: Sparkles, title: 'Inteligencia de mercado', desc: 'Un brief con IA: lo que mueve a tu portafolio.' },
  { icon: Swords, title: 'Compárate con tus pares', desc: 'Mide cada activo contra su competencia real.' },
]

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

  // ── Atmospheric backdrop: live constellation + faint grid + ambient glows ──
  const Backdrop = (
    <>
      <IntelligenceField className="pointer-events-none absolute inset-0" />
      <div className="ambient-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute -left-32 top-1/4 h-[34rem] w-[34rem] rounded-full bg-signal/[0.06] blur-[120px]" aria-hidden />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[30rem] w-[30rem] rounded-full bg-mist/[0.04] blur-[120px]" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mist/15 to-transparent" aria-hidden />
    </>
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
    <div className="theme-dark relative min-h-dvh overflow-hidden text-foreground" style={{ background: 'hsl(var(--ink-void))' }}>
      {Backdrop}

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col justify-center gap-12 px-6 py-10 lg:grid lg:grid-cols-[1.1fr_minmax(0,420px)] lg:items-center lg:gap-20 lg:px-10">
        {/* ── Left: brand + value statement ── */}
        <motion.div
          variants={reduced ? undefined : staggerContainer}
          initial={reduced ? false : 'hidden'}
          animate="show"
          className="max-w-xl"
        >
          <motion.div variants={reduced ? undefined : fadeBlur} className="flex items-center gap-3">
            <EvolveMark size={40} interactive className="text-mist" />
            <span className="font-editorial text-xl font-bold tracking-tight">Evolve</span>
          </motion.div>

          <motion.h1
            variants={reduced ? undefined : fadeBlur}
            className="mt-8 font-editorial text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl"
          >
            La inteligencia de tus<br className="hidden sm:block" /> inversiones, <span className="text-signal">viva</span>.
          </motion.h1>

          <motion.p variants={reduced ? undefined : fadeBlur} className="mt-5 max-w-md text-[15px] leading-7 text-muted-foreground">
            Sigue tus activos en tiempo real, entiende qué los mueve y compáralos con sus pares — en un solo lugar, claro y elegante.
          </motion.p>

          <motion.ul variants={reduced ? undefined : staggerContainer} className="mt-10 space-y-4">
            {VALUE_PROPS.map(({ icon: Icon, title, desc }) => (
              <motion.li key={title} variants={reduced ? undefined : fadeBlur} className="flex items-start gap-3.5">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-mist/15 bg-mist/[0.04] text-signal">
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        {/* ── Right: glass auth card ── */}
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
    </div>
  )
}
