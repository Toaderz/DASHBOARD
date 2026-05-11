/**
 * Diagnostic: inspect what Yahoo Finance returns for a ticker.
 * Usage: node scripts/inspect-asset.mjs <TICKER>
 * Example: node scripts/inspect-asset.mjs SPY
 *          node scripts/inspect-asset.mjs AAPL
 *          node scripts/inspect-asset.mjs ^GSPC
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const ticker = process.argv[2]
if (!ticker) {
  console.error('Usage: node scripts/inspect-asset.mjs <TICKER>')
  process.exit(1)
}

async function getAssetData(symbol) {
  const modules = [
    'defaultKeyStatistics',
    'fundProfile',
    'topHoldings',
    'summaryDetail',
    'price',
  ].join('%2C')

  const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`)

  const data = await res.json()
  const result = data?.quoteSummary?.result?.[0]
  if (!result) throw new Error(`No data returned for ${symbol}`)

  const stats   = result.defaultKeyStatistics ?? {}
  const profile = result.fundProfile ?? {}
  const fees    = profile.feesExpensesInvestment ?? {}
  const holdings = result.topHoldings ?? {}
  const summary = result.summaryDetail ?? {}
  const price   = result.price ?? {}

  const quoteType = price.quoteType?.toLowerCase() ?? 'unknown'

  // ── Common fields (all asset types) ─────────────────────────────────────────
  const common = {
    ticker:        symbol.toUpperCase(),
    quoteType,
    currency:      price.currency ?? null,
    price:         price.regularMarketPrice?.raw ?? null,
    change1d_pct:  price.regularMarketChangePercent?.raw != null
                     ? price.regularMarketChangePercent.raw * 100
                     : null,
  }

  // ── EQUITY ──────────────────────────────────────────────────────────────────
  if (quoteType === 'equity') {
    return {
      ...common,
      marketCap:     price.marketCap?.raw ?? null,
      trailingPE:    summary.trailingPE?.raw ?? null,
      forwardPE:     summary.forwardPE?.raw ?? null,
      beta:          stats.beta?.raw ?? null,
      profitMargins: stats.profitMargins?.raw ?? null,
      dividendYield: summary.dividendYield?.raw ?? null,
      high52w:       summary.fiftyTwoWeekHigh?.raw ?? null,
      low52w:        summary.fiftyTwoWeekLow?.raw ?? null,
    }
  }

  // ── ETF / MUTUALFUND ─────────────────────────────────────────────────────────
  if (quoteType === 'etf' || quoteType === 'mutualfund') {
    // sector weightings: list of { sectorName: { raw, fmt } }
    const sectorWeightings = (holdings.sectorWeightings ?? []).map((item) => {
      const [sector, val] = Object.entries(item)[0]
      return { sector, weight: val?.raw ?? null }
    })

    // top holdings: list of { symbol, holdingName, holdingPercent }
    const topHoldings = (holdings.holdings ?? []).map((h) => ({
      symbol:  h.symbol ?? null,
      name:    h.holdingName ?? null,
      pct:     h.holdingPercent?.raw ?? null,
    }))

    return {
      ...common,
      // AUM: totalAssets in defaultKeyStatistics, fallback netAssets
      aum:          stats.totalAssets?.raw ?? stats.netAssets?.raw ?? null,
      // expense_ratio is nested inside feesExpensesInvestment in fundProfile
      expenseRatio: fees.annualReportExpenseRatio?.raw ?? null,
      dividendYield: summary.dividendYield?.raw ?? null,
      yield:        summary.yield?.raw ?? null,
      high52w:      summary.fiftyTwoWeekHigh?.raw ?? null,
      low52w:       summary.fiftyTwoWeekLow?.raw ?? null,
      sectorWeightings,
      topHoldings,
    }
  }

  // ── INDEX ────────────────────────────────────────────────────────────────────
  if (quoteType === 'index') {
    return {
      ...common,
      high52w: summary.fiftyTwoWeekHigh?.raw ?? null,
      low52w:  summary.fiftyTwoWeekLow?.raw ?? null,
    }
  }

  // ── Fallback for CRYPTO, FUTURE, etc. ────────────────────────────────────────
  return {
    ...common,
    high52w: summary.fiftyTwoWeekHigh?.raw ?? null,
    low52w:  summary.fiftyTwoWeekLow?.raw ?? null,
  }
}

// ── Debug dump: show raw Yahoo response for expense_ratio path ────────────────
async function debugExpenseRatioPath(symbol) {
  const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=fundProfile`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) return
  const data = await res.json()
  const profile = data?.quoteSummary?.result?.[0]?.fundProfile
  if (!profile) return
  console.log('\n── Raw fundProfile keys ──────────────────────────────────────')
  console.log(JSON.stringify(profile, null, 2).slice(0, 2000))
}

// ── Run ───────────────────────────────────────────────────────────────────────
try {
  const result = await getAssetData(ticker)
  console.log(`\n── get_asset_data("${ticker}") ───────────────────────────────`)
  console.log(JSON.stringify(result, null, 2))

  // If fund, also dump raw fundProfile so you can see the exact key paths
  if (result.quoteType === 'etf' || result.quoteType === 'mutualfund') {
    await debugExpenseRatioPath(ticker)
  }
} catch (err) {
  console.error('Error:', err.message)
}
