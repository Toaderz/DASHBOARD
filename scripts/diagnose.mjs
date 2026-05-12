/**
 * Diagnóstico paso a paso — 3 capas:
 *   CAPA 1: ¿Yahoo Finance devuelve datos? (HTTP raw)
 *   CAPA 2: ¿Los paths JSON son correctos? (misma lógica que finnhub.ts)
 *   CAPA 3: ¿La API route /api/market/quote devuelve algo? (si el dev server está corriendo)
 *
 * Uso: node scripts/diagnose.mjs AAPL
 *      node scripts/diagnose.mjs SPY
 *      node scripts/diagnose.mjs ^GSPC
 *      node scripts/diagnose.mjs VFIAX
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const V8_BASE  = 'https://query1.finance.yahoo.com'
const V10_BASE = 'https://query2.finance.yahoo.com'

const ticker = process.argv[2]
if (!ticker) {
  console.error('Uso: node scripts/diagnose.mjs <TICKER>')
  process.exit(1)
}

const sep = (title) => console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`)
const ok  = (label, val) => console.log(`  ✅ ${label}: ${JSON.stringify(val)}`)
const bad = (label, val) => console.log(`  ❌ ${label}: ${JSON.stringify(val)}`)
const info = (label, val) => console.log(`  ℹ  ${label}: ${JSON.stringify(val)}`)

// ─── Helper idéntico al de finnhub.ts ────────────────────────────────────────
function getRaw(obj, path) {
  let cur = obj
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return null
    cur = cur[key]
  }
  if (cur == null) return null
  if (typeof cur === 'object' && 'raw' in cur) return cur.raw
  return typeof cur === 'number' ? cur : null
}

const pct = (v) => (v != null ? v * 100 : null)

// ════════════════════════════════════════════════════════════════════════════
// CAPA 1 — HTTP raw
// ════════════════════════════════════════════════════════════════════════════
sep(`CAPA 1 — HTTP Yahoo Finance v8 chart (precios) para ${ticker}`)
try {
  const url = `${V8_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d&includePrePost=false`
  info('URL', url)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  info('HTTP status', res.status)
  if (!res.ok) {
    bad('v8 chart', `HTTP ${res.status}`)
  } else {
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta) {
      bad('chart.result[0].meta', 'undefined — no data')
    } else {
      ok('regularMarketPrice', meta.regularMarketPrice)
      ok('regularMarketVolume', meta.regularMarketVolume)
      ok('fiftyTwoWeekHigh', meta.fiftyTwoWeekHigh)
      ok('fiftyTwoWeekLow', meta.fiftyTwoWeekLow)
      ok('chartPreviousClose', meta.chartPreviousClose)
    }
  }
} catch (err) {
  bad('v8 fetch', err.message)
}

sep(`CAPA 1 — HTTP Yahoo Finance v10 quoteSummary para ${ticker}`)
const modules = [
  'summaryDetail', 'defaultKeyStatistics', 'summaryProfile', 'assetProfile',
  'fundProfile', 'topHoldings', 'fundPerformance', 'price',
].join(',')

let rawData = null
try {
  const url = `${V10_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`
  info('URL', url)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  info('HTTP status', res.status)
  if (!res.ok) {
    bad('v10 quoteSummary', `HTTP ${res.status} — Yahoo puede estar bloqueando`)
    const body = await res.text()
    info('body (primeros 500 chars)', body.slice(0, 500))
  } else {
    const json = await res.json()
    rawData = json?.quoteSummary?.result?.[0]
    if (!rawData) {
      bad('quoteSummary.result[0]', 'undefined')
      info('quoteSummary raw', JSON.stringify(json?.quoteSummary).slice(0, 400))
    } else {
      ok('quoteSummary.result[0] existe', true)
      info('módulos presentes', Object.keys(rawData))
    }
  }
} catch (err) {
  bad('v10 fetch', err.message)
}

if (!rawData) {
  console.log('\n⛔  Sin datos de v10, no se puede continuar con capas 2 y 3.')
  process.exit(0)
}

// ════════════════════════════════════════════════════════════════════════════
// CAPA 2 — Paths JSON (misma lógica que fetchFundamentals en finnhub.ts)
// ════════════════════════════════════════════════════════════════════════════
sep(`CAPA 2 — Paths JSON para ${ticker}`)

const priceData     = rawData?.price ?? {}
const rawQuoteType  = ((priceData.quoteType ?? '') + '').toLowerCase()
info('quoteType detectado', rawQuoteType)

// ── Campos comunes ───────────────────────────────────────────────────────────
const pe            = getRaw(rawData, ['summaryDetail', 'trailingPE'])
const beta          = getRaw(rawData, ['defaultKeyStatistics', 'beta'])
const divRaw        = getRaw(rawData, ['summaryDetail', 'dividendYield']) ?? getRaw(rawData, ['summaryDetail', 'yield'])
const dividend_yield = pct(divRaw)
const marketCapRaw  = getRaw(rawData, ['defaultKeyStatistics', 'marketCap'])
                   ?? getRaw(rawData, ['summaryDetail', 'marketCap'])
const aumRaw        = getRaw(rawData, ['fundProfile', 'feesExpensesInvestment', 'totalNetAssets'])
                   ?? getRaw(rawData, ['defaultKeyStatistics', 'totalAssets'])
const navRaw        = getRaw(rawData, ['price', 'netAssetValue'])
                   ?? getRaw(rawData, ['summaryDetail', 'navPrice'])
const sectorVal     = rawData?.summaryProfile?.sector ?? rawData?.assetProfile?.sector ?? null
const industryVal   = rawData?.summaryProfile?.industry ?? rawData?.assetProfile?.industry ?? null
const profileData   = rawData?.fundProfile ?? {}
const fundFamilyVal = profileData.family ?? profileData.categoryName ?? null
const profitMargins = pct(getRaw(rawData, ['defaultKeyStatistics', 'profitMargins']))
const expenseRatio  = pct(getRaw(rawData, ['fundProfile', 'feesExpensesInvestment', 'annualReportExpenseRatio']))

// ── Risk stats (ETF/fund) ────────────────────────────────────────────────────
const riskStats = rawData?.fundPerformance?.riskOverviewStatistics?.riskStatistics?.[0] ?? {}
const alphaVal    = pct(getRaw(riskStats, ['alpha']))
const rSquaredVal = getRaw(riskStats, ['rSquared'])
const stdDevVal   = pct(getRaw(riskStats, ['stdDev']))
const sharpeVal   = getRaw(riskStats, ['sharpeRatio'])
const treynorVal  = getRaw(riskStats, ['treynorRatio'])

// ── Holdings / sector weights ────────────────────────────────────────────────
const holdingsData = rawData?.topHoldings ?? {}
const sectorWeightings = (holdingsData.sectorWeightings ?? [])
  .map((item) => { const [s, v] = Object.entries(item)[0]; return { sector: s, weight: v?.raw ?? 0 } })
  .filter((s) => s.weight > 0)
const topHoldings = (holdingsData.holdings ?? [])
  .map((h) => ({ symbol: h.symbol ?? null, name: h.holdingName ?? null, pct: h.holdingPercent?.raw != null ? h.holdingPercent.raw * 100 : null }))

// ── isFund? ──────────────────────────────────────────────────────────────────
const isFund = rawQuoteType === 'etf' || rawQuoteType === 'mutualfund'
  || aumRaw != null || (holdingsData.holdings?.length > 0)
info('isFund', isFund)

// ── Mostrar valores ──────────────────────────────────────────────────────────
;[
  ['pe (summaryDetail.trailingPE)', pe],
  ['beta (defaultKeyStatistics.beta)', beta],
  ['dividend_yield', dividend_yield],
  ['market_cap (defaultKeyStatistics.marketCap)', marketCapRaw],
  ['aum (fundProfile.feesExpensesInvestment.totalNetAssets)', aumRaw],
  ['nav', navRaw],
  ['sector (summaryProfile.sector)', sectorVal],
  ['industry (summaryProfile.industry)', industryVal],
  ['fund_family', fundFamilyVal],
  ['profit_margins', profitMargins],
  ['expense_ratio', expenseRatio],
  ['alpha', alphaVal],
  ['r_squared', rSquaredVal],
  ['std_dev', stdDevVal],
  ['sharpe', sharpeVal],
  ['treynor', treynorVal],
  ['sector_weightings count', sectorWeightings.length],
  ['top_holdings count', topHoldings.length],
].forEach(([label, val]) => {
  if (val !== null && val !== 0) ok(label, val)
  else bad(label, val)
})

// ── Dump raw de los módulos críticos ────────────────────────────────────────
sep('CAPA 2 — Raw módulos críticos (para verificar paths manualmente)')

for (const [modName, path] of [
  ['defaultKeyStatistics', ['defaultKeyStatistics']],
  ['summaryDetail (parcial)', ['summaryDetail']],
  ['fundProfile (parcial)', ['fundProfile']],
  ['price (parcial)', ['price']],
]) {
  let node = rawData
  for (const k of path) node = node?.[k]
  if (node) {
    console.log(`\n  ── ${modName} ──`)
    // Solo primeros 800 chars para no inundar la consola
    console.log(JSON.stringify(node, null, 2).slice(0, 800))
    if (JSON.stringify(node).length > 800) console.log('  ... (truncado)')
  } else {
    console.log(`\n  ── ${modName}: AUSENTE en la respuesta ──`)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CAPA 3 — API route /api/market/quote (requiere dev server corriendo)
// ════════════════════════════════════════════════════════════════════════════
sep(`CAPA 3 — API route GET /api/market/quote?tickers=${ticker}`)
console.log('  (requiere que el dev server esté corriendo en localhost:3000)\n')
try {
  const apiUrl = `http://localhost:3000/api/market/quote?tickers=${encodeURIComponent(ticker)}`
  info('URL', apiUrl)
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
  info('HTTP status', res.status)
  if (!res.ok) {
    bad('API route', `HTTP ${res.status}`)
    const txt = await res.text()
    info('body', txt.slice(0, 400))
  } else {
    const json = await res.json()
    const q = json?.[ticker.toUpperCase()] ?? json?.[ticker]
    if (!q) {
      bad('Ticker en respuesta', `no encontrado — keys: ${Object.keys(json)}`)
    } else {
      console.log('\n  Campos devueltos por la API route:')
      for (const [k, v] of Object.entries(q)) {
        if (v !== null && v !== undefined) ok(k, Array.isArray(v) ? `[${v.length} items]` : v)
        else bad(k, v)
      }
    }
  }
} catch (err) {
  if (err.name === 'TimeoutError' || err.code === 'ECONNREFUSED') {
    info('dev server', 'no está corriendo — omitiendo capa 3')
  } else {
    bad('API route fetch', err.message)
  }
}

console.log('\n')
