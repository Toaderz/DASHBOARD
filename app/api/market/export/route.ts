import { NextRequest, NextResponse } from 'next/server'
import { fetchHistoricalData, type PeriodKey } from '@/lib/market/history'

const VALID_PERIODS: PeriodKey[] = ['1W', '1M', '1Y', '3Y', '5Y', 'YTD', '10Y', 'MAX']

// GET /api/market/export?tickers=MSFT,AAPL,NVDA&period=5Y&format=csv
// Returns historical OHLCV data for multiple tickers as CSV or JSON
export async function GET(request: NextRequest) {
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

  const tickers = tickersParam
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 200) // cap to avoid abuse

  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const data = await fetchHistoricalData(ticker, period)
      return { ticker, data }
    })
  )

  const rows: Record<string, string>[] = []

  for (const result of results) {
    if (result.status === 'rejected') continue
    const { ticker, data } = result.value
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
