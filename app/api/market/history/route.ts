import { NextRequest, NextResponse } from 'next/server'
import { fetchHistoricalData, calculateReturn, fetchCalendarYearReturn, type PeriodKey } from '@/lib/market/history'
import { normalizeTicker, parseYear } from '@/lib/market/validation'
import { guardApi } from '@/lib/api/guard'

const VALID_PERIODS: PeriodKey[] = ['1W', '1M', '6M', '1Y', '3Y', '5Y', 'YTD', '10Y', 'MAX']

// useTopPerformers pide ticker × período en ráfaga (cientos de peticiones): el límite es una
// barrera de contención, no un control fino.
const LIMIT_PER_MIN = 3000

export async function GET(request: NextRequest) {
  const guard = await guardApi('history', LIMIT_PER_MIN)
  if ('response' in guard) return guard.response

  const { searchParams } = request.nextUrl
  const rawTicker = searchParams.get('ticker')
  const period = searchParams.get('period') as PeriodKey | null
  const mode = searchParams.get('mode') // 'return' | 'chart' | 'calYear'

  if (!rawTicker) {
    return NextResponse.json({ error: 'Missing ticker param' }, { status: 400 })
  }
  const ticker = normalizeTicker(rawTicker)
  if (!ticker) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })
  }

  if (mode === 'calYear') {
    const year = parseYear(searchParams.get('year'))
    if (year == null) {
      return NextResponse.json({ error: 'Invalid year param' }, { status: 400 })
    }
    const { value } = await fetchCalendarYearReturn(ticker, year)
    return NextResponse.json({ ticker, year, return: value })
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
