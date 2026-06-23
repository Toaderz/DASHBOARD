'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'login' | 'register'

const words = ['Evolve', 'Investment', 'Terminal']

// Decorative bone grid (login is an always-dark surface, independent of theme).
const GRID_BG = {
  backgroundImage:
    'linear-gradient(hsl(var(--bone)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--bone)) 1px, transparent 1px)',
  backgroundSize: '56px 56px',
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

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

  if (success) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: 'hsl(var(--ink-void))' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-card border border-border bg-ink-surface p-8 text-center shadow-card"
        >
          <div className="mb-4 font-mono text-3xl text-gain">✓</div>
          <h2 className="mb-2 font-editorial text-xl font-bold tracking-tight text-foreground">Revisa tu correo</h2>
          <p className="text-sm text-muted-foreground">
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
        </motion.div>
      </div>
    )
  }

  const titleCopy = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'
  const subCopy = mode === 'login' ? 'Accede a tu terminal de inversión' : 'Únete a la plataforma Evolve'

  return (
    <div className="grid min-h-dvh lg:grid-cols-2" style={{ background: 'hsl(var(--ink-void))' }}>
      {/* ── Left — editorial brand panel (desktop only) ──────────────────── */}
      <aside className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={GRID_BG} aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-bone/[0.06] blur-3xl" aria-hidden />

        {/* Brand mark */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex items-center gap-3"
        >
          <Image src="/icons/icon-192.png" alt="Evolve" width={36} height={36} className="object-cover" />
          <span className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">Evolve</span>
        </motion.div>

        {/* Editorial statement */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative max-w-md"
        >
          <p className="eyebrow">Investment Terminal</p>
          <h2 className="mt-4 font-editorial text-4xl font-bold leading-[1.05] tracking-tight text-foreground xl:text-5xl">
            Tu portafolio,
            <br />
            en foco.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Precios en vivo, comparativa contra peers y un brief de mercado semanal — en una sola terminal.
          </p>
        </motion.div>

        {/* Meta footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="relative flex items-center gap-3 text-muted-foreground/60"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">{new Date().getFullYear()}</span>
          <span className="h-px w-8 bg-border" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">Multiusuario · Tiempo real</span>
        </motion.div>
      </aside>

      {/* ── Right — auth form ────────────────────────────────────────────── */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile brand mark */}
          <div className="flex flex-col items-center gap-3 lg:hidden">
            <Image src="/icons/icon-192.png" alt="Evolve" width={48} height={48} className="object-cover" />
            <div className="flex items-center gap-2">
              {words.map((word) => (
                <span key={word} className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
                  {word}
                </span>
              ))}
            </div>
          </div>

          {/* Form card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-5 rounded-card border border-border bg-ink-surface p-8 shadow-card"
          >
            <div className="space-y-1">
              <h1 className="font-editorial text-2xl font-bold tracking-tight text-foreground">{titleCopy}</h1>
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
          </motion.div>
        </div>
      </main>
    </div>
  )
}
