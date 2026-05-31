'use client'

import { useQuery } from '@tanstack/react-query'
import type { BriefWithNews } from '@/types'

async function fetchNewsBrief(): Promise<{ data: BriefWithNews | null; stale: boolean }> {
  const res = await fetch('/api/news/current')
  if (!res.ok) throw new Error('Failed to fetch news brief')
  return res.json()
}

export function useNewsBrief() {
  return useQuery({
    queryKey: ['news-brief'],
    queryFn: fetchNewsBrief,
    staleTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    retry: 2,
  })
}
