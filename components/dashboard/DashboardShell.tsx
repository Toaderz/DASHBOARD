'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { LogOut, LayoutDashboard, Menu, X, TrendingUp, TrendingDown, Newspaper, Swords, GitCompare, type LucideIcon } from 'lucide-react'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { DUR, EASE_OUT } from '@/lib/motion-tokens'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'
import { Button } from '@/components/ui/button'
import { useWatchlists } from '@/hooks/useWatchlistAssets'
import { WatchlistManager } from '@/components/dashboard/WatchlistManager'
import { PriceMarquee } from '@/components/dashboard/PriceMarquee'
import { PageTransition } from '@/components/dashboard/PageTransition'

interface DashboardShellProps {
  user: User
  children: React.ReactNode
}

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; tour?: string }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, tour: 'nav-overview' },
  { href: '/top10', label: 'Top Performers', icon: TrendingUp },
  { href: '/bottom10', label: 'Worst Performers', icon: TrendingDown },
  { href: '/vs-peers', label: 'Beating Peers', icon: Swords, tour: 'nav-peers' },
  { href: '/etf-compare', label: 'Comparar', icon: GitCompare },
  { href: '/news', label: 'Market Brief', icon: Newspaper, tour: 'nav-news' },
]

export function DashboardShell({ user, children }: DashboardShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const reduced = useReducedMotion()
  const { watchlists, ownerEmails, createWatchlist, deleteWatchlist, updateWatchlist, leaveWatchlist } = useWatchlists()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setSidebarOpen(false)
    router.push(`/watchlist/${id}`)
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center">
          <Image src="/icons/icon-192.png" alt="Evolve" width={28} height={28} className="object-cover brightness-0 dark:brightness-100" />
        </div>
        <span className="font-editorial text-base font-bold tracking-tight">Evolve</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        <div data-tour="nav-watchlists" className="space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Navigation
          </p>
          {NAV_ITEMS.map(({ href, label, icon: Icon, tour }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                data-tour={tour}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[40px]',
                  active
                    ? 'bg-bone/[0.08] text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-spark'
                    : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                {label}
              </Link>
            )
          })}
        </div>

        <div className="pt-1">
          <WatchlistManager
            watchlists={watchlists}
            currentUserId={user.id}
            selectedId={selectedId}
            ownerEmails={ownerEmails}
            onSelect={handleSelect}
            onCreate={createWatchlist}
            onDelete={deleteWatchlist}
            onRename={(id, name) => updateWatchlist(id, { name })}
            onLeave={leaveWatchlist}
          />
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ThemeToggle />
            <Button
              variant="ghost-dim"
              size="icon"
              className="h-8 w-8"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Mobile header — only visible below md */}
      <header className="md:hidden flex h-12 shrink-0 items-center justify-between px-4 border-b border-border bg-ink-void z-10">
        <button
          onClick={() => setSidebarOpen(true)}
          data-tour="mobile-menu"
          className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-ink-elevated transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center">
            <Image src="/icons/icon-192.png" alt="Evolve" width={24} height={24} className="object-cover brightness-0 dark:brightness-100" />
          </div>
          <span className="font-editorial text-sm font-bold tracking-tight">Evolve</span>
        </div>
        <ThemeToggle />
      </header>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <motion.div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.fast }}
            />
            <motion.aside
              className="absolute left-0 top-0 bottom-0 w-72 flex flex-col bg-ink-void border-r border-border overflow-hidden"
              initial={reduced ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduced ? undefined : { x: '-100%' }}
              transition={{ duration: DUR.base, ease: EASE_OUT }}
            >
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-ink-elevated transition-colors"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
              {sidebarContent}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — hidden on mobile */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-ink-void">
          {sidebarContent}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto min-w-0 flex flex-col">
          <div data-tour="marquee">
            <PriceMarquee />
          </div>
          <div className="flex-1">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    </div>
  )
}
