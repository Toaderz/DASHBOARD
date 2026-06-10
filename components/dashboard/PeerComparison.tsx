'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Search, Swords, X } from 'lucide-react'
import { usePeerComparison } from '@/hooks/usePeerComparison'
import { fadeUp, staggerContainer } from '@/lib/motion-tokens'
import { PageHeader } from './PageHeader'
import { EmptyState } from './EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { PeerCard } from './PeerCard'
import { SegmentedControl } from './SegmentedControl'

// Filtro de relevancia: activo "ganador" si supera >50% de los 6 períodos (≥4/6 por defecto).
type MinWon = '3' | '4' | '5' | '6'
const MIN_WON_OPTIONS: { value: MinWon; label: string }[] = [
  { value: '3', label: '≥ 3/6' },
  { value: '4', label: '≥ 4/6' },
  { value: '5', label: '≥ 5/6' },
  { value: '6', label: '6/6' },
]

export function PeerComparison() {
  const { results, loading, isEmpty } = usePeerComparison()
  const [minWon, setMinWon] = useState<MinWon>('4')
  const [filterQuery, setFilterQuery] = useState('')

  const withPeers = useMemo(() => results.filter((r) => r.hasPeers), [results])
  const withoutPeers = useMemo(() => results.filter((r) => !r.hasPeers), [results])

  // Filtros combinados (AND): mínimo de períodos ganados + búsqueda por ticker/nombre.
  const visible = useMemo(() => {
    const threshold = parseInt(minWon, 10)
    const q = filterQuery.trim().toLowerCase()
    return withPeers.filter((r) => {
      if (r.metricsWon < threshold) return false
      if (q && !r.ticker.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [withPeers, minWon, filterQuery])

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <PageHeader
        icon={Swords}
        title="Beating Peers"
        description="En cuántas de 6 métricas (1D, 1W, 1M, 6M, YTD, 1Y) cada activo le gana a sus peers — retornos en USD. Gana un periodo si supera al ≥75% de sus peers. Edita los peers desde el detalle de cada activo."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Calculando comparativa contra peers…</span>
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={Swords}
          title="No tienes activos en tus watchlists todavía"
          description="Agrega activos a una watchlist para comparar su desempeño contra sus peers."
        />
      ) : withPeers.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="Ninguno de tus activos tiene peers asignados aún"
          description="Ábrelos en el detalle del activo para añadir peers y comparar su desempeño."
        />
      ) : (
        <div className="space-y-4">
          {/* Toolbar: filtro de períodos ganados + buscador */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Ganan al menos</span>
              <SegmentedControl
                size="sm"
                aria-label="Mínimo de períodos ganados"
                options={MIN_WON_OPTIONS}
                value={minWon}
                onChange={setMinWon}
              />
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar…"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full rounded-md border border-border bg-ink-elevated/40 pl-7 pr-7 py-1.5 text-xs font-ui placeholder:text-muted-foreground/70 transition-colors focus:outline-none focus:border-foreground/40"
              />
              {filterQuery && (
                <button
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Limpiar filtro"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Swords}
              title="Ningún activo cumple el filtro"
              description="Ajusta el mínimo de períodos ganados o la búsqueda para ver más activos."
              compact
            />
          ) : (
            <motion.div className="space-y-2" variants={staggerContainer} initial="hidden" animate="show">
              {visible.map((asset) => (
                <motion.div key={asset.ticker} variants={fadeUp}>
                  <PeerCard asset={asset} />
                </motion.div>
              ))}
            </motion.div>
          )}

          {withoutPeers.length > 0 && (
            <Card className="bg-card/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  Sin peers ({withoutPeers.length}): {withoutPeers.map((a) => (a.type === 'fund' ? a.name : a.ticker)).join(', ')}. Añádelos desde el detalle del activo.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
