import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  computeInitialPeers,
  STATIC_PEERS,
  type PeerSignals,
  type PeerSignalsMap,
} from '@/lib/market/peer-taxonomy'
import { fetchFundamentals } from '@/lib/market/finnhub'
import type { AssetMetadata } from '@/types'

/**
 * Canonical, DETERMINISTIC materialization of a user's peer set per asset.
 *
 * Determinismo: las señales (Morningstar category + holdings/sectores + fundamentals) se leen de
 * price_cache (única fuente estable) y se CONGELAN en `auto_peers`. El scoring es una función pura
 * con tie-breakers estables (ticker asc). Re-materializar dos veces con el mismo price_cache da el
 * mismo resultado. `engine_version` permite forzar un recálculo global cuando cambia la fórmula.
 *
 * Materialización en watchlist (decisión del usuario): para activos SIN STATIC_PEERS, los peers se
 * insertan como filas `source='auto-peer'` en la(s) watchlist(s) propias que contienen el activo,
 * etiquetados y agrupados (category = 'Peers · TICKER'). Idempotente; nunca toca filas 'user' ni
 * STATIC_PEERS. Guard de recursión: los activos que solo existen como 'auto-peer' NO generan peers.
 *
 * Body: { tickers: string[] }  →  Response: Record<ticker, string[]> (peers efectivos)
 */

const CURRENT_ENGINE_VERSION = 1
const FUND_TYPES = new Set(['etf', 'fund'])
const PEER_CATEGORY = (base: string) => `Peers · ${base}`

interface PeerRow {
  asset_ticker: string
  peers: string[] | null
  initialized: boolean | null
  auto_peers: string[] | null
  removed: string[] | null
  pinned: string[] | null
  engine_version: number | null
}

// Service-role client SOLO para escribir price_cache (RLS: escritura solo service role).
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key)
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

// Dedupe preservando orden; tickers en MAYÚSCULAS.
function uniqUpper(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of list) {
    const u = t.toUpperCase()
    if (!seen.has(u)) { seen.add(u); out.push(u) }
  }
  return out
}

// Efectivo = (auto − removed) ∪ pinned, deduplicado, sin el propio activo.
function effectivePeers(self: string, autoPeers: string[], pinned: string[], removed: string[]): string[] {
  const rm = new Set(removed.map((t) => t.toUpperCase()))
  const base = autoPeers.map((t) => t.toUpperCase()).filter((t) => !rm.has(t))
  return uniqUpper([...base, ...pinned.map((t) => t.toUpperCase())]).filter((t) => t !== self.toUpperCase())
}

