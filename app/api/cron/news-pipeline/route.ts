import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getTopTickers,
  searchNews,
  selectTop7,
  extractContent,
  analyzeAndSynthesize,
} from '@/lib/ai/news-pipeline'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
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

  // Anti-double-execution guard
  const { data: existing } = await supabaseAdmin
    .from('market_briefs')
    .select('id, status, valid_until')
    .or(`status.eq.generating,and(status.eq.ready,valid_until.gt.${new Date().toISOString()})`)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ skipped: true, reason: 'Brief already generating or still valid' })
  }

  const now = new Date()
  const periodStart = new Date(now)
  periodStart.setUTCDate(now.getUTCDate() - 7)
  const validUntil = computeValidUntil()

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
    const tickers = await getTopTickers(supabaseAdmin)
    const rawArticles = await searchNews(tickers)
    const topUrls = await selectTop7(rawArticles)
    const topArticles = rawArticles.filter((a) => topUrls.includes(a.url))
    const contentMap = await extractContent(topUrls)
    const result = await analyzeAndSynthesize(topArticles, contentMap, tickers)

    const newsRows = result.articles.map((article) => ({
      brief_id: brief.id,
      rank: article.rank,
      title: article.title,
      summary: article.summary,
      insight: article.insight,
      full_text_md: contentMap.get(article.source_url) ?? null,
      source_url: article.source_url,
      source_name: article.source_name,
      published_at: article.date ? article.date : null,
      affected_tickers: article.affected_tickers ?? [],
      score: article.score,
      rating: article.rating,
      signal: article.signal,
      actionability: article.actionability ?? null,
      score_breakdown: article.score_breakdown,
    }))

    await supabaseAdmin.from('market_news').insert(newsRows)

    await supabaseAdmin
      .from('market_briefs')
      .update({
        status: 'ready',
        context_md: result.weekly_summary.context_md,
        strong_signals: result.weekly_summary.strong_signals,
        moderate_signals: result.weekly_summary.moderate_signals,
        weak_noise: result.weekly_summary.weak_noise,
        top_theme: result.weekly_summary.top_theme,
        key_risk: result.weekly_summary.key_risk,
        metadata: {
          editorial_stance: result.weekly_summary.editorial_stance ?? null,
          watchlist_items: result.weekly_summary.watchlist_items ?? [],
        },
      })
      .eq('id', brief.id)

    return NextResponse.json({ success: true, briefId: brief.id })
  } catch (error) {
    await supabaseAdmin
      .from('market_briefs')
      .update({ status: 'failed', metadata: { error: String(error) } })
      .eq('id', brief.id)

    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
