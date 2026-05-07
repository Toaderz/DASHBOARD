import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Plus, TrendingUp, List } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: watchlists } = await supabase
    .from('watchlists')
    .select('*')
    .order('created_at', { ascending: true })

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Select a watchlist from the sidebar to get started.</p>
      </div>

      {watchlists && watchlists.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {watchlists.map((wl) => (
            <Link
              key={wl.id}
              href={`/watchlist/${wl.id}`}
              className="rounded-lg border bg-card p-5 shadow-sm transition-colors hover:bg-accent/50"
            >
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                  <List className="h-4 w-4 text-primary" />
                </div>
                <h2 className="font-semibold">{wl.name}</h2>
              </div>
              {wl.description && (
                <p className="text-sm text-muted-foreground">{wl.description}</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {(wl.selected_metrics as string[]).length} metrics active
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <TrendingUp className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mb-2 text-lg font-semibold">No watchlists yet</h2>
          <p className="mb-6 max-w-xs text-sm text-muted-foreground">
            Create your first watchlist using the sidebar to start tracking assets.
          </p>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Plus className="h-4 w-4" />
            Click the + button in the sidebar to create one
          </div>
        </div>
      )}
    </div>
  )
}
