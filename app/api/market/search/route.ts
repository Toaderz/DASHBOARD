import { NextRequest, NextResponse } from 'next/server'
import { searchTickers } from '@/lib/market/finnhub'
import { requireUser } from '@/lib/auth/require-user'
import { parseSearchQuery } from '@/lib/market/validation'
import { OBS, newCorrelationId, obsInfo, startTimer } from '@/lib/utils/obs'

export async function GET(request: NextRequest) {
  const cid = newCorrelationId()
  const elapsed = startTimer()

  // AUTH FIRST — before the query is parsed and before the upstream search is issued. Anonymous,
  // this was a free relay onto the provider's search API under our API key/quota.
  const auth = await requireUser(request, { endpoint: 'search', cid })
  if (!auth.ok) return auth.response

  // `parseSearchQuery` trims and length-caps (the route had no cap of its own), so the outbound
  // URL stays bounded no matter what the client sends. An empty query is not an error: the UI
  // calls this on every keystroke and expects an empty result set, not a 400.
  const query = parseSearchQuery(request.nextUrl.searchParams.get('q'))
  if (!query) {
    return NextResponse.json({ results: [] })
  }

  const results = await searchTickers(query)
  obsInfo({ event: OBS.MARKET_API_REQUEST, cid, endpoint: 'search', status: 200, latency_ms: elapsed(), count: results.length })
  return NextResponse.json({ results })
}
