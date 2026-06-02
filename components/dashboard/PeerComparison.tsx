'use client'

import { Loader2 } from 'lucide-react'
import { usePeerComparison } from '@/hooks/usePeerComparison'
import { PeerCard } from './PeerCard'

export function PeerComparison() {
  const { results, loading, isEmpty } = usePeerComparison()

  const withPeers = results.filter((r) => r.hasPeers)
  const withoutPeers = results.filter((r) => !r.hasPeers)

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Beating Peers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cómo le gana cada activo a sus peers en 1D, 1W, 1M, 6M, YTD y 1Y — retornos en USD.
          Gana un periodo si supera al ≥75% de sus peers. Edita los peers desde el detalle de cada activo.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Calculando comparativa contra peers…</span>
        </div>
      ) : isEmpty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No tienes activos en tus watchlists todavía.
        </p>
      ) : withPeers.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Ninguno de tus activos tiene peers asignados aún. Ábrelos en el detalle para añadirlos.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {withPeers.map((asset) => (
              <PeerCard key={asset.ticker} asset={asset} />
            ))}
          </div>

          {withoutPeers.length > 0 && (
            <p className="mt-6 text-xs text-muted-foreground">
              Sin peers ({withoutPeers.length}): {withoutPeers.map((a) => a.ticker).join(', ')}. Añádelos desde el detalle del activo.
            </p>
          )}
        </>
      )}
    </div>
  )
}
