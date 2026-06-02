'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAllWatchlistTickers } from './useTopPerformers'
import { useRealtimePrices } from './useRealtimePrices'
import { useFxData } from './useFxData'
import type { MetricKey } from '@/types'

// The 6 periods of the Beating-Peers block.
export const PEER_CMP_PERIODS: MetricKey[] = ['1D', '1W', '1M', '6M', 'YTD', '1Y']
// Periods served by the batch returns endpoint (1D comes from live quotes).
const RETURN_PERIODS: MetricKey[] = ['1W', '1M', '6M', 'YTD', '1Y']
// A period is "won" when the asset beats at least this share of its peers.
const WIN_THRESHOLD = 0.75

interface MultiReturns {
  returns: Partial<Record<MetricKey, number | null>>
  years: Partial<Record<MetricKey, number | null>>
}

export interface PeriodResult {
  beaten: string[]      // peer tickers strictly beaten this period
  evaluated: string[]   // peer tickers with valid data this period (beaten ⊆ evaluated)
  total: number         // = evaluated.length
  won: boolean          // beaten/total >= 0.75
  assetReturn: number | null
}

export interface AssetComparison {
  ticker: string
  name: string
  watchlistNames: string[]
  peers: string[]
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

  // 3. Live quotes (1D + currency) for the union.
  const { prices } = useRealtimePrices(unionTickers)

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
  const { fxRates, fxPeriodReturns } = useFxData(currencies, RETURN_PERIODS)

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
      if (fx == null) return local // no FX data → fall back to local (flagged in plan)
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
        const assetReturn = getUsdReturn(t.ticker, period)
        const beaten: string[] = []
        const evaluated: string[] = []
        if (assetReturn != null) {
          for (const peer of peers) {
            const pr = getUsdReturn(peer, period)
            if (pr == null) continue
            evaluated.push(peer)
            if (assetReturn > pr) beaten.push(peer) // strict; ties don't count
          }
        }
        const total = evaluated.length
        const won = total > 0 && beaten.length / total >= WIN_THRESHOLD
        if (total > 0) evaluatedPeriods++
        if (won) metricsWon++
        byPeriod[period] = { beaten, evaluated, total, won, assetReturn }
      }

      return {
        ticker: t.ticker,
        name: t.name,
        watchlistNames: t.watchlistNames,
        peers,
        hasPeers: peers.length > 0,
        metricsWon,
        evaluatedPeriods,
        byPeriod,
      }
    })

    // Rank by metrics won, then by total periods evaluated (more data = more confident).
    return out.sort((a, b) => b.metricsWon - a.metricsWon || b.evaluatedPeriods - a.evaluatedPeriods || a.ticker.localeCompare(b.ticker))
  }, [tickers, peerSets, returnsData, prices, fxRates, fxPeriodReturns])

  return {
    results,
    loading: loadingTickers || loadingPeers || loadingReturns,
    isEmpty: !loadingTickers && tickers.length === 0,
  }
}
