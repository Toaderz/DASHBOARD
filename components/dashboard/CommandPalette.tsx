'use client'

// ⌘K command palette — a signature "intelligent" entry point. Navigates between
// pages and looks up any ticker (reusing /api/market/search → routes to the
// comparison view). Controlled by the shell; also binds the global ⌘K/Ctrl+K.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Search, CornerDownLeft, LayoutDashboard, TrendingUp, TrendingDown, Swords, GitCompare, Newspaper, Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { EASE_OUT } from '@/lib/motion-tokens'
import { typeBadgeClass, typeLabel } from '@/lib/asset-style'
import type { SearchResult } from '@/types'

const NAV: { label: string; href: string; icon: LucideIcon; hint?: string }[] = [
  { label: 'Overview', href: '/', icon: LayoutDashboard, hint: 'Resumen agregado' },
  { label: 'Top Performers', href: '/top10', icon: TrendingUp },
  { label: 'Worst Performers', href: '/bottom10', icon: TrendingDown },
  { label: 'Beating Peers', href: '/vs-peers', icon: Swords },
  { label: 'Comparar activos', href: '/etf-compare', icon: GitCompare },
  { label: 'Market Brief', href: '/news', icon: Newspaper },
]

interface Props { open: boolean; onOpenChange: (open: boolean) => void }

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter()
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Global ⌘K / Ctrl+K toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  // Reset + focus on open/close
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setActive(0)
      const t = setTimeout(() => inputRef.current?.focus(), 40)
      return () => clearTimeout(t)
    }
  }, [open])

  const navMatches = query
    ? NAV.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
    : NAV
  const items = [
    ...navMatches.map((n) => ({ kind: 'nav' as const, ...n })),
    ...results.map((r) => ({ kind: 'ticker' as const, ...r })),
  ]

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults((data.results ?? []).slice(0, 6))
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    setActive(0)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => runSearch(val), 300)
  }

  const select = useCallback((item: (typeof items)[number]) => {
    onOpenChange(false)
    if (item.kind === 'nav') router.push(item.href)
    else router.push(`/etf-compare?tickers=${encodeURIComponent(item.ticker)}`)
  }, [onOpenChange, router, items])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onOpenChange(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) select(items[active]) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Buscador de comandos"
            initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            onKeyDown={onKeyDown}
            className="glass relative w-full max-w-xl overflow-hidden rounded-card shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Buscar páginas o tickers…"
                className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">ESC</kbd>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin resultados.</p>
              ) : (
                <>
                  {navMatches.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Navegar</p>
                      {navMatches.map((item, i) => {
                        const Icon = item.icon
                        const isActive = i === active
                        return (
                          <button
                            key={`nav-${item.href}`}
                            onClick={() => select({ kind: 'nav', ...item })}
                            onMouseEnter={() => setActive(i)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                              isActive ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                            <span className="flex-1 truncate text-foreground">{item.label}</span>
                            {item.hint && <span className="hidden truncate text-xs text-muted-foreground sm:block">{item.hint}</span>}
                            {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          </button>
                        )
                      })}
                    </>
                  )}

                  {results.length > 0 && (
                    <>
                      <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Activos</p>
                      {results.map((item, j) => {
                        const idx = navMatches.length + j
                        const isActive = idx === active
                        return (
                          <button
                            key={`tk-${item.ticker}`}
                            onClick={() => select({ kind: 'ticker', ...item })}
                            onMouseEnter={() => setActive(idx)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                              isActive ? 'bg-foreground/[0.06]' : 'hover:bg-foreground/[0.04]'
                            )}
                          >
                            <span className="font-mono text-sm font-semibold text-foreground">{item.ticker}</span>
                            <span className="flex-1 truncate text-xs text-muted-foreground">{item.name}</span>
                            <span className={cn('shrink-0 rounded-pill px-1.5 py-0.5 text-[10px]', typeBadgeClass(item.type))}>{typeLabel(item.type)}</span>
                          </button>
                        )
                      })}
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
