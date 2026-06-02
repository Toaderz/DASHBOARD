import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeInitialPeers, type CategoryHints } from '@/lib/market/peer-taxonomy'
import type { AssetMetadata } from '@/types'

/**
 * Canonical, deterministic materialization of a user's initial peer set per asset.
 *
 * Both the asset detail modal (single ticker) and the Beating-Peers page (many)
 * call this. Category hints come ONLY from price_cache (a single stable source),
 * so the materialized set is identical regardless of which surface triggers init.
 *
 * Body: { tickers: string[] }  →  Response: Record<ticker, string[]> (effective peers)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { tickers?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const requested = [...new Set(
    (Array.isArray(body.tickers) ? body.tickers : [])
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .map((t) => t.toUpperCase())
  )].slice(0, 300)

  if (requested.length === 0) return NextResponse.json({})

  const out: Record<string, string[]> = {}

  // 1. Existing curated rows (already initialized) — use as-is.
  const { data: existing } = await supabase
    .from('user_asset_peers')
    .select('asset_ticker, peers, initialized')
    .eq('user_id', user.id)
    .in('asset_ticker', requested)

  const initializedSet = new Set<string>()
  for (const row of (existing ?? []) as Array<{ asset_ticker: string; peers: string[]; initialized: boolean }>) {
    if (row.initialized) {
      out[row.asset_ticker] = row.peers ?? []
      initializedSet.add(row.asset_ticker)
    }
  }

  const toInit = requested.filter((t) => !initializedSet.has(t))
  if (toInit.length === 0) return NextResponse.json(out)

  // 2. Catalog (for selected-asset metadata + name hydration) and category hints.
  const [{ data: catalog }, { data: catRows }] = await Promise.all([
    supabase.from('assets_metadata').select('ticker, name, type, sector, region, industry, benchmark, manager'),
    supabase.from('price_cache').select('ticker, morningstar_category, global_category'),
  ])

  const allAssets = (catalog ?? []) as AssetMetadata[]
  const assetByTicker = new Map<string, AssetMetadata>(allAssets.map((a) => [a.ticker.toUpperCase(), a]))

  const categories: CategoryHints = {}
  for (const r of (catRows ?? []) as Array<{ ticker: string; morningstar_category: string | null; global_category: string | null }>) {
    if (r.morningstar_category || r.global_category) {
      categories[r.ticker.toUpperCase()] = { morningstar: r.morningstar_category, global: r.global_category }
    }
  }

  // 3. Compute initial peers deterministically and collect upserts.
  const upsertRows = toInit.map((ticker) => {
    const asset: AssetMetadata = assetByTicker.get(ticker) ?? {
      ticker, name: ticker, type: 'stock', sector: null, region: null, industry: null, benchmark: null, manager: null,
    }
    const peers = computeInitialPeers(asset, allAssets, { categories })
      .map((p) => p.ticker)
      .filter((t) => t.toUpperCase() !== ticker)
    out[ticker] = peers
    return { user_id: user.id, asset_ticker: ticker, peers, initialized: true, updated_at: new Date().toISOString() }
  })

  const { error } = await supabase.from('user_asset_peers').upsert(upsertRows, { onConflict: 'user_id,asset_ticker' })
  if (error) {
    // Materialization failed to persist — still return computed peers so the UI works.
    return NextResponse.json(out)
  }

  return NextResponse.json(out)
}
