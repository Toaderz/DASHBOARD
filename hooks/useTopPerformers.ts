'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { MetricKey, QuoteData } from '@/types'
import type { FxSpotRate } from '@/hooks/useFxData'

export interface TopEntry {
  ticker: string
  name: string
  returnValue: number
  years: number | null
  watchlistNames: string[]
}

export interface TickerInfo {
  ticker: string
  name: string
  watchlistNames: string[]
}

interface RawEntry extends TickerInfo {
  localReturn: number
  years: number | null
}

export const TOP_PERIODS: MetricKey[] = ['1D', '1W', '1M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX']

export function useAllWatchlistTickers() {
  const [tickers, setTickers] = useState<TickerInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    async function load() {
      // Two queries to avoid FK-join uncertainty
      const { data: waData } = await supabase
        .from('watchlist_assets')
        .select('asset_ticker, watchlists!inner(name)')

      if (!waData) { setLoading(false); return }

      const uniqueTickers = [...new Set(waData.map((r: { asset_ticker: string }) => r.asset_ticker))]

      const { data: metaData } = await supabase
        .from('assets_metadata')
        .select('ticker, name')
        .in('ticker', uniqueTickers)

      const nameByTicker = new Map<string, string>()
      for (const m of (metaData ?? []) as Array<{ ticker: string; name: string }>) {
        nameByTicker.set(m.ticker, m.name)
      }

      const map = new Map<string, TickerInfo>()
      for (const row of waData as unknown as Array<{ asset_ticker: string; watchlists: { name: string } | { name: string }[] }>) {
        const { asset_ticker: ticker, watchlists: wlRaw } = row
        const wl = Array.isArray(wlRaw) ? wlRaw[0] : wlRaw
        const wlName = wl?.name ?? '—'
        const assetName = nameByTicker.get(ticker) ?? ticker

        if (map.has(ticker)) {
          const existing = map.get(ticker)!
          if (!existing.watchlistNames.includes(wlName)) existing.watchlistNames.push(wlName)
        } else {
          map.set(ticker, { ticker, name: assetName, watchlistNames: [wlName] })
        }
      }

      setTickers([...map.values()])
      setLoading(false)
    }
    load()
  }, [])

  return { tickers, loading }
}

