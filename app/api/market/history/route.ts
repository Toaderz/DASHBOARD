import { NextRequest, NextResponse } from 'next/server'
import { fetchHistoricalData, calculateReturn, type PeriodKey } from '@/lib/market/history'

const VALID_PERIODS: PeriodKey[] = ['1W', '1M', '1Y', '3Y', '5Y', 'YTD', '10Y', 'MAX']

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const ticker = searchParams.get('ticker')
  const period = searchParams.get('period') as PeriodKey | null
  const currentPriceParam = searchParams.get('currentPrice')
  const mode = searchParams.get('mode') // 'return' | 'chart'

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker param' }, { status: 400 })
  }

  if (mode === 'return') {
    if (!period || !VALID_PERIODS.includes(period)) {
      return NextResponse.json({ error: 'Invalid or missing period' }, { status: 400 })
    }

    const { value: returnValue, years } = await calculateReturn(ticker, period, 0)
    return NextResponse.json({ ticker, period, return: returnValue, years })
  }

  // Default mode: chart data
  const chartPeriod: PeriodKey = (period && VALID_PERIODS.includes(period)) ? period : '1Y'
  const data = await fetchHistoricalData(ticker, chartPeriod)
  return NextResponse.json({ ticker, period: chartPeriod, data })
}
