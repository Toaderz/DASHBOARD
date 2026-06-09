'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAllWatchlistTickers } from './useTopPerformers'
import { useRealtimePrices } from './useRealtimePrices'
import { useFxData } from './useFxData'
import type { AssetType, MetricKey } from '@/types'

// The 6 periods of the Beating-Peers block.
export const PEER_CMP_PERIODS: MetricKey[] = ['1D', '1W', '1M', '6M', 'YTD', '1Y']
// Periods served by the batch returns endpoint (1D comes from live quotes).
const RETURN_PERIODS: MetricKey[] = ['1W', '1M', '6M', 'YTD', '1Y']
// A period is "won" when the asset beats at least this share of its peers.
const WIN_THRESHOLD = 0.75
// Mínimo de peers con dato comparable para declarar ganado/perdido (evita veredictos con muy poca data).
const MIN_EVALUABLE = 1

interface MultiReturns {
  returns: Partial<Record<MetricKey, number | null>>
  years: Partial<Record<MetricKey, number | null>>
}

export type PeriodState = 'won' | 'lost' | 'insufficient'

export interface PeriodResult {
  beaten: string[]      // peer tickers strictly beaten this period
  evaluated: string[]   // peer tickers with valid data this period (beaten ⊆ evaluated)
  assigned: number      // total peers asignados al activo (constante entre períodos)
  won: boolean          // state === 'won'
  state: PeriodState    // 'insufficient' hasta que los datos se asienten (evita parpadeo)
  assetReturn: number | null
  peerReturns: Record<string, number | null>  // ticker peer → retorno USD ese período (null = sin dato)
}

export interface AssetComparison {
  ticker: string
  name: string
  type: AssetType | null
  watchlistNames: string[]
  peers: string[]
  peerNames: Record<string, string>  // ticker peer → nombre (cae al ticker si no hay metadata)
  peerTypes: Record<string, AssetType | null>  // ticker peer → tipo (para mostrar nombre en fondos)
  hasPeers: boolean
  metricsWon: number
  evaluatedPeriods: number
  byPeriod: Record<MetricKey, PeriodResult>
}

