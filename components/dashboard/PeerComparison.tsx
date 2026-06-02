'use client'

import { Loader2, Swords } from 'lucide-react'
import { usePeerComparison } from '@/hooks/usePeerComparison'
import { PageHeader } from './PageHeader'
import { EmptyState } from './EmptyState'
import { Card, CardContent } from '@/components/ui/card'
import { PeerCard } from './PeerCard'

export function PeerComparison() {
  const { results, loading, isEmpty } = usePeerComparison()

  const withPeers = results.filter((r) => r.hasPeers)
  const withoutPeers = results.filter((r) => !r.hasPeers)

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
          <div className="space-y-2">
            {withPeers.map((asset) => (
              <PeerCard key={asset.ticker} asset={asset} />
            ))}
          </div>

          {withoutPeers.length > 0 && (
            <Card className="bg-card/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  Sin peers ({withoutPeers.length}): {withoutPeers.map((a) => a.ticker).join(', ')}. Añádelos desde el detalle del activo.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
