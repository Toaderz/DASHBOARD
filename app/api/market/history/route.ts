import { NextRequest, NextResponse } from 'next/server'
import { fetchHistoricalData, calculateReturn, fetchCalendarYearReturn } from '@/lib/market/history'
import { requireUser } from '@/lib/auth/require-user'
import { parseCalendarYear, parsePeriod, parseTickerList } from '@/lib/market/validation'
import { OBS, newCorrelationId, obsInfo, obsWarn, startTimer } from '@/lib/utils/obs'

/** Chart mode only: the period used when the caller sends none at all. */
const DEFAULT_CHART_PERIOD = '1Y' as const

export async function GET(request: NextRequest) {
  const cid = newCorrelationId()
  const elapsed = startTimer()

  // AUTH FIRST — before parsing and before any Yahoo request. `/api` is exempt from the middleware
  // gate, so without this the endpoint is an anonymous proxy onto Yahoo's chart API.
  const auth = await requireUser(request, { endpoint: 'history', cid })
  if (!auth.ok) return auth.response

  const { searchParams } = request.nextUrl
  const mode = searchParams.get('mode') // 'return' | 'calYear' | (default) chart

  // Ticker grammar is validated with the shared parser (max 1) rather than passed through raw, so
  // nothing outside the accepted symbol alphabet is ever interpolated into the outbound Yahoo URL.
  // `uppercase: false` preserves the caller's exact casing, as everywhere else.
  const { tickers } = parseTickerList(searchParams.get('ticker'), { max: 1, uppercase: false })
  const ticker = tickers[0]
  if (!ticker) {
    return NextResponse.json({ error: 'Missing or invalid ticker param' }, { status: 400 })
  }

  if (mode === 'calYear') {
    // `parseCalendarYear`, never `parseInt`: the latter accepted `'2024junk'` (→ 2024) and an
    // unbounded `999999999`, which produced a Yahoo request spanning ~1e9 years.
    const year = parseCalendarYear(searchParams.get('year'))
    if (year === null) {
      obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'history', reason: 'invalid_year' })
      return NextResponse.json({ error: 'Invalid year param' }, { status: 400 })
    }
    const { value } = await fetchCalendarYearReturn(ticker, year)
    obsInfo({ event: OBS.MARKET_API_REQUEST, cid, endpoint: 'history', status: 200, latency_ms: elapsed(), mode: 'calYear' })
    return NextResponse.json({ ticker, year, return: value })
  }

  if (mode === 'return') {
    const period = parsePeriod(searchParams.get('period'))
    if (!period) {
      obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'history', reason: 'invalid_period' })
      return NextResponse.json({ error: 'Invalid or missing period' }, { status: 400 })
    }

    const { value: returnValue, years } = await calculateReturn(ticker, period, 0)
    obsInfo({ event: OBS.MARKET_API_REQUEST, cid, endpoint: 'history', status: 200, latency_ms: elapsed(), mode: 'return', period })
    return NextResponse.json({ ticker, period, return: returnValue, years })
  }

  // Default mode: chart data.
  // A PRESENT-but-unknown period is now a 400. It used to fall through to '1Y' in silence, so a
  // typo'd or tampered period returned a full year of data labelled as whatever was asked for —
  // the caller could not tell the difference between "your period" and "a year we picked".
  // An ABSENT period keeps the documented default; that is not a malformed request.
  const rawPeriod = searchParams.get('period')
  const chartPeriod = rawPeriod === null ? DEFAULT_CHART_PERIOD : parsePeriod(rawPeriod)
  if (!chartPeriod) {
    obsWarn({ event: OBS.PARSE_ERROR, cid, endpoint: 'history', reason: 'invalid_period' })
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  const data = await fetchHistoricalData(ticker, chartPeriod)
  obsInfo({ event: OBS.MARKET_API_REQUEST, cid, endpoint: 'history', status: 200, latency_ms: elapsed(), mode: 'chart', period: chartPeriod, count: data.length })
  return NextResponse.json({ ticker, period: chartPeriod, data })
}
