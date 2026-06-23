import { Suspense } from 'react'
import { EtfCompare } from '@/components/dashboard/etf-compare/EtfCompare'

// Suspense boundary required: EtfCompare reads tickers from the URL via useSearchParams.
export default function EtfComparePage() {
  return (
    <Suspense fallback={null}>
      <EtfCompare />
    </Suspense>
  )
}
