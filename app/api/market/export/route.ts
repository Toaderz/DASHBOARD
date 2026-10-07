import { NextRequest, NextResponse } from 'next/server'
import { fetchHistoricalData, type PeriodKey } from '@/lib/market/history'
import { parseTickerList } from '@/lib/market/validation'
import { guardApi } from '@/lib/api/guard'
import { mapWithConcurrency } from '@/lib/utils/concurrency'

const VALID_PERIODS: PeriodKey[] = ['1W', '1M', '1Y', '3Y', '5Y', 'YTD', '10Y', 'MAX']

const MAX_TICKERS = 50
const FETCH_CONCURRENCY = 6
const LIMIT_PER_MIN = 10

// GET /api/market/export?tickers=MSFT,AAPL,NVDA&period=5Y&format=csv
// Returns historical OHLCV data for multiple tickers as CSV or JSON
export async function GET(request: NextRequest) {
  const guard = await guardApi('export', LIMIT_PER_MIN)
  if ('response' in guard) return guard.response

  const { searchParams } = request.nextUrl
  const tickersParam = searchParams.get('tickers')
  const period = (searchParams.get('period') ?? '5Y') as PeriodKey
  const format = searchParams.get('format') ?? 'csv'

  if (!tickersParam) {
    return NextResponse.json({ error: 'Missing tickers param (comma-separated)' }, { status: 400 })
  }

  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: `Invalid period. Valid: ${VALID_PERIODS.join(', ')}` }, { status: 400 })
  }

  const parsed = parseTickerList(tickersParam, MAX_TICKERS)
  if (parsed.tooMany) {
    return NextResponse.json({ error: `Too many tickers (max ${MAX_TICKERS})` }, { status: 400 })
  }
  if (parsed.tickers.length === 0) {
    return NextResponse.json({ error: 'No valid tickers' }, { status: 400 })
  }
  const tickers = parsed.tickers

  const results = await mapWithConcurrency(tickers, FETCH_CONCURRENCY, async (ticker) => {
    try {
      return { ticker, data: await fetchHistoricalData(ticker, period) }
    } catch {
      return null
    }
  })

  const rows: Record<string, string>[] = []

  for (const result of results) {
    if (!result) continue
    const { ticker, data } = result
    for (const point of data) {
      rows.push({
        ticker,
        date: point.date,
        open: point.open?.toFixed(4) ?? '',
        high: point.high?.toFixed(4) ?? '',
        low: point.low?.toFixed(4) ?? '',
        close: point.close?.toFixed(4) ?? '',
        volume: String(point.volume ?? ''),
      })
    }
  }

  if (format === 'json') {
    return NextResponse.json({ period, tickers, count: rows.length, data: rows })
  }

  // CSV output
  const header = 'ticker,date,open,high,low,close,volume\n'
  const body = rows.map((r) => `${r.ticker},${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`).join('\n')
  const csv = header + body

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="market_export_${period}_${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}
