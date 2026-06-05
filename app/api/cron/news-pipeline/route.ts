import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getTopTickers,
  getTickerCatalog,
  searchNews,
  rankCandidates,
  selectTop7,
  extractContent,
  analyzeAndSynthesize,
  selectFinalArticles,
} from '@/lib/ai/news-pipeline'
import {
  enrichAssetProfiles,
  loadUniverseAssets,
  matchAffectedSymbols,
  type UniverseAsset,
} from '@/lib/ai/asset-enrichment'
import { sourceAuthority } from '@/lib/ai/source-authority'
import type { AffectedSymbol } from '@/types'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Sanea la fecha del LLM: solo acepta YYYY-MM-DD (al inicio); cualquier otra cosa
// ("unknown", "May 28", "2026-05", "") → null. Una fecha basura rompe el INSERT
// atómico de timestamptz y tumba TODO el lote (brief sin noticias).
function toValidDate(d: string | null | undefined): string | null {
  if (!d || typeof d !== 'string') return null
  const m = d.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : null
}

function computeValidUntil(): Date {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun, 1=Mon, 5=Fri

  const next = new Date(now)
  next.setUTCHours(13, 0, 0, 0)

  if (day === 1) {
    // Monday → valid until next Friday 13:00 UTC
    next.setUTCDate(now.getUTCDate() + 4)
  } else if (day === 5) {
    // Friday → valid until next Monday 13:00 UTC
    next.setUTCDate(now.getUTCDate() + 3)
  } else {
    // Manual run → valid until tomorrow 13:00 UTC
    next.setUTCDate(now.getUTCDate() + 1)
  }

  return next
}

