import { NextRequest, NextResponse } from 'next/server'
import { searchTickers } from '@/lib/market/finnhub'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query = searchParams.get('q')

  if (!query || query.length < 1) {
    return NextResponse.json({ results: [] })
  }

  const results = await searchTickers(query)
  return NextResponse.json({ results })
}
