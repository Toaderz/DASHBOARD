'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { TrendingUp, LogOut, LayoutDashboard } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'
import { Button } from '@/components/ui/button'
import { useWatchlists } from '@/hooks/useWatchlistAssets'
import { WatchlistManager } from '@/components/dashboard/WatchlistManager'

interface DashboardShellProps {
  user: User
  children: React.ReactNode
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  const router = useRouter()
  const supabase = createClient()
  const { watchlists, ownerEmails, createWatchlist, deleteWatchlist, updateWatchlist, leaveWatchlist } = useWatchlists()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    router.push(`/watchlist/${id}`)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <TrendingUp className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold">Evolve</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </Link>

          <div className="pt-2">
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
        <div className="border-t p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{user.email}</p>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={handleSignOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