export async function POST(req: Request) {
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseAdmin = getAdminClient()

  const nowIso = new Date().toISOString()
  // Un run que excede maxDuration deja la fila en 'generating' para siempre y bloquea
  // todos los crons futuros. Tratamos como abandonado cualquier 'generating' de hace >15 min.
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString()

  console.log(`[news-cron] handler invoked at ${nowIso}`)

  // Auto-recuperación: marca 'failed' los 'generating' abandonados para que dejen de bloquear.
  const { data: recovered } = await supabaseAdmin
    .from('market_briefs')
    .update({ status: 'failed', metadata: { error: 'abandoned: stuck in generating >15min' } })
    .eq('status', 'generating')
    .lt('created_at', fifteenMinAgo)
    .select('id')
  if (recovered && recovered.length > 0) {
    console.log(`[news-cron] recovered ${recovered.length} abandoned 'generating' brief(s): ${recovered.map((r) => r.id).join(', ')}`)
  }

  // Anti-double-execution guard: bloquea solo si hay un 'generating' RECIENTE (<15 min)
  // o un 'ready' aún vigente (valid_until en el futuro).
  const { data: existing } = await supabaseAdmin
    .from('market_briefs')
    .select('id, status, valid_until, created_at')
    .or(`and(status.eq.generating,created_at.gt.${fifteenMinAgo}),and(status.eq.ready,valid_until.gt.${nowIso})`)
    .limit(1)

  if (existing && existing.length > 0) {
    const e = existing[0]
    const reason = e.status === 'generating'
      ? `Brief already generating (id=${e.id}, created_at=${e.created_at})`
      : `Brief still valid (id=${e.id}, valid_until=${e.valid_until})`
    console.log(`[news-cron] SKIP — ${reason}`)
    return NextResponse.json({ skipped: true, reason })
  }

  console.log('[news-cron] guard clear — proceeding to generate new brief')

  const now = new Date()
  const periodStart = new Date(now)
  periodStart.setUTCDate(now.getUTCDate() - 7)
  const validUntil = computeValidUntil()
  console.log(`[news-cron] new brief valid_until=${validUntil.toISOString()}`)

  const { data: brief, error: insertError } = await supabaseAdmin
    .from('market_briefs')
    .insert({
      status: 'generating',
      period_start: periodStart.toISOString().split('T')[0],
      period_end: now.toISOString().split('T')[0],
      valid_until: validUntil.toISOString(),
    })
    .select()
    .single()

  if (insertError || !brief) {
    return NextResponse.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  try {
    // Fase A — enriquece (una vez, cacheado) los activos del universo que aún no tienen perfil.
    // Resiliente: cualquier fallo se loguea internamente y NO rompe el pipeline.
    await enrichAssetProfiles(supabaseAdmin)

    const tickers = await getTopTickers(supabaseAdmin)
    const tickerCatalog = await getTickerCatalog(supabaseAdmin, tickers)
    const rawArticles = await searchNews(tickers)

    // Universo (unión de todos los activos de cualquier watchlist, sin índices) para el matching.
    const universe: UniverseAsset[] = await loadUniverseAssets(supabaseAdmin)

    // Pre-ranking determinista: autoridad de fuente + recencia + Tavily + empujón si el snippet
    // ya cruza el portafolio (para que esas noticias no se caigan del set de candidatos).
    const relevantUrls = new Set(
      rawArticles
        .filter((a) => matchAffectedSymbols(`${a.title}\n${a.content}`, universe).length > 0)
        .map((a) => a.url)
    )
    const ranked = rankCandidates(rawArticles, relevantUrls)

    const topUrls = await selectTop7(ranked)
    const topArticles = ranked.filter((a) => topUrls.includes(a.url))
    const contentMap = await extractContent(topUrls)
    const result = await analyzeAndSynthesize(topArticles, contentMap, tickers, tickerCatalog)

    // Fase B — matching DETERMINISTA definitivo por noticia (sobre el cuerpo extraído completo).
    const rawByUrl = new Map(rawArticles.map((a) => [a.url, a]))
    const affectedByUrl = new Map<string, AffectedSymbol[]>()
    for (const article of result.articles) {
      const fullText = contentMap.get(article.source_url) ?? rawByUrl.get(article.source_url)?.content ?? ''
      affectedByUrl.set(article.source_url, matchAffectedSymbols(`${article.title}\n${fullText}`, universe))
    }

    // Conteo variable 3–7 + garantía de inclusión por portafolio (tope 7), calidad sobre cantidad.
    const finalArticles = selectFinalArticles(
      result.articles,
      (a) => (affectedByUrl.get(a.source_url)?.length ?? 0) > 0
    )

    const newsRows = finalArticles.map((article) => {
      const fullText = contentMap.get(article.source_url) ?? null
      const affected = affectedByUrl.get(article.source_url) ?? []
      return {
        brief_id: brief.id,
        rank: article.rank,
        title: article.title,
        summary: article.summary,
        insight: article.insight,
        full_text_md: fullText,
        source_url: article.source_url,
        source_name: article.source_name,
        published_at: toValidDate(article.date),
        affected_tickers: affected.map((s) => s.ticker),
        affected_symbols: affected,
        relevance_source: affected.length
          ? affected.map((s) => `${s.ticker}:${s.source}`).join(', ')
          : null,
        source_authority: sourceAuthority(article.source_url),
        score: article.score,
        rating: article.rating,
        signal: article.signal,
        actionability: article.actionability ?? null,
        score_breakdown: article.score_breakdown,
      }
    })

    const { error: newsError } = await supabaseAdmin.from('market_news').insert(newsRows)
    // No marcar el brief 'ready' con conteos fantasma si el insert falló: lanza para que
    // el catch lo marque 'failed' con el error real (antes fallaba en silencio → brief vacío).
    if (newsError) {
      throw new Error(`Insert de market_news falló (${newsRows.length} filas): ${newsError.message}`)
    }

    // Recalcula los conteos de señal desde los artículos REALMENTE incluidos (consistencia con la UI).
    const strong = finalArticles.filter((a) => a.signal === 'STRONG').length
    const moderate = finalArticles.filter((a) => a.signal === 'MODERATE').length
    const weak = finalArticles.filter((a) => a.signal === 'WEAK').length

    await supabaseAdmin
      .from('market_briefs')
      .update({
        status: 'ready',
        context_md: result.weekly_summary.context_md,
        strong_signals: strong,
        moderate_signals: moderate,
        weak_noise: weak,
        top_theme: result.weekly_summary.top_theme,
        key_risk: result.weekly_summary.key_risk,
        metadata: {
          editorial_stance: result.weekly_summary.editorial_stance ?? null,
          watchlist_items: result.weekly_summary.watchlist_items ?? [],
        },
      })
      .eq('id', brief.id)

    console.log(`[news-cron] SUCCESS — brief ${brief.id} ready (${finalArticles.length} articles)`)
    return NextResponse.json({ success: true, briefId: brief.id })
  } catch (error) {
    console.error(`[news-cron] FAILED — brief ${brief.id}:`, error)
    await supabaseAdmin
      .from('market_briefs')
      .update({ status: 'failed', metadata: { error: String(error) } })
      .eq('id', brief.id)

    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