function buildSignals(catRows: Array<Record<string, unknown>>): PeerSignalsMap {
  const signals: PeerSignalsMap = {}
  for (const r of catRows) {
    const ticker = String(r.ticker ?? '').toUpperCase()
    if (!ticker) continue
    const sig: PeerSignals = {
      morningstar: (r.morningstar_category as string | null) ?? null,
      global: (r.global_category as string | null) ?? null,
      expenseRatio: (r.expense_ratio as number | null) ?? null,
      aum: (r.aum as number | null) ?? null,
      country: (r.country as string | null) ?? null,
      marketCap: (r.market_cap as number | null) ?? null,
    }
    // sector_weightings: [{ sector, weight }]
    const sw = r.sector_weightings as Array<{ sector?: string; weight?: number }> | null | undefined
    if (Array.isArray(sw) && sw.length > 0) {
      const rec: Record<string, number> = {}
      for (const s of sw) if (s?.sector && typeof s.weight === 'number') rec[s.sector] = s.weight
      if (Object.keys(rec).length > 0) sig.sectorWeights = rec
    }
    // top_holdings: [{ symbol, name, pct }] → símbolos MAYÚSCULAS + ordenados
    const th = r.top_holdings as Array<{ symbol?: string | null }> | null | undefined
    if (Array.isArray(th) && th.length > 0) {
      const syms = th.map((h) => (h?.symbol ?? '').toUpperCase()).filter(Boolean).sort()
      if (syms.length > 0) sig.holdings = syms
    }
    signals[ticker] = sig
  }
  return signals
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  // 1. Filas existentes. Reusamos como-están solo si están inicializadas Y en la versión actual
  //    del motor (esto permite backfill automático al subir CURRENT_ENGINE_VERSION).
  const { data: existing } = await supabase
    .from('user_asset_peers')
    .select('asset_ticker, peers, initialized, auto_peers, removed, pinned, engine_version')
    .eq('user_id', user.id)
    .in('asset_ticker', requested)

  const existingByTicker = new Map<string, PeerRow>()
  const initializedSet = new Set<string>()
  for (const row of (existing ?? []) as PeerRow[]) {
    existingByTicker.set(row.asset_ticker.toUpperCase(), row)
    if (row.initialized && (row.engine_version ?? 0) >= CURRENT_ENGINE_VERSION) {
      out[row.asset_ticker] = row.peers ?? []
      initializedSet.add(row.asset_ticker.toUpperCase())
    }
  }

  // 2. Holdings del usuario (source='user') en TODAS sus watchlists propias. Sirve para:
  //    (a) guard de recursión, (b) ubicar dónde insertar auto-peers, (c) evitar duplicar holdings.
  const { data: userWls } = await supabase.from('watchlists').select('id').eq('user_id', user.id)
  const wlIds = (userWls ?? []).map((w) => w.id as string)

  const { data: holdingRows } = wlIds.length
    ? await supabase
        .from('watchlist_assets')
        .select('watchlist_id, asset_ticker, sort_order, source')
        .in('watchlist_id', wlIds)
    : { data: [] as Array<Record<string, unknown>> }

  const isUserHolding = new Set<string>()
  const baseLocations = new Map<string, Array<{ watchlist_id: string; sort_order: number | null }>>()
  const holdingsByWl = new Map<string, Set<string>>()
  for (const r of (holdingRows ?? []) as Array<{ watchlist_id: string; asset_ticker: string; sort_order: number | null; source: string | null }>) {
    const t = r.asset_ticker.toUpperCase()
    const src = r.source ?? 'user' // filas legacy (NULL) = holdings del usuario
    if (src !== 'user') continue
    isUserHolding.add(t)
    if (!baseLocations.has(t)) baseLocations.set(t, [])
    baseLocations.get(t)!.push({ watchlist_id: r.watchlist_id, sort_order: r.sort_order })
    if (!holdingsByWl.has(r.watchlist_id)) holdingsByWl.set(r.watchlist_id, new Set())
    holdingsByWl.get(r.watchlist_id)!.add(t)
  }

  // toInit: solicitados, no inicializados-en-versión-actual, Y que sean holdings del usuario.
  // (Guard de recursión: los tickers que solo existen como 'auto-peer' nunca se materializan.)
  const toInit = requested.filter((t) => !initializedSet.has(t) && isUserHolding.has(t))
  // Solicitados que no son holdings ni están inicializados → devolver lo persistido (o vacío).
  for (const t of requested) {
    if (!(t in out)) out[t] = existingByTicker.get(t)?.peers ?? []
  }
  if (toInit.length === 0) return NextResponse.json(out)

  // 3. Catálogo (metadata) + señales (price_cache).
  const [{ data: catalog }, { data: catRows }] = await Promise.all([
    supabase.from('assets_metadata').select('ticker, name, type, sector, region, industry, benchmark, manager'),
    supabase.from('price_cache').select('ticker, morningstar_category, global_category, sector_weightings, top_holdings, expense_ratio, aum, country, market_cap'),
  ])
  const allAssets = (catalog ?? []) as AssetMetadata[]
  const assetByTicker = new Map<string, AssetMetadata>(allAssets.map((a) => [a.ticker.toUpperCase(), a]))
  const signals = buildSignals((catRows ?? []) as Array<Record<string, unknown>>)

  // 4. Gate de confianza: para fund/ETF en toInit, sin STATIC_PEERS y SIN Morningstar category,
  //    intenta traer fundamentals AHORA (no congelar un set degradado). Persiste a price_cache
  //    vía service role (best-effort) y usa el resultado en memoria para esta corrida.
  const needFund = toInit.filter((t) => {
    const type = assetByTicker.get(t)?.type
    return type != null && FUND_TYPES.has(type) && !STATIC_PEERS[t] && !signals[t]?.morningstar
  })
  const admin = needFund.length > 0 ? getAdminClient() : null
  const categoryResolved = new Set<string>()
  if (needFund.length > 0) {
    await mapWithConcurrency(needFund, 4, async (t) => {
      try {
        const f = await fetchFundamentals(t)
        if (f.morningstar_category || f.sector_weightings || f.aum != null) {
          // Mezcla en memoria para esta corrida.
          signals[t] = {
            ...signals[t],
            morningstar: f.morningstar_category ?? signals[t]?.morningstar ?? null,
            global: f.global_category ?? signals[t]?.global ?? null,
            expenseRatio: f.expense_ratio ?? signals[t]?.expenseRatio ?? null,
            aum: f.aum ?? signals[t]?.aum ?? null,
            country: f.country ?? signals[t]?.country ?? null,
            sectorWeights: f.sector_weightings
              ? Object.fromEntries(f.sector_weightings.map((s) => [s.sector, s.weight]))
              : signals[t]?.sectorWeights ?? null,
            holdings: f.top_holdings
              ? f.top_holdings.map((h) => (h.symbol ?? '').toUpperCase()).filter(Boolean).sort()
              : signals[t]?.holdings ?? null,
          }
          if (f.morningstar_category) categoryResolved.add(t)
          // Persistir a price_cache (best-effort, no bloquea).
          if (admin) {
            await admin.from('price_cache')
              .upsert({ ticker: t, ...f, fundamentals_fetched_at: new Date().toISOString() }, { onConflict: 'ticker' })
              .then(({ error }) => { if (error) console.error('[peers/init] price_cache upsert', t, error.message) })
          }
        }
      } catch (err) {
        console.error('[peers/init] fetchFundamentals failed', t, err instanceof Error ? err.message : err)
      }
    })
  }

  // 5. Computar peers deterministas + persistir + (para no-static) insertar en watchlist.
  const peerRowsToUpsert: Array<Record<string, unknown>> = []
  const metaToEnsure = new Map<string, AssetMetadata>() // peers que faltan en assets_metadata
  // Por watchlist → operaciones de inserción de auto-peers.
  const autoInserts: Array<{ watchlist_id: string; rows: Array<Record<string, unknown>>; base: string }> = []

  for (const ticker of toInit) {
    const asset: AssetMetadata = assetByTicker.get(ticker) ?? {
      ticker, name: ticker, type: 'stock', sector: null, region: null, industry: null, benchmark: null, manager: null,
    }
    const isStatic = !!STATIC_PEERS[ticker]

    // Skip-freeze: fund/ETF no-static que SIGUE sin categoría tras el gate → no congelar.
    const stillNoCategory = FUND_TYPES.has(asset.type) && !isStatic && !signals[ticker]?.morningstar && !categoryResolved.has(ticker)

    const computed = computeInitialPeers(asset, allAssets, { signals })
    const autoPeers = computed.map((p) => p.ticker).filter((t) => t.toUpperCase() !== ticker)

    const prev = existingByTicker.get(ticker)
    const pinned = prev?.pinned ?? []
    const removed = prev?.removed ?? []
    const peers = effectivePeers(ticker, autoPeers, pinned, removed)
    out[ticker] = peers

    if (stillNoCategory) {
      // No persistimos como inicializado: reintenta en la próxima carga (cuando haya datos).
      continue
    }

    peerRowsToUpsert.push({
      user_id: user.id,
      asset_ticker: ticker,
      peers,
      auto_peers: autoPeers,
      pinned,
      removed,
      initialized: true,
      engine_version: CURRENT_ENGINE_VERSION,
      updated_at: new Date().toISOString(),
    })

    // Materialización en watchlist: SOLO activos sin STATIC_PEERS (decisión del usuario).
    if (!isStatic && peers.length > 0) {
      // Map de metadata de los peers (para asegurar FK en assets_metadata).
      const peerMetaByTicker = new Map(computed.map((p) => [p.ticker.toUpperCase(), p]))
      for (const loc of baseLocations.get(ticker) ?? []) {
        const heldInWl = holdingsByWl.get(loc.watchlist_id) ?? new Set<string>()
        const rows: Array<Record<string, unknown>> = []
        let offset = 1
        for (const peer of peers) {
          if (heldInWl.has(peer)) continue // ya es holding del usuario en esa lista → no duplicar
          const meta = peerMetaByTicker.get(peer) ?? assetByTicker.get(peer)
          if (meta) metaToEnsure.set(peer, meta)
          else metaToEnsure.set(peer, { ticker: peer, name: peer, type: 'stock', sector: null, region: null, industry: null, benchmark: null, manager: null })
          rows.push({
            watchlist_id: loc.watchlist_id,
            asset_ticker: peer,
            category: PEER_CATEGORY(ticker),
            source: 'auto-peer',
            peer_of: ticker,
            sort_order: (loc.sort_order ?? 0) * 100 + offset,
          })
          offset++
        }
        if (rows.length > 0) autoInserts.push({ watchlist_id: loc.watchlist_id, rows, base: ticker })
      }
    }
  }

  // 5a. Persistir el mapping de peers (fix del bug: en error NO marcamos initialized).
  if (peerRowsToUpsert.length > 0) {
    const { error } = await supabase.from('user_asset_peers').upsert(peerRowsToUpsert, { onConflict: 'user_id,asset_ticker' })
    if (error) {
      console.error('[peers/init] user_asset_peers upsert error:', error.message)
      return NextResponse.json(out) // devolvemos computados; no quedó persistido → reintenta luego
    }
  }

  // 5b. Asegurar peers en assets_metadata (FK) — un batch.
  if (metaToEnsure.size > 0) {
    const metaRows = [...metaToEnsure.values()].map((m) => ({
      ticker: m.ticker, name: m.name ?? m.ticker, type: m.type ?? 'stock',
      sector: m.sector ?? null, region: m.region ?? null, industry: m.industry ?? null,
      benchmark: m.benchmark ?? null, manager: m.manager ?? null,
    }))
    await supabase.from('assets_metadata').upsert(metaRows, { onConflict: 'ticker', ignoreDuplicates: true })
  }

  // 5c. Insertar auto-peers en la watchlist (reset idempotente por peer_of, luego insert).
  for (const ins of autoInserts) {
    await supabase.from('watchlist_assets')
      .delete()
      .eq('watchlist_id', ins.watchlist_id)
      .eq('source', 'auto-peer')
      .eq('peer_of', ins.base)
    await supabase.from('watchlist_assets')
      .upsert(ins.rows, { onConflict: 'watchlist_id,asset_ticker,category', ignoreDuplicates: true })
  }

  return NextResponse.json(out)
}