export function useTopPerformers(
  tickers: TickerInfo[],
  prices: Record<string, QuoteData>,
  activePeriod: MetricKey,
  fxRates: Record<string, FxSpotRate>,
  fxPeriodReturns: Record<string, Partial<Record<MetricKey, number | null>>>,
  annualize: boolean
) {
  // Stores all tickers' raw local returns (not USD-converted, not annualized)
  const historyCache = useRef<Partial<Record<MetricKey, RawEntry[]>>>({})
  const inFlight = useRef<Set<MetricKey>>(new Set())
  const [rawResults, setRawResults] = useState<Partial<Record<MetricKey, RawEntry[]>>>({})
  const [loadingPeriods, setLoadingPeriods] = useState<Set<MetricKey>>(new Set())

  // 1D: derive from live prices (change_percent is in local currency)
  useEffect(() => {
    if (tickers.length === 0 || Object.keys(prices).length === 0) return
    const entries: RawEntry[] = tickers
      .filter(t => prices[t.ticker]?.change_percent != null)
      .map(t => ({ ...t, localReturn: prices[t.ticker].change_percent!, years: null }))
    setRawResults(prev => ({ ...prev, '1D': entries }))
  }, [tickers, prices])

  const fetchPeriod = useCallback(async (period: MetricKey) => {
    if (period === '1D' || tickers.length === 0) return
    if (inFlight.current.has(period)) return
    if (historyCache.current[period]) {
      setRawResults(prev => ({ ...prev, [period]: historyCache.current[period]! }))
      return
    }

    inFlight.current.add(period)
    setLoadingPeriods(prev => new Set([...prev, period]))

    const fetched = await Promise.all(
      tickers.map(async (t) => {
        try {
          const res = await fetch(
            `/api/market/history?ticker=${encodeURIComponent(t.ticker)}&period=${period}&mode=return`
          )
          if (!res.ok) return null
          const json = await res.json()
          if (json.return == null) return null
          return {
            ...t,
            localReturn: json.return as number,
            years: (json.years as number | null) ?? null,
          }
        } catch { return null }
      })
    )

    const valid = fetched.filter(Boolean) as RawEntry[]
    historyCache.current[period] = valid
    inFlight.current.delete(period)
    setRawResults(prev => ({ ...prev, [period]: valid }))
    setLoadingPeriods(prev => { const s = new Set(prev); s.delete(period); return s })
  }, [tickers])

  useEffect(() => {
    if (activePeriod !== '1D') fetchPeriod(activePeriod)
  }, [activePeriod, fetchPeriod])

  // Invalidate cache when tickers change
  useEffect(() => {
    historyCache.current = {}
    inFlight.current = new Set()
    setRawResults({})
    setLoadingPeriods(new Set())
  }, [tickers])

  const top = useMemo((): TopEntry[] => {
    const raw = rawResults[activePeriod]
    if (!raw || raw.length === 0) return []

    // MAX is always annualized; other periods respect the user toggle.
    // Sub-annual periods (years < 1) skip annualization (result is meaningless).
    const forceAnnualize = activePeriod === 'MAX'
    const doAnnualize = annualize || forceAnnualize

    const converted = raw.map(entry => {
      const currency = prices[entry.ticker]?.currency ?? 'USD'

      let fxReturn = 0
      if (currency !== 'USD') {
        if (activePeriod === '1D') {
          fxReturn = fxRates[currency]?.change1d ?? 0
        } else {
          fxReturn = (fxPeriodReturns[currency]?.[activePeriod] as number | null | undefined) ?? 0
        }
      }

      const usdReturn = currency !== 'USD'
        ? ((1 + entry.localReturn / 100) * (1 + fxReturn / 100) - 1) * 100
        : entry.localReturn

      let displayReturn = usdReturn
      if (doAnnualize && entry.years != null && entry.years >= 1) {
        displayReturn = (Math.pow(1 + usdReturn / 100, 1 / entry.years) - 1) * 100
      }

      return { ...entry, returnValue: displayReturn }
    })

    return converted.sort((a, b) => b.returnValue - a.returnValue).slice(0, 10)
  }, [rawResults, activePeriod, prices, fxRates, fxPeriodReturns, annualize])

  const bottom = useMemo((): TopEntry[] => {
    const raw = rawResults[activePeriod]
    if (!raw || raw.length === 0) return []

    const forceAnnualize = activePeriod === 'MAX'
    const doAnnualize = annualize || forceAnnualize

    const converted = raw.map(entry => {
      const currency = prices[entry.ticker]?.currency ?? 'USD'

      let fxReturn = 0
      if (currency !== 'USD') {
        if (activePeriod === '1D') {
          fxReturn = fxRates[currency]?.change1d ?? 0
        } else {
          fxReturn = (fxPeriodReturns[currency]?.[activePeriod] as number | null | undefined) ?? 0
        }
      }

      const usdReturn = currency !== 'USD'
        ? ((1 + entry.localReturn / 100) * (1 + fxReturn / 100) - 1) * 100
        : entry.localReturn

      let displayReturn = usdReturn
      if (doAnnualize && entry.years != null && entry.years >= 1) {
        displayReturn = (Math.pow(1 + usdReturn / 100, 1 / entry.years) - 1) * 100
      }

      return { ...entry, returnValue: displayReturn }
    })

    return converted.sort((a, b) => a.returnValue - b.returnValue).slice(0, 10)
  }, [rawResults, activePeriod, prices, fxRates, fxPeriodReturns, annualize])

  return {
    top,
    bottom,
    loading: activePeriod === '1D' ? false : loadingPeriods.has(activePeriod),
  }
}
