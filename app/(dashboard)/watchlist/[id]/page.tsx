import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { WatchlistView } from '@/components/dashboard/WatchlistView'

interface WatchlistPageProps {
  params: Promise<{ id: string }>
}

export default async function WatchlistPage({ params }: WatchlistPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: watchlist } = await supabase
    .from('watchlists')
    .select('*')
    .eq('id', id)
    .single()

  if (!watchlist) notFound()

  // Fetch all assets for peers comparison
  const { data: allAssets } = await supabase.from('assets_metadata').select('*')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{watchlist.name}</h1>
        {watchlist.description && (
          <p className="text-muted-foreground">{watchlist.description}</p>
        )}
      </div>
      <WatchlistView watchlist={watchlist} allAssets={allAssets ?? []} />
    </div>
  )
}
