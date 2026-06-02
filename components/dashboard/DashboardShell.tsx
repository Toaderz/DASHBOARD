'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogOut, LayoutDashboard, Menu, X, TrendingUp, TrendingDown, Newspaper, Swords } from 'lucide-react'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'
import { Button } from '@/components/ui/button'
import { useWatchlists } from '@/hooks/useWatchlistAssets'
import { WatchlistManager } from '@/components/dashboard/WatchlistManager'
import { PriceMarquee } from '@/components/dashboard/PriceMarquee'

interface DashboardShellProps {
  user: User
  children: React.ReactNode
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const router = useRouter()
  const supabase = createClient()
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
        <div data-tour="nav-watchlists">
          <p className="px-2 pb-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">
            Navigation
          </p>
          <Link
            href="/"
            data-tour="nav-overview"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground hover:bg-ink-elevated hover:text-foreground transition-colors min-h-[40px]"
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            Overview
          </Link>
          <Link
            href="/top10"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground hover:bg-ink-elevated hover:text-foreground transition-colors min-h-[40px]"
          >
            <TrendingUp className="h-4 w-4 shrink-0" />
            Top Performers
          </Link>
          <Link
            href="/bottom10"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground hover:bg-ink-elevated hover:text-foreground transition-colors min-h-[40px]"
          >
            <TrendingDown className="h-4 w-4 shrink-0" />
            Worst Performers
          </Link>
          <Link
            href="/vs-peers"
            data-tour="nav-peers"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground hover:bg-ink-elevated hover:text-foreground transition-colors min-h-[40px]"
          >
            <Swords className="h-4 w-4 shrink-0" />
            Beating Peers
          </Link>
          <Link
            href="/news"
            data-tour="nav-news"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground hover:bg-ink-elevated hover:text-foreground transition-colors min-h-[40px]"
          >
            <Newspaper className="h-4 w-4 shrink-0" />
            Market Brief
          </Link>
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
      <header className="md:hidden flex h-12 shrink-0 items-center justify-between px-4 border-b border-border bg-ink-base z-10">
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
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 flex flex-col bg-ink-base border-r border-border overflow-hidden">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-ink-elevated transition-colors"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar — hidden on mobile */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-ink-base">
          {sidebarContent}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto min-w-0 flex flex-col">
          <div data-tour="marquee">
            <PriceMarquee />
          </div>
          <div className="flex-1">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
