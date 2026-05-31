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
      <div className="flex min-h-screen items-center justify-center bg-ink-void p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-sm border border-border bg-ink-surface p-8 text-center"
        >
          <div className="mb-4 font-mono text-3xl text-electric">✓</div>
          <h2 className="mb-2 font-ui text-xl font-semibold tracking-tight">Check your email</h2>
          <p className="font-ui text-sm text-muted-foreground">
            Sent a confirmation link to <strong className="text-foreground">{email}</strong>.
            Click it to activate your account.
          </p>
          <Button
            variant="terminal"
            className="mt-6"
            onClick={() => { setSuccess(false); setMode('login') }}
          >
            Back to Login
          </Button>
        </motion.div>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: 'hsl(var(--ink-void))' }}
    >
      {/* Subtle grid pattern */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'linear-gradient(hsl(var(--electric)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--electric)) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative w-full max-w-sm space-y-8">
        {/* Brand mark with stagger reveal */}
        <motion.div
          initial="hidden"
          animate="visible"
          className="text-center space-y-3"
        >
          <motion.div
            variants={{ hidden: { scale: 0.8, opacity: 0 }, visible: { scale: 1, opacity: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } } }}
            className="inline-flex h-12 w-12 items-center justify-center"
          >
            <Image src="/icons/icon-192.png" alt="Evolve" width={48} height={48} className="object-cover brightness-0 dark:brightness-100" />
          </motion.div>

          <div className="flex items-center justify-center gap-2 overflow-hidden">
            {words.map((word, i) => (
              <motion.span
                key={word}
                custom={i}
                variants={{
                  hidden: { y: 24, opacity: 0 },
                  visible: (idx: number) => ({
                    y: 0,
                    opacity: 1,
                    transition: { delay: 0.15 + idx * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
                  }),
                }}
                className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground"
              >
                {word}
              </motion.span>
            ))}
          </div>

          <motion.div
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { delay: 0.5 } } }}
            className="flex items-center justify-center gap-2"
          >
            <div className="h-px w-8 bg-border" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/50">
              {new Date().getFullYear()}
            </span>
            <div className="h-px w-8 bg-border" />
          </motion.div>
        </motion.div>

        {/* Form card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-sm border border-border bg-ink-surface p-8 space-y-5"
        >
          <div className="space-y-1">
            <h1 className="font-ui text-xl font-semibold tracking-tight">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </h1>
            <p className="font-ui text-xs text-muted-foreground">
              {mode === 'login'
                ? 'Access your investment terminal'
                : 'Join the Evolve platform'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  required
                  className="bg-ink-elevated border-border font-ui"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="bg-ink-elevated border-border font-ui"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
                className="bg-ink-elevated border-border font-mono"
              />
            </div>

            {error && (
              <p className="rounded-sm border border-loss/30 bg-loss/10 px-3 py-2 font-ui text-sm text-loss">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'login' ? 'Access Terminal' : 'Create Account'}
            </Button>
          </form>

          <p className="text-center font-ui text-xs text-muted-foreground">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              className="font-medium text-electric hover:text-electric-bright transition-colors"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
            >
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  )
}
