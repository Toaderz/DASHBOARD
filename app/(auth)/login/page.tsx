'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { BENCHMARK_TICKERS, BENCHMARK_LABELS } from '@/lib/market/benchmarks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

// Decorative ticker strip — product benchmark labels (no network, purely visual).
const STRIP = [...BENCHMARK_TICKERS].map((t) => BENCHMARK_LABELS[t] ?? t)

// Faint bone grid (login is an always-dark surface, independent of theme).
const GRID_BG = {
  backgroundImage:
    'linear-gradient(hsl(var(--bone)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--bone)) 1px, transparent 1px)',
  backgroundSize: '64px 64px',
}

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

  // ── Shared atmospheric backdrop ──────────────────────────────────────────
  const Backdrop = (
    <>
      <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={GRID_BG} aria-hidden />
      <div className="pointer-events-none absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-bone/[0.05] blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[28rem] w-[28rem] rounded-full bg-bone/[0.04] blur-3xl" aria-hidden />
      {!reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ background: 'linear-gradient(115deg, transparent 35%, hsl(var(--bone)) 50%, transparent 65%)', backgroundSize: '250% 100%' }}
          animate={{ backgroundPosition: ['160% 0%', '-60% 0%'] }}
          transition={{ duration: 12, ease: 'linear', repeat: Infinity }}
        />
      )}
    </>
  )

  if (success) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4" style={{ background: 'hsl(var(--ink-void))' }}>
        {Backdrop}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative w-full max-w-md overflow-hidden rounded-card border border-border bg-ink-surface text-center shadow-pop"
        >
          <div className="border-b border-border bg-ink-elevated/40 px-6 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-bone/30" />
              <span className="h-2.5 w-2.5 rounded-full bg-bone/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-bone/15" />
              <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">evolve · auth</span>
            </div>
          </div>
          <div className="p-8">
            <div className="mb-4 font-mono text-3xl text-gain">✓</div>
            <h2 className="mb-2 font-editorial text-xl font-bold tracking-tight text-foreground">Revisa tu correo</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Enviamos un enlace de confirmación a <strong className="text-foreground">{email}</strong>.
              Haz clic en él para activar tu cuenta.
            </p>
            <Button
              variant="terminal"
              className="mt-6"
              onClick={() => { setSuccess(false); setMode('login') }}
            >
              Volver a iniciar sesión
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  const titleCopy = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'
  const subCopy = mode === 'login' ? 'Accede a tu terminal de inversión.' : 'Crea tu cuenta en la plataforma Evolve.'

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden p-4 sm:p-6" style={{ background: 'hsl(var(--ink-void))' }}>
      {Backdrop}

      <motion.div
        initial={reduced ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        {/* Brand mark above the panel */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Image src="/icons/icon-192.png" alt="Evolve" width={52} height={52} className="rounded-card object-cover shadow-card" />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-muted-foreground">Investment Terminal</p>
            <h1 className="mt-1 font-editorial text-2xl font-bold tracking-tight text-foreground">Evolve</h1>
          </div>
        </div>

        {/* Terminal panel */}
        <div className="overflow-hidden rounded-card border border-border bg-ink-surface shadow-pop">
          {/* Window chrome strip */}
          <div className="flex items-center justify-between border-b border-border bg-ink-elevated/40 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-bone/30" />
              <span className="h-2.5 w-2.5 rounded-full bg-bone/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-bone/15" />
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {mode === 'login' ? 'sign-in' : 'sign-up'}
            </span>
          </div>

          {/* Body */}
          <div className="space-y-5 p-7 sm:p-8">
            <div className="space-y-1">
              <h2 className="font-editorial text-2xl font-bold tracking-tight text-foreground">{titleCopy}</h2>
              <p className="text-sm text-muted-foreground">{subCopy}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fullName" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Nombre completo
                  </Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Pérez"
                    required
                    className="border-border bg-ink-elevated font-ui"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Correo
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tú@empresa.com"
                  required
                  className="border-border bg-ink-elevated font-ui"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Contraseña
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  className="border-border bg-ink-elevated font-mono"
                />
              </div>

              {error && (
                <p className="rounded-md border border-loss/30 bg-loss/10 px-3 py-2 text-sm text-loss">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'login' ? 'Acceder' : 'Crear cuenta'}
              </Button>
            </form>

            <p className="text-center text-xs text-muted-foreground">
              {mode === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
              <button
                type="button"
                className="focus-ring rounded font-medium text-foreground underline-offset-2 transition-colors hover:underline"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
              >
                {mode === 'login' ? 'Crear una' : 'Inicia sesión'}
              </button>
            </p>
          </div>
        </div>
      </motion.div>

      {/* Decorative benchmark strip */}
      <motion.div
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="relative mt-8 flex max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-4"
        aria-hidden
      >
        {STRIP.map((label, i) => (
          <span key={label} className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
            {label}
            {i < STRIP.length - 1 && <span className="h-1 w-1 rounded-full bg-bone/20" />}
          </span>
        ))}
      </motion.div>
    </div>
  )
}