export function usePeerComparison() {
  const { tickers, loading: loadingTickers } = useAllWatchlistTickers()

  // 1. Effective peer set per asset (canonical materialization server-side).
  const [peerSets, setPeerSets] = useState<Record<string, string[]>>({})
  const [loadingPeers, setLoadingPeers] = useState(true)

  useEffect(() => {
    if (loadingTickers) return
    if (tickers.length === 0) { setPeerSets({}); setLoadingPeers(false); return }
    let cancelled = false
    setLoadingPeers(true)
    fetch('/api/peers/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: tickers.map((t) => t.ticker) }),
    })
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => { if (!cancelled) setPeerSets(data ?? {}) })
      .catch(() => { if (!cancelled) setPeerSets({}) })
      .finally(() => { if (!cancelled) setLoadingPeers(false) })
    return () => { cancelled = true }
  }, [tickers, loadingTickers])

  // 2. Deduped union (assets ∪ all peers) — each ticker fetched once.
  const unionTickers = useMemo(() => {
    const set = new Set<string>()
    for (const t of tickers) set.add(t.ticker.toUpperCase())
    for (const list of Object.values(peerSets)) for (const p of list) set.add(p.toUpperCase())
    return [...set]
  }, [tickers, peerSets])

  // 3. Live quotes (1D + currency) for the union. `pricesLoading` = primera carga (no refetch de fondo).
  const { prices, isLoading: pricesLoading } = useRealtimePrices(unionTickers)

  // 4. Multi-period returns for the union (server-side cached).
  const [returnsData, setReturnsData] = useState<Record<string, MultiReturns>>({})
  const [loadingReturns, setLoadingReturns] = useState(true)

  useEffect(() => {
    if (unionTickers.length === 0) { setReturnsData({}); setLoadingReturns(false); return }
    let cancelled = false
    setLoadingReturns(true)
    fetch('/api/market/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: unionTickers }),
    })
      .then((r) => r.json())
      .then((data: Record<string, MultiReturns>) => { if (!cancelled) setReturnsData(data ?? {}) })
      .catch(() => { if (!cancelled) setReturnsData({}) })
      .finally(() => { if (!cancelled) setLoadingReturns(false) })
    return () => { cancelled = true }
  }, [unionTickers])

  // 5. FX for USD normalization across the union's currencies.
  const currencies = useMemo(() => {
    const set = new Set<string>()
    for (const t of unionTickers) {
      const c = prices[t]?.currency
      if (c) set.add(c)
    }
    return [...set]
  }, [unionTickers, prices])
  const { fxRates, fxPeriodReturns, loading: fxLoading } = useFxData(currencies, RETURN_PERIODS)

  // Nombres y tipos de los tickers de la unión (activo + peers). Cosmético para el panel expandido del
  // PeerCard: NO bloquea `settled` (el panel funciona con tickers mientras cargan los nombres).
  const [names, setNames] = useState<Record<string, string>>({})
  const [types, setTypes] = useState<Record<string, AssetType | null>>({})
  useEffect(() => {
    if (unionTickers.length === 0) { setNames({}); setTypes({}); return }
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('assets_metadata')
      .select('ticker, name, type')
      .in('ticker', unionTickers)
      .then(({ data }) => {
        if (cancelled || !data) return
        const nameMap: Record<string, string> = {}
        const typeMap: Record<string, AssetType | null> = {}
        for (const m of data as Array<{ ticker: string; name: string; type: AssetType | null }>) {
          nameMap[m.ticker] = m.name
          typeMap[m.ticker] = m.type
        }
        setNames(nameMap)
        setTypes(typeMap)
      })
    return () => { cancelled = true }
  }, [unionTickers])

  // "Settled": todas las cargas iniciales terminaron. Hasta entonces NO calculamos won/lost
  // (los datos llegan async/parciales y harían parpadear el conteo). Los refetch de fondo
  // posteriores reflejan movimientos reales del mercado (comportamiento deseado, no parpadeo).
  const settled = !loadingTickers && !loadingPeers && !loadingReturns && !pricesLoading && !fxLoading

  // 6. Compute comparison per asset (everything normalized to USD).
  const results = useMemo<AssetComparison[]>(() => {
    const getUsdReturn = (ticker: string, period: MetricKey): number | null => {
      const key = ticker.toUpperCase()
      const local = period === '1D'
        ? (prices[key]?.change_percent ?? null)
        : (returnsData[key]?.returns?.[period] ?? null)
      if (local == null) return null
      const currency = prices[key]?.currency ?? 'USD'
      if (currency === 'USD') return local
      const fx = period === '1D'
        ? (fxRates[currency]?.change1d ?? null)
        : (fxPeriodReturns[currency]?.[period] ?? null)
      // Sin FX → NO comparable (null). Nunca comparamos un retorno local como si fuera USD.
      if (fx == null) return null
      return ((1 + local / 100) * (1 + fx / 100) - 1) * 100
    }

    const out: AssetComparison[] = tickers.map((t) => {
      const peers = (peerSets[t.ticker] ?? peerSets[t.ticker.toUpperCase()] ?? []).filter(
        (p) => p.toUpperCase() !== t.ticker.toUpperCase()
      )
      const byPeriod = {} as Record<MetricKey, PeriodResult>
      let metricsWon = 0
      let evaluatedPeriods = 0

      for (const period of PEER_CMP_PERIODS) {
        const assetReturn = settled ? getUsdReturn(t.ticker, period) : null
        const beaten: string[] = []
        const evaluated: string[] = []
        // Retorno USD por peer ese período (null = sin dato). Solo para visualización en el panel
        // expandido — NO afecta la decisión won/lost (que se toma sobre `evaluated`).
        const peerReturns: Record<string, number | null> = {}
        if (settled && assetReturn != null) {
          for (const peer of peers) {
            const pr = getUsdReturn(peer, period)
            peerReturns[peer] = pr // registra TODOS los peers (incl. sin dato → null)
            if (pr == null) continue // peer sin dato comparable (incl. no-USD sin FX) → fuera
            evaluated.push(peer)
            if (assetReturn > pr) beaten.push(peer) // strict; ties don't count
          }
        }
        // Win se decide SOLO sobre peers con dato (evaluated); los sin dato no perjudican.
        // Estado determinista: 'insufficient' hasta asentar o sin datos suficientes; si no, won/lost.
        let state: PeriodResult['state'] = 'insufficient'
        if (settled && assetReturn != null && evaluated.length >= MIN_EVALUABLE) {
          state = beaten.length / evaluated.length >= WIN_THRESHOLD ? 'won' : 'lost'
        }
        const won = state === 'won'
        if (state !== 'insufficient') evaluatedPeriods++
        if (won) metricsWon++
        // `assigned` = total de peers asignados (constante entre períodos) → denominador estable en la UI.
        byPeriod[period] = { beaten, evaluated, assigned: peers.length, won, state, assetReturn, peerReturns }
      }

      return {
        ticker: t.ticker,
        name: t.name,
        type: t.type,
        watchlistNames: t.watchlistNames,
        peers,
        peerNames: Object.fromEntries(
          peers.map((p) => [p, names[p] ?? names[p.toUpperCase()] ?? p])
        ),
        peerTypes: Object.fromEntries(
          peers.map((p) => [p, types[p] ?? types[p.toUpperCase()] ?? null])
        ),
        hasPeers: peers.length > 0,
        metricsWon,
        evaluatedPeriods,
        byPeriod,
      }
    })

    // Rank by metrics won, then by total periods evaluated (more data = more confident).
    return out.sort((a, b) => b.metricsWon - a.metricsWon || b.evaluatedPeriods - a.evaluatedPeriods || a.ticker.localeCompare(b.ticker))
  }, [tickers, peerSets, returnsData, prices, fxRates, fxPeriodReturns, settled, names, types])

  return {
    results,
    // loading hasta que todo se asienta → la UI muestra skeleton en vez de un conteo que parpadea.
    loading: !settled,
    isEmpty: !loadingTickers && tickers.length === 0,
  }
}
