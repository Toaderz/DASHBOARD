# Evolve Dashboard — Claude Code Instructions

## Proyecto
Dashboard financiero multiusuario SaaS. Next.js 16 App Router, Supabase (auth + DB + RLS), Yahoo Finance (precios en tiempo real + fundamentals sin API key). Deploy en Vercel y Netlify.

## Reglas
- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- ALWAYS read a file before editing it
- Keep files under 500 lines
- NEVER commit secrets, credentials, or .env files

## Stack completo
- **Framework**: Next.js 16.2.5 — `dev` usa Turbopack, `build` usa Webpack (`next build --webpack`)
- **UI**: React 19, TypeScript, Tailwind CSS + shadcn/ui (Radix UI primitives)
- **Tabla**: TanStack Table v8
- **Data fetching**: TanStack Query v5 (`refetchInterval: 5000` para precios)
- **Auth + DB**: Supabase (`@supabase/ssr` v0.6 para SSR con cookies)
- **Precios**: Yahoo Finance v8 REST (`https://query1.finance.yahoo.com/v8/finance/chart/`) — sin API key
- **Fundamentals**: `yahoo-finance2` v3 (maneja crumb/cookies de Yahoo Finance automáticamente)
- **Históricos**: Yahoo Finance v8 REST — sin API key
- **Animaciones**: Framer Motion (`motion`, `useSpring`, `AnimatePresence`)
- **Charts**: Recharts (en `AssetDetailModal`)
- **PWA**: Serwist (`@serwist/next` v9) — service worker en `app/sw.ts`, deshabilitado en dev
- **Temas**: `next-themes`, `defaultTheme: 'dark'`
- **Fuentes**: Space Grotesk (`--font-display`, editorial/headlines/números-héroe; clases `.font-editorial`/`.font-display`/`font-display`), Plus Jakarta Sans (`--font-ui`, UI/body), JetBrains Mono (`--font-mono`, datos tabulares). Cargadas vía `next/font/google` en `app/layout.tsx`.
- **Iconos**: Lucide React

## Convenciones importantes

### Next.js 16 — middleware
El archivo de protección de rutas se llama `proxy.ts` (NO `middleware.ts`). La función exportada se llama `proxy` (NO `middleware`). Esto es un cambio de Next.js 16.

### Supabase — tipos de cookies
En `lib/supabase/middleware.ts` y `lib/supabase/server.ts` NO usar `CookieMethodsServer['setAll']` porque es opcional y `Parameters<>` falla. Usar el tipo explícito:
```typescript
type CookiesToSet = Array<{ name: string; value: string; options?: Record<string, unknown> }>
```

### Supabase — cliente admin en API routes
El `createClient` de supabase-js NO debe llamarse a nivel de módulo en API routes. Siempre dentro de una función factory llamada dentro del handler:
```typescript
function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
```

### RLS (Row Level Security)
| Tabla | Política |
|---|---|
| `profiles` | Solo el propio usuario (select/insert/update) + `authenticated_read_profiles` (cualquier autenticado puede SELECT para share dialog) |
| `watchlists` | Solo el propio usuario (`user_id = auth.uid()`) + `shared_read_watchlists` (destinatarios de shares pueden SELECT) |
| `watchlist_assets` | Via join con watchlists del usuario + `shared_read_assets` (destinatarios pueden SELECT) |
| `watchlist_shares` | `owner_manage_shares` (dueño gestiona) + `recipient_view_shares` (destinatario puede SELECT) |
| `assets_metadata` | SELECT público + INSERT para usuarios autenticados |
| `price_cache` | SELECT público, escritura solo vía service role |
| `user_asset_peers` | Solo el propio usuario (`user_id = auth.uid()`, `for all`) — set de peers curado |
| `returns_cache` | SELECT público, escritura solo vía service role |

### Columnas de schema añadidas (migraciones)
```sql
-- watchlist_assets: distingue holdings del usuario de auto-peers del motor
ALTER TABLE watchlist_assets ADD COLUMN source text NOT NULL DEFAULT 'user'
  CHECK (source IN ('user','auto-peer'));
ALTER TABLE watchlist_assets ADD COLUMN peer_of text;   -- ticker base; NULL si 'user'

-- user_asset_peers: curación no destructiva
ALTER TABLE user_asset_peers ADD COLUMN auto_peers text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_asset_peers ADD COLUMN removed    text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_asset_peers ADD COLUMN pinned     text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_asset_peers ADD COLUMN engine_version int NOT NULL DEFAULT 0;

-- price_cache: país de acciones para scoring
ALTER TABLE price_cache ADD COLUMN country text;

-- profiles: estado de onboarding
ALTER TABLE profiles ADD COLUMN onboarding_seen boolean NOT NULL DEFAULT false;

-- profiles: pertenencia a Team Evolve (compartir watchlist con todo el equipo)
ALTER TABLE profiles ADD COLUMN is_team_evolve boolean NOT NULL DEFAULT false;
```
`peers` efectivo = `(auto_peers ∪ pinned) − removed`. Se recalcula y persiste en cada materialización.

### Filtro `source='user'` — CRÍTICO
Los siguientes consumidores DEBEN filtrar `source='user'` para que los auto-peers del motor NO contaminen resultados ni el pipeline de IA:
- `hooks/useTopPerformers.ts` (`useAllWatchlistTickers`) — `.eq('source','user')`
- `lib/ai/asset-enrichment.ts` y `lib/ai/news-pipeline.ts` — `.eq('source','user')`
- RPC `get_top_tickers` en DB — incluye `WHERE source='user'`

### Flash animation de precios
`useRealtimePrices` compara precio anterior con `useRef`, setea `'up'|'down'` en `flashStates`, se limpia a los 1.5s. Las clases CSS `animate-flash-green` y `animate-flash-red` están definidas en `tailwind.config.ts`.

### AnimatedPrice vs PriceCell
- `AnimatedPrice` — Framer Motion `AnimatePresence`, desliza el número hacia arriba/abajo al cambiar. Para el modal y vistas destacadas.
- `PriceCell` — celda de tabla TanStack, usa flash CSS directo (más ligero). Para la tabla principal.

### yahoo-finance2 v3
- Constructor: `const yf = new YahooFinanceLib({ suppressNotices: [...], validation: { logErrors: false } })`
- `validateResult: false` en `quoteSummary()`: Yahoo devuelve `fundProfile.brokerages` como array de strings (no objetos), rompiendo la validación del schema.
- ETFs/fondos: `beta3Year` (no `beta`), `summaryDetail.yield` (no `dividendYield`), `defaultKeyStatistics.totalAssets` para AUM.
- Stocks: `summaryDetail.marketCap` (no `defaultKeyStatistics.marketCap` — ese campo no existe en v3 para equities).
- **Unidades de los campos — CRÍTICO (no aplicar ×100 a ciegas):** `summaryDetail.yield`/`.dividendYield`, `defaultKeyStatistics.profitMargins`, `fundProfile.feesExpensesInvestment.annualReportExpenseRatio` y `topHoldings.holdings[].holdingPercent`/`sectorWeightings[]` vienen como **decimales** (0.0093 = 0.93%) → sí llevan `pct(v)=v*100`. PERO `fundPerformance.riskOverviewStatistics.riskStatistics[0].stdDev` viene **ya en puntos %** (18.09 = 18.09%) → NO lleva `pct()` (un ×100 erróneo daba 1809%). `alpha`/`sharpeRatio`/`treynorRatio` se muestran tal cual (ratios). Verificado contra Yahoo en RDVY/SDVY/VIG.
- **Inception date:** la fecha real está en `defaultKeyStatistics.fundInceptionDate` (Date ya parseado); `fundProfile.inceptionDate` viene `undefined` para ETFs. `fetchFundamentals` lee el primero con fallback al segundo (antes solo leía `fundProfile` → la fila Inception siempre salía "—").
- **Retornos del modal Comparar son cálculo PROPIO (no campos de Yahoo):** `deriveTrailing`/`deriveAnnual` (en `useEtfComparison.ts`) los computan sobre una serie diaria de `adjclose` (total return) de Yahoo v8. Difieren a propósito de `fundPerformance.trailingReturns` porque (1) trailing 3Y/5Y se muestran **acumulados** (sección rotulada "Retornos acumulados"), no anualizados como Yahoo (CAGR); (2) los `trailingReturns` de Yahoo son snapshots a **fin de mes**, los nuestros son en vivo. Los **retornos por año calendario** (`deriveAnnual`) SÍ matchean `annualTotalReturns` de Yahoo a ≤0.02pp.
- `serverExternalPackages: ['yahoo-finance2']` en `next.config.ts`: evita que webpack bundlee el paquete (tiene imports de test que fallan en build).

## Estructura de archivos clave
```
proxy.ts                           # Protección de rutas (Next.js 16) — NO es middleware.ts
app/
  layout.tsx                       # Root layout — fuentes, ThemeProvider, QueryProvider
  globals.css                      # Variables CSS (ink, electric, gain, loss, chart-1..8, brand, shadows, radii)
  manifest.ts                      # PWA manifest
  sw.ts                            # Service worker (Serwist)
  (auth)/
    login/page.tsx                 # Login + registro dual-mode — "Transforming Investments": wrapper .theme-dark (always-dark), MarketDepthField de fondo (FIXED), hero EvolveLogo3D + slogan, card glass STICKY siempre accesible, narrativa scroll (4 escenas en components/auth/scenes/); auth logic intacta
  (dashboard)/
    layout.tsx                     # Server — verifica auth + onboarding_seen, envuelve en TourProvider
    page.tsx                       # Overview agregado (OverviewDashboard) — ya NO redirige a watchlist
    top10/page.tsx                 # Vista top 10 performers (wrapper de TopPerformers)
    bottom10/page.tsx              # Vista bottom 10 performers (wrapper de BottomPerformers)
    vs-peers/page.tsx              # Vista Beating Peers (wrapper de PeerComparison)
    news/page.tsx                  # Brief de mercado (wrapper de NewsBlock)
    etf-compare/page.tsx           # Comparador de activos lado a lado (wrapper de EtfCompare)
    watchlist/[id]/page.tsx        # Server — carga watchlist + assets por ID
  api/
    market/
      quote/route.ts               # Precios + fundamentals; cache en price_cache (TTL 60s / 24h); backfill de assets_metadata con name+type desde Yahoo (ignoreDuplicates → nunca pisa nombres curados); sirve a peers STATIC que no están en watchlist
      history/route.ts             # Yahoo Finance v8 históricos + FX period returns + mode=calYear (año calendario)
      returns/route.ts             # POST batch — retornos multi-periodo (1W/1M/6M/YTD/1Y) + caché returns_cache (TTL 6h); fallback a último-bueno si el fetch fresco vuelve degradado
      search/route.ts              # Búsqueda de tickers (Finnhub)
      export/route.ts              # Export de watchlist a CSV
    peers/
      init/route.ts                # POST — materializa (determinista) el set inicial de peers por usuario/activo
    news/
      current/route.ts             # GET — brief vigente (o último como stale) + market_news (auth)
    cron/
      news-pipeline/route.ts       # POST (Bearer CRON_SECRET) — trigger HTTP manual/respaldo; llama runNewsPipeline() (el automático es GitHub Actions vía scripts/run-news-pipeline.ts)
    users/
      find/route.ts                # GET ?email= — resuelve email → user_id (service role)
components/
  providers.tsx                    # QueryClient + ThemeProvider + ToastProvider (wrapper raíz)
  brand/
    EvolveMark.tsx                 # Marca viva (nodos ascendentes): sidebar idle + motivo de EmptyState + EvolveLoader (loop). YA NO se usa en el login (lo reemplazó EvolveLogo3D)
    EvolveLogo3D.tsx               # Hero del login: logo OFICIAL circle-"e" (anillo + círculo interior con slash) extruido en CSS 3D (≈16 capas en Z) girando en turntable inclinado + light-sweep; sin dep. Reduced-motion → frame estático 3/4; pausa rotación en tab oculto
  auth/
    MarketDepthField.tsx           # Fondo del login en Canvas 2D nativo (sin dep): barras de "profundidad de mercado" divergiendo de una baseline de retornos (gain/loss baja saturación), respiran lento; bajo el cursor crecen + se iluminan a teal. Reemplazó a IntelligenceField (constelación). 1 rAF, pausa en visibilitychange/oculto, frame estático en reduced-motion, dpr ≤2
    scenes/                        # Escenas presentacionales de la narrativa del login (datos scripted, SIN hooks/red): NarrativeScene (shell eyebrow+título+reveal whileInView), LivePricesScene (filas mock con flash + LiveIndicator), PeersScene (barras won/lost), CompareScene (curvas growth-$10k), IntelligenceScene ("Inteligencia de mercado" — señal vs ruido, sin terminología "AI/brief")
  onboarding/
    TourProvider.tsx               # Context: running/stepIndex, start/next/prev/skip/finish; auto-start-once (onboarding_seen + localStorage)
    TourSpotlight.tsx              # Overlay con cutout getBoundingClientRect + Card tooltip; Escape/resize/motion
  dashboard/
    DashboardShell.tsx             # Layout principal: sidebar (EvolveMark + disparador ⌘K) + nav + PriceMarquee + CommandPalette montado; header móvil con icono de búsqueda (data-tour attrs)
    CommandPalette.tsx             # Buscador global ⌘K/Ctrl+K (controlado): navega 6 páginas + busca tickers (/api/market/search, debounce 300ms) → /etf-compare?tickers=X; teclado; modal glass
    LiveIndicator.tsx              # Pill "● Live" (o bare dot) con halo animate-ping + dot bg-signal — único componente "Live" (Overview/MarketSnapshot, NewsBlock)
    OverviewDashboard.tsx          # Dashboard agregado: KPIs, MarketSnapshot, mini-leaderboards, brief teaser
    WatchlistView.tsx              # Bridge server→client: recibe props del server, renderiza tabla
    WatchlistTable.tsx             # TanStack Table: columnas (incl. 6M), filtro inline, sort, modal, toggle auto-peers
    WatchlistManager.tsx           # CRUD watchlists + share dialog en sidebar (data-tour attrs añadidos)
    AssetDetailModal.tsx           # Modal con Tabs: Summary (AreaChart) · Calendar Years (BarChart) · Peers
    FundamentalsPanel.tsx          # Panel premium bento: métricas animadas con NumberTicker (importado)
    NumberTicker.tsx               # Contador animado Framer Motion (extraído de FundamentalsPanel)
    SegmentedControl.tsx           # Selector pill multi-opción (rounded-pill, size sm/md)
    PageHeader.tsx                 # Cabecera de página: título editorial + descripción + icon + actions slot + eyebrow/accent ('signal'|'gain'|'loss'|'mist') para identidad por vista
    EmptyState.tsx                 # Estado vacío: icono (o EvolveMark si no se pasa icono), título, descripción, CTA, variante compact
    StatCard.tsx                   # Tarjeta de KPI: label, value, delta, sub, icon, hint (Tooltip)
    PriceCell.tsx                  # Celda tabla con flash CSS verde/rojo
    AnimatedPrice.tsx              # Precio animado con Framer Motion (slide up/down)
    PriceMarquee.tsx               # Ticker marquee header (tickers globales fijos de BENCHMARK_TICKERS)
    MetricsSelector.tsx            # Popover de columnas: toggle (checkbox), reordenar visibles con flechas ↑↓ (mueve por KEY, no por índice de render), "Sort by time" (orden cronológico) y add cronológico (cada métrica entra en su lugar temporal); auto-repara selected_metrics (descarta keys inválidas/duplicadas). Persiste en JSONB watchlists
    TickerSearch.tsx               # Búsqueda con debounce 300ms; usa typeBadgeClass/typeLabel de asset-style
    TopPerformers.tsx              # Vista top 10 performers — PageHeader + SegmentedControl + Card
    BottomPerformers.tsx           # Vista bottom 10 performers — PageHeader + SegmentedControl + Card
    PeerComparison.tsx             # Vista Beating Peers: PageHeader + toolbar (filtro ≥N/6 + buscador) + lista ordenada
    PeerCard.tsx                   # Tarjeta por activo: won/lost/insufficient + filas por periodo; denominador = peers asignados. Header: fondos (type='fund') muestran solo nombre (sin ISIN/ticker críptico); ETFs y stocks muestran ticker + nombre real (backfilled). Panel expandido (motion): retorno USD del activo + cada peer, delta pp, ✓/✗ 1-a-1, mini-barra de contexto; fondos ocultan columna ticker en filas expandidas (hideTicker=true si type='fund')
    NewsBlock.tsx                  # Brief de mercado: PageHeader + WeeklyBriefCard + grid de NewsCard
    WeeklyBriefCard.tsx            # Resumen semanal: tema/riesgo, conteos de señal, qué vigilar
    NewsCard.tsx                   # Tarjeta de noticia: señal/rating, badge 🎯, análisis, artículo completo
    ThemeToggle.tsx                # Toggle dark/light mode
    PageTransition.tsx             # V2 — cross-fade de ruta dentro de <main> (AnimatePresence keyed por pathname; reduced→passthrough)
    AssetMonogram.tsx              # V2 — chip de monograma bone neutro único (MONO_STYLE; sin hash arcoíris)
    SpotlightCard.tsx              # V2 — Card con .gradient-border + spotlight bone
    etf-compare/                   # Módulo Comparar (inspirado en ETF.com, recoloreado a V2)
      EtfCompare.tsx               # Orquesta URL state + type-lock por grupo + tabs (Overview/Performance/Holdings/Risk&Dividends); tab visible solo si ≥1 activo tiene su dato
      CompareTickerBar.tsx         # Chips de activos + TickerSearch (deshabilita otros grupos) + Reset
      CompareHero.tsx              # Banda héroe: tickers grandes + nombre + precio live
      CompareMetricsTable.tsx      # Tabla transpuesta (filas=métricas, cols=activos) + toggle "Resaltar diferencias" (énfasis bone/font-semibold por dirección, NO teal)
      CompareGrowthChart.tsx       # LineChart "Crecimiento de $10,000" (rebase a 10k + merge por fecha); usa compareSeriesColor(i)
      CompareAnnualReturns.tsx     # BarChart agrupado por año calendario (deriveAnnual); compareSeriesColor(i)
      CompareHoldings.tsx          # Donut top-10 por activo (seriesColor — slices intra-fondo) + SectorBars agrupadas (compareSeriesColor)
      compare-utils.ts             # compareSeriesColor() (permutación [0,4,2,6,1,3,5,7] de --chart-1..8 para máximo contraste sin tocar la rampa) + compatGroup/groupLockReason/instrumentToType
  ui/
    card.tsx                       # Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
    tabs.tsx                       # Tabs in-house (sin @radix-ui/react-tabs): teclado ArrowLeft/Right/Home/End
    tooltip.tsx                    # Tooltip sobre Radix Popover (sin @radix-ui/react-tooltip); hover+focus
    toast.tsx                      # ToastProvider + useToast(): cola con auto-dismiss, aria-live, cards glass (AnimatePresence), variantes success/error/info
    skeleton.tsx                   # Skeleton con shimmer (gradiente que recorre, animate-shimmer, motion-reduce:hidden)
                                   # shadcn/ui: badge, button, checkbox, dialog, input, label, popover
hooks/
  useWatchlistAssets.ts            # useWatchlists + useWatchlistAssets (incluye source/peer_of) + useWatchlistShares
  useRealtimePrices.ts             # Polling 5s + flashStates (useRef para prev prices)
  usePerformanceMetrics.ts         # Cálculo retornos históricos (1D→MAX)
  useFxData.ts                     # FX spot rates (1-min) + period returns (5-min)
  useTopPerformers.ts              # useAllWatchlistTickers (.eq source=user) + rankings top/bottom; anualiza con años NOMINALES fijos (NOMINAL_YEARS) → orden estable
  usePeerComparison.ts             # Beating Peers: won/lost/insufficient gate settled; no-USD sin FX → null; PeriodResult.assigned = peers asignados (denominador constante); PeriodResult.peerReturns (ticker→USD por periodo) + AssetComparison.peerNames/peerTypes (query a assets_metadata, no bloquea settled); nombre/tipo de peers vía cadena assets_metadata→quote en vivo→ticker; instrumentToType() mapea Yahoo instrument_type→AssetType
  usePeerSet.ts                    # add→pinned, remove→removed+borra fila; STATIC_PEERS nunca se recomputa
  useCalendarYearReturns.ts        # Retornos por año calendario (CY2019..actual); mode=calYear, staleTime 6h
  useNewsBrief.ts                  # GET /api/news/current — brief vigente + market_news
  useCompareTickers.ts             # Estado de tickers del comparador en la URL (?tickers=); add/remove/reset, uppercase/dedup, cap MAX_COMPARE_TICKERS
  useEtfComparison.ts              # Orquesta useRealtimePrices(quotes/fundamentals) + useQueries(N series 5Y con cola de concurrencia ≤4); deriveTrailing (1M/6M/YTD/1Y/3Y/5Y ACUMULADO desde adjclose) + deriveAnnual (año calendario, matchea Yahoo annualTotalReturns)
lib/
  ai/
    news-pipeline.ts               # Pipeline de noticias: searchNews→rankCandidates (cuotas por categoría)→selectTop7→extractContent→analyzeAndSynthesize (+core_event_tag)→selectFinalArticles (dedup dura por evento). normalizeEventTag = clave de agrupación canónica
    asset-enrichment.ts            # Relevancia determinista: enrichAssetProfiles (Fase A) + matchAffectedSymbols (Fase B)
    article-clean.ts               # Limpieza determinista del full_text_md
    llm.ts                         # callLLM provider-agnostic (cadena Gemini→Groq→Cerebras) + extractJson robusto
    source-authority.ts            # Mapa dominio→autoridad (0..1) para pre-ranking determinista
  supabase/
    client.ts                      # Browser Supabase client (createBrowserClient)
    server.ts                      # Server Supabase client (cookies async)
    middleware.ts                  # updateSession — refresca tokens en cada request
  market/
    finnhub.ts                     # Finnhub API client (search + quote fallback + campo country para acciones)
    history.ts                     # Yahoo Finance v8 históricos + calculateReturn + calculateMultiReturns; fetchHistoricalData reintenta 429/5xx/cuerpo vacío (3 intentos, backoff)
    peer-taxonomy.ts               # STATIC_PEERS + computeInitialPeers() + scoring Morningstar + tie-breaker estable
    morningstar-categories.ts      # MS_GLOBAL_CATEGORY + MS→clasificación; compartido finnhub/peer-taxonomy
    benchmarks.ts                  # BENCHMARK_TICKERS + BENCHMARK_LABELS (marquee y Overview)
  chart-theme.ts                   # useChartTheme() reactivo a resolvedTheme; CHART_SERIES (navy→teal), SEMANTIC, chartTooltipStyle (V2: FALLBACK neutrales warm)
  asset-style.ts                   # TYPE_BADGE (mapa por AssetType), typeBadgeClass(), typeLabel() — fuente única de badges (V2: stock/etf/fund → bone neutro; index/crypto mantienen ámbar/naranja)
  motion-tokens.ts                 # V2 — constantes PURAS (sin 'use client'): EASE_OUT, DUR, SPRING_*, STAGGER, variants fadeUp/staggerContainer, assetLayoutId(t), morphTransition. Importable desde Server Components
  motion-client.ts                 # V2 — 'use client': usePulseOnChange(value) + <ValuePulse> (pulso one-shot al cambiar precio live; reduced→estático)
  watchlist-table-style.ts         # V2 — helpers de estilo de la tabla: colClass(), pillClass(), NUMERIC_COLS, MOBILE_HIDDEN, min-widths anti-jitter (extraídos para no crecer WatchlistTable.tsx)
  utils/
    cn.ts                          # clsx + tailwind-merge
    formatters.ts                  # formatCurrency, formatPercent, formatMarketCap; percentColor() → text-gain/text-loss
types/index.ts                     # AssetType, MetricKey, Profile (+ onboarding_seen), Watchlist, WatchlistAsset (+ source/peer_of),
                                   # QuoteData (+ country), HistoricalDataPoint, WatchlistShare,
                                   # FlashState, MetricDefinition, METRIC_DEFINITIONS
supabase/schema.sql                # DDL completo + RLS + triggers + funciones seed + migraciones Fase 1-2
scripts/
  diagnose.mjs                     # node scripts/diagnose.mjs <TICKER> — 3 capas de debug
  inspect-asset.mjs                # Inspección de metadata + peers de un activo
  refresh-news.mjs                 # Expira el brief vigente + dispara el pipeline vía HTTP (default localhost:3000)
  run-news-pipeline.ts             # Runner standalone del pipeline (GitHub Actions): invoca runNewsPipeline() directo, sin HTTP/auth ni límite de 60s; importa lib/ai/ por ruta RELATIVA (no `@/`). Local: npx tsx scripts/run-news-pipeline.ts (lee .env.local)
  check-cron.mjs                   # Diagnóstico del pipeline + estado en Supabase: GET /api/news/current (guard) + POST /api/cron/news-pipeline (Bearer) + últimos 5 market_briefs
  check-llm.mjs                    # Verifica conectividad de la cadena LLM (Gemini/Groq/Cerebras)
  manage-team-evolve.mjs           # Alta de usuarios Supabase Auth (email_confirm) + set is_team_evolve true/false (listas NEW_MEMBERS/REMOVED_MEMBERS)
  diagnose-seed.sql                # 6 bloques de diagnóstico del trigger chain de creación de usuarios (correr por separado en SQL Editor)
  fix-seed-trigger.sql             # Fix del trigger chain: ^RUT faltante (Fix A), triggers rogue (Fix B), backfill de watchlists (Fix C) + bloque de verificación con ROLLBACK
.github/workflows/
  news-pipeline.yml                # Trigger automático del brief (Lun/Vie 13:00 UTC) — reemplaza al Vercel Cron (moría a 60s en Hobby); corre `npx tsx scripts/run-news-pipeline.ts` con secrets del repo; timeout 15 min + workflow_dispatch manual
```

## Variables de entorno requeridas
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # empieza con eyJ (no eeyJ)
FINNHUB_API_KEY=                 # 'your-finnhub-api-key' → modo mock con 10 tickers hardcoded
TAVILY_API_KEY=                  # Tavily search API — pipeline de noticias
FIRECRAWL_API_KEY=               # Firecrawl — extracción de artículos completos (bypass paywalls)
FIRECRAWL_API_KEY_2=             # Respaldo Firecrawl: si la primaria se queda sin créditos, extractContent salta aquí
CRON_SECRET=                     # Bearer del trigger HTTP manual/respaldo (/api/cron/news-pipeline). El trigger automático (GitHub Actions) NO usa este secret — invoca el runner directo
# ── Cadena LLM (lib/ai/llm.ts) — endpoints OpenAI-compatibles con fallback automático ──
# callLLM recorre NEWS_LLM_CHAIN en orden; un proveedor SIN api key se salta solo.
# Modelos DISTINTOS para 'analysis' vs 'selection' por proveedor (no compiten por TPM).
NEWS_LLM_CHAIN=gemini,groq,cerebras   # orden de fallback (default si no se define)
GEMINI_API_KEY=                  # Principal: Gemini 2.5 Flash (Google AI Studio, free, 1M ctx) — aistudio.google.com
# GEMINI_ANALYSIS_MODEL=gemini-2.5-flash | GEMINI_SELECTION_MODEL=gemini-2.5-flash-lite (defaults)
OLLAMA_API_URL=https://api.groq.com/openai  # Fallback 1: Groq (OpenAI-compatible). Ollama local: http://localhost:11434
OLLAMA_API_KEY=                  # Groq: console.groq.com → API Keys. Ollama local: dejar vacío
OLLAMA_MODEL=llama-3.3-70b-versatile        # modelo de SELECCIÓN/enriquecimiento (Groq)
NEWS_ANALYSIS_MODEL=openai/gpt-oss-120b     # modelo de ANÁLISIS (Groq)
CEREBRAS_API_KEY=                # Fallback 2: Cerebras (free, ~1M tokens/día) — cloud.cerebras.ai
```

## Comandos
```bash
npm run dev    # Turbopack dev server
npm run build  # Webpack build con TypeScript check
node scripts/diagnose.mjs <TICKER>   # Diagnóstico de ticker en 3 capas
node scripts/refresh-news.mjs        # Regenera el brief AHORA (expira el vigente + dispara el pipeline)
                                     # ⚠️ ejecuta el código del server destino (default localhost:3000 → necesita npm run dev).
                                     #    Escribe en Supabase (DB compartida), así que el brief se ve en local y prod.
                                     #    Para prod: node scripts/refresh-news.mjs https://TU-APP.vercel.app (requiere deploy ya hecho)
node scripts/check-llm.mjs           # Verifica que la cadena LLM responde (Gemini/Groq/Cerebras)
npx tsx scripts/run-news-pipeline.ts # Corre el pipeline standalone (igual que GitHub Actions): runNewsPipeline() directo, sin HTTP. Lee .env.local en local
node scripts/check-cron.mjs          # Diagnostica el estado del brief + dispara la route vía Bearer + lista últimos market_briefs
node scripts/manage-team-evolve.mjs  # Alta de cuentas Supabase + flag is_team_evolve (edita listas NEW_MEMBERS/REMOVED_MEMBERS en el script)
```

## Notas de arquitectura

### Sistema de diseño (identidad actual: "Evolve Signal" — inteligencia financiera, viva)
> ⚠️ Reemplaza la identidad anterior "warm bone + rare teal spark" (V2). Si ves referencias a warm-bone, near-black cálido (hue 40°) o "teal reservado a 4 puntos" en código/docs, son **históricas** — verifica contra `app/globals.css` antes de asumir colores.
- **Postura**: SaaS de inteligencia financiera moderno/institucional/elegante (vibe Stripe/Linear/Mercury/Lovable), **NO una terminal de trading**. Ligero, aireado y por capas; nada de superficie negra plana. **Light y dark son co-protagonistas** (mismo nivel de detalle/contraste/AA en ambos).
- **Base = grafito frío por capas** (hue ~220°). Escalera de elevación visible: `--ink-base` 11% → `--ink-surface` 15% → `--ink-elevated` 19% → `--ink-overlay` 22% (dark). Light = "cool paper" (`--background` 210 24% 98%, cards a blanco levantadas por sombra suave + hairline). La profundidad se lee por tono+sombra+hairline, no por oscuridad.
- **Acento de marca "signal" = cian-teal `--electric`** (`184 80% 50%` dark · `188 88% 31%` light para AA). Es la señal de *vivo / inteligente / interactivo*: acciones primarias, Live, focus/ring, glow del logo, highlights. Menos escaso que el teal de V2 pero sigue siendo señal, no decoración.
- **Cromo neutro "mist" = `--bone`** (plata/grafito frío `210 22% 88%` dark; invierte a charcoal frío `222 22% 24%` en light). Bordes, hover, hairlines, texto secundario. `--ring` → acento (no bone). Sombras de hue frío 220°.
- **Aliases Tailwind**: `signal` (=`electric`, `{DEFAULT,dim,bright}`) y `mist` (=`bone`). Se conservan `spark` y `bone` como aliases del MISMO token → los ~64 usos previos siguen funcionando sin migración.
- **Paleta de charts**: `CHART_SERIES` (8 tonos navy→teal→sky, `--chart-1..8`). Consumir siempre vía `useChartTheme()` (`lib/chart-theme.ts`) — resuelve CSS vars a hex/hsl para Recharts; reactivo a `resolvedTheme`. NUNCA hardcodear colores. Las **series `--chart-1..8` son dato → NO se tocan**; solo se recolorearon a frío los neutrales que las rodean (grid/axis/tooltip).
- **Semánticos PRESERVADOS**: `text-gain`/`text-loss` (no `text-green-500`/`text-red-500`); `percentColor()` los emite. `--gain`/`--loss`, flash `animate-flash-green/red` y el heartbeat realtime intactos.
- **Badges de tipo de activo**: siempre vía `typeBadgeClass(type)` / `typeLabel(type)` de `lib/asset-style.ts`. `stock`/`etf`/`fund` → neutro (`bg-foreground/10 text-foreground`), diferenciados por el TEXTO, NO por color; `index`/`crypto` mantienen ámbar/naranja (raros).
- **Identidad por vista**: `PageHeader` acepta `eyebrow?` (kicker) y `accent?: 'signal'|'gain'|'loss'|'mist'` (default `mist`) → cada pantalla tiene un acento/kicker propio coherente con el sistema (Top=`gain`, Bottom=`loss`, Peers/Comparar=`signal`).
- **Primitivos reutilizables**: `Card` (rounded-card + shadow-card), `Tabs` (in-house), `Tooltip` (sobre Radix Popover). Usar en toda vista nueva.
- **`no purple` invariant**: `purple-*`/`a855f7`/`168,85,247` no deben existir en componentes (excepto badge de riesgo Alta en `WeeklyBriefCard`, que es rojo). Verificar con grep.
- **Tailwind tokens**: `rounded-card`, `rounded-pill`, `shadow-card`/`pop`/`glow` (glow basado en el acento), `colors.signal`/`mist`/`spark`/`bone`/`electric`, `colors.chart.1..8`. Keyframes nuevos: `shimmer` (skeleton), `live-pulse`, `draw-mark`. Definidos en `tailwind.config.ts`.
- **Utilidades CSS nuevas** (`app/globals.css`): `.glass` (superficie translúcida + backdrop-blur + hairline; variante `.light .glass`), `.ambient-grid` (rejilla de precisión tenue), `.spotlight-accent` (glow de acento que sigue al cursor vía `--mx/--my`). Se conservan `.spotlight`/`.gradient-border`/`.card-lift`/`.grain` (recoloreados a mist). Todo gateado en el bloque `prefers-reduced-motion`.
- **`.theme-dark`**: clase de scope que fuerza el tema dark en cualquier subárbol (p.ej. el login always-dark), sobreponiéndose a un `.light` heredado por proximidad de custom-properties. `:root, .theme-dark { … }` comparten los valores dark.
- **`.focus-ring`**: usar en todos los `<button>`/`<input>` crudos (no shadcn) para a11y.

#### Marca viva — `components/brand/EvolveMark.tsx`
- **Un solo origen reutilizado** como logo del login (interactivo: parallax/tilt + glow al cursor), marca del sidebar (`idle` pulse leve), motivo de empty states (`EmptyState` sin icono) y loader.
- `EvolveMark({size, interactive, idle, withGlow, strokeWidth})` — SVG path (`currentColor`) + nodos + ápice con glow de acento (`hsl(var(--electric))`). `EvolveLoader({size,label})` — dibuja el mark en loop (`pathLength`) + pop del ápice; reduced-motion → estático.

#### Signature moments (nuevos)
- **Command palette ⌘K** (`components/dashboard/CommandPalette.tsx`, controlado `{open,onOpenChange}`): listener global ⌘K/Ctrl+K; navega entre las 6 páginas + busca tickers (`/api/market/search`, debounce 300ms) → `/etf-compare?tickers=X`; teclado arriba/abajo/enter; modal glass. Disparador (faux-input con kbd ⌘K) en el sidebar de `DashboardShell` + icono en el header móvil.
- **`LiveIndicator`** (`components/dashboard/LiveIndicator.tsx`): pill "● Live" (o `bare` dot) con halo `animate-ping` + dot `bg-signal`. Usado en `OverviewDashboard` (MarketSnapshot) y `NewsBlock`. Un solo componente para todo "Live".
- **Toasts** (`components/ui/toast.tsx` + `ToastProvider` en `components/providers.tsx`): `useToast()`, cola con auto-dismiss, `aria-live="polite"`, cards glass con `AnimatePresence`, variantes success/error/info. Cableado en `WatchlistManager` (crear/borrar/compartir/dejar de seguir).
- **`MarketDepthField`** (`components/auth/MarketDepthField.tsx`): fondo del login en **Canvas 2D nativo** (sin dep) — reemplazó a `IntelligenceField` (constelación, eliminado). Barras de "profundidad de mercado" que divergen arriba/abajo de una **baseline de retornos** (gain/loss a baja saturación → lee como dato de mercado, no ecualizador de audio), respiran lento; bajo el cursor crecen y se **iluminan a teal** (el capital se concentra donde va la atención) + glow radial bajo el puntero. Lee `--gain`/`--loss`/`--electric`/`--bone` por `getComputedStyle`. Un solo `requestAnimationFrame`, pausa en `visibilitychange`, frame estático en reduced-motion, densidad menor en móvil, dpr ≤2.
- **`EvolveLogo3D`** (`components/brand/EvolveLogo3D.tsx`): tratamiento 3D del logo OFICIAL circle-"e" como hero del login. Geometría recreada en SVG (anillo + círculo interior + slash), extruida en **CSS 3D** apilando ~16 copias en Z (sin motor 3D / sin dep) → lee como medallón metálico sólido; gira en turntable con `rotateX` inclinado fijo + light-sweep estacionario; caras con gradiente bone→teal, rim oscuro. Reduced-motion → vista 3/4 estática; pausa la rotación cuando la pestaña está oculta. `EvolveMark` (nodos) ya NO se usa en el login.
- **Login** (`app/(auth)/login/page.tsx`): reescrito a "Transforming Investments", wrapper `.theme-dark` (always-dark). Backdrop **FIXED** = `MarketDepthField` + ambient-grid + blobs de glow + hairline (se queda fijo mientras la narrativa hace scroll). Grid desktop: col1 = hero (`EvolveLogo3D` + wordmark + slogan "Transforming Investments" + statement) en row1 y la **narrativa scroll** en row2 (4 `NarrativeScene` con escenas presentacionales scripted + cierre); col2 = card `glass spotlight-accent` **STICKY** (`lg:sticky lg:top-0 lg:h-dvh`, centrada) siempre accesible. Orden DOM = hero → card → escenas ⇒ en móvil queda hero compacto → **form primero** → escenas (auth nunca se entierra). **Lógica de auth 100% preservada** (`signInWithPassword`/`signUp`, redirect, success screen, toggle de modo).
- **Skeleton** (`components/ui/skeleton.tsx`): shimmer (gradiente que recorre, `animate-shimmer`, `motion-reduce:hidden`).

#### Sistema de movimiento (Framer Motion, sin deps nuevas)
- **`lib/motion-tokens.ts` (PURO, sin `'use client'`)**: `EASE_OUT [.22,1,.36,1]`, `DUR{fast .18,base .28,slow .5,ambient .9}`, `SPRING_SOFT/SNAP`, `SPRING_CURSOR` (parallax del logo), `TICKER_SPRING`, `STAGGER/STAGGER_FAST`, variants `fadeUp`/`fadeBlur`/`scaleIn`/`staggerContainer`, `assetLayoutId(t)=>`asset-${t}``, `morphTransition`. **Debe quedar puro** para importarse desde Server Components (marcarlo `'use client'` rompería el build de App Router).
- **`lib/motion-client.ts` (`'use client'`)**: `usePulseOnChange(value)` + `<ValuePulse>` — pulso one-shot (scale + ring `gain/loss/electric`) cuando un precio live cambia; `useReducedMotion` → estático. Construido con `createElement` (para que el archivo `.ts` sea válido).
- **Las dos apuestas de motion**: (1) **shared-element fila→modal** — la fila de `WatchlistTable` "crece" al `AssetDetailModal` vía `layoutId={assetLayoutId(ticker)}` + `<LayoutGroup>` a través del portal Radix (Plan A confirmado en uso; Plan B ghost-FLIP en reserva si glitchea). (2) **"el tablero late con el mercado"** — `<ValuePulse>` vive donde HAY dato live a 5s (`useRealtimePrices`): precios de la tabla, benchmarks de `MarketSnapshot`, precio del modal. El héroe del Overview pulsa solo en período `1D` o al cambiar ranking (su dato no es live a 5s).
- **`NumberTicker.tsx`**: count-up spring (`TICKER_SPRING`) + `useReducedMotion` (valor final instantáneo) + `startOnView` (`useInView`).
- **Transición de página**: `components/dashboard/PageTransition.tsx` dentro del `<main>` de `DashboardShell` (NO toca el server `layout.tsx`); `AnimatePresence` keyed por pathname, opacity+rise, `DUR.fast`.
- **Reveals**: listas (`PeerComparison`/`PeerCard`, `NewsBlock`) usan `staggerContainer`+`fadeUp` con `whileInView`; barras divergentes de `PeerCard` animan width 0→target. Todo gateado por `useReducedMotion`.
- **Intocable**: el heartbeat realtime `PriceCell`/`AnimatedPrice` (flash CSS verde/rojo) NO se tocó; ValuePulse es una capa aparte.

### Peers deterministas (Fase 1-2)
- Caché de precios en Supabase `price_cache` (no en memoria) — serverless-safe
- TTL precios: 60s. TTL fundamentals: 24h (`fundamentals_fetched_at` timestamptz)
- `price_cache.currency` se puebla desde `meta.currency` de Yahoo Finance v8
- **Yahoo Finance v10 requiere auth**: Node.js no puede obtener crumb/cookies (Yahoo envía >16KB headers → `HPE_HEADER_OVERFLOW`). Por eso se usa `yahoo-finance2`.
- Los históricos de Yahoo Finance llevan `User-Agent: Mozilla/5.0` para evitar 403
- Los retornos YTD usan `range=ytd` de Yahoo (calcula último día hábil del año anterior automáticamente)
- **Conversión USD**: `useFxData` obtiene spot rates vía `/api/market/quote` (pares como `GBPUSD=X`) y period returns vía `/api/market/history`. GBX (peniques) usa `GBPUSD=X ÷ 100`. Fórmula retornos: `(1 + local%) × (1 + fx_period%) − 1`
- **Watchlists por defecto** (3): First Trust, Evolve Universe, Pershing Square — sembradas vía trigger `on_profile_created_seed_watchlists`. Backfill manual: `SELECT seed_<name>_watchlist(id) FROM profiles`
- **Trigger chain de alta de usuarios** (⚠️ frágil — diagnóstico en `scripts/diagnose-seed.sql`, fix en `scripts/fix-seed-trigger.sql`): `auth.users` INSERT → `on_auth_user_created` → `handle_new_user()` → INSERT `profiles` → `on_profile_created_seed_watchlists` → `handle_new_user_default_watchlists()` → las 3 `seed_<name>_watchlist(p_user_id uuid)`. Si CUALQUIER seed falla, **toda la creación del usuario aborta** (no hay perfil ni cuenta). Modos de fallo vistos: (1) **FK 23503** `watchlist_assets_asset_ticker_fkey` — un ticker que la seed inserta en `watchlist_assets` no existe en `assets_metadata` (p.ej. `^RUT` faltante → Fix A); cada seed debe insertar sus tickers en `assets_metadata` (`ON CONFLICT DO NOTHING`) ANTES de referenciarlos. (2) **FK 23503** `watchlist_assets_watchlist_id_fkey` — la seed quedó **corrupta en la DB** (cuerpo sin `DECLARE v_watchlist_id`/sin `INSERT INTO watchlists RETURNING id`, de modo que `v_watchlist_id` apunta a un UUID inexistente); la fuente correcta está en `supabase/schema.sql`. ⚠️ Si la función corrupta se guardó con el parámetro mal nombrado (`v_watchlist_id` en vez de `p_user_id`), `CREATE OR REPLACE` lanza **42P13** `cannot change name of input parameter` — hay que `DROP FUNCTION seed_<name>_watchlist(uuid)` primero y luego recrearla. Verificación segura: el bloque `DO $$` de `fix-seed-trigger.sql` inserta un `auth.users` falso, cuenta watchlists/assets y hace `RAISE EXCEPTION` para ROLLBACK (nada persiste). Nota: `RAISE NOTICE` NO aparece en el panel de resultados del SQL Editor de Supabase; usar `RAISE EXCEPTION` para errores visibles.
- **CT funds tickers**: `0P0000NCAC` (Global Tech), `0P00000R12.L` (Japan), `0P00000R0U.L` (European), `0P0001CZXM.L` (Global Focus), `0P00000XBQ.L` (North American) — tickers internos Yahoo Finance para fondos sin cotización directa
- **Peer taxonomy** (`lib/market/peer-taxonomy.ts`): mapa estático `STATIC_PEERS` curado para todos los activos de las 3 watchlists. `computeInitialPeers(selectedAsset, allAssets, { categories })` lo consulta primero (override exacto); si no hay entrada, cae al scoring algorítmico (`scorePeerSimilarity`) sobre el catálogo `TAXONOMY`. El scoring suma un **boost por categoría Morningstar** (misma `morningstarCategory` +25, misma `globalCategory` +12) cuando ambos lados la conocen; `classifyFromMetadata` usa la categoría Morningstar como señal primaria. El mapa `MS_CATEGORY_TO_CLASSIFICATION` (en `peer-taxonomy.ts`) traduce categoría→strategy/universe/etc. Las `categories` (ticker→{morningstar,global}) se inyectan desde `price_cache`. Tie-breaker estable en sort final: `b.score - a.score || (a.ticker < b.ticker ? -1 : 1)` — mismo `price_cache` → mismo set siempre. Constantes `MIN_PEER_SCORE=60`, `MAX_AUTO_PEERS=8`. **NUNCA** recomputa ni sobreescribe entradas `STATIC_PEERS`.
- **Filtro inline de watchlist**: input "Filter list…" en toolbar de `WatchlistTable` — filtra por ticker/nombre en tiempo real sin afectar precios ni modal
- **Orden de columnas (MetricsSelector)**: el popover "Columns" reordena las columnas visibles con flechas ↑↓ (reemplazó al drag, que era frágil). `move()` resuelve la posición **por KEY** contra la lista limpia, nunca por el índice de render → la fila visible siempre mapea al elemento correcto. Al **añadir** una métrica, entra en su lugar **cronológico** (`canonicalRank` por `METRIC_DEFINITIONS`; p.ej. 1W cae justo tras 1D). Botón "Sort by time" reordena todo a cronológico. El array `selected_metrics` se **auto-repara** en cada interacción (descarta keys inválidas/legacy y duplicados que antes desincronizaban filas). En `AssetDetailModal` (tab Peers), añadir/quitar columnas de retorno también las ordena solas cronológicamente (mismo `PEER_PERIOD_OPTIONS`).
- **Ordenar por métrica**: columnas numéricas tienen `sortingFn` personalizado que extrae el valor numérico respetando toggles USD/Ann. `numSort` envía nulls al fondo. Columnas `helper.display()` necesitan `sortingFn` explícito; CCY y actions tienen `enableSorting: false`
- **Compartir watchlists**: `WatchlistManager` muestra Share2 (hover). Dialog resuelve email → `user_id` vía `/api/users/find`, inserta en `watchlist_shares`. El destinatario ve la lista con icono `Users` + subtexto `de @username`. Puede dejar de seguir (DELETE donde `shared_with_user_id = currentUserId`). PostgREST devuelve join de `profiles` como array — usar `share.profiles?.[0]?.email`. El dialog también ofrece **"Team Evolve"** (`addTeamShares` en `useWatchlistShares`): comparte de un golpe con todos los `profiles` con `is_team_evolve=true`. La gestión del equipo (alta de cuentas + flag `is_team_evolve`) se hace fuera de la app con `scripts/manage-team-evolve.mjs` (listas `NEW_MEMBERS`/`REMOVED_MEMBERS`).
- **Top/Bottom performers** (`useTopPerformers.ts`): `useAllWatchlistTickers` carga todos los tickers del usuario vía Supabase (join `watchlist_assets` + `assets_metadata`). Luego `/api/market/history` por período para calcular retornos y ordenar. **Anualización (toggle "Ann.") con años NOMINALES fijos** (`NOMINAL_YEARS = { '1Y':1, '3Y':3, '5Y':5, '10Y':10 }`, idénticos para todos los activos): el CAGR `(1+R)^(1/años)−1` es monótono en R con `años` constante, así el orden del ranking con Ann. = orden sin Ann. para esos períodos. ⚠️ Antes se usaba `entry.years` (duración real del histórico por-activo de `calculateReturn`), lo que daba exponentes distintos entre activos y rompía la monotonía del orden. `MAX` conserva los años reales por-activo (no tiene período nominal). Sub-anuales (1D/1W/1M/6M/YTD) no se anualizan.
- **Beating Peers** (`/vs-peers`, `usePeerComparison.ts` + `PeerComparison`/`PeerCard`): por cada activo del usuario muestra en cuántas de **6 métricas** (1D/1W/1M/6M/YTD/1Y) le gana a sus peers. Un periodo se cuenta como **ganado si supera al ≥75%** de los peers **con dato** (`beaten/evaluated ≥ 0.75`; empate NO cuenta como vencido). **Denominador estable**: `PeriodResult.assigned = peers.length` (total de peers asignados, **constante entre los 6 períodos**); `PeerCard` muestra "ganó a {beaten}/{assigned}" con el mismo Y en todos los períodos. Los peers **sin dato** ese período (incl. no-USD sin FX) caen en `evaluated` solo si tienen dato comparable — NO reducen el denominador y NO penalizan el veredicto won/lost (se decide solo sobre `evaluated`). 1D viene de quotes en vivo; el resto de `/api/market/returns` (POST batch, caché `returns_cache` 6h, `calculateMultiReturns` = 1 serie 1Y → 5 periodos). **Resiliencia de red (paridad con watchlist)**: un periodo mostraba "— sin dato" solo cuando el fetch en vivo de un ticker fallaba transitoriamente (serie 1Y vacía → todo null) y, como los fallos NO se cachean, un ticker sin fila quedaba en blanco en cada carga. Dos capas lo corrigen: (1) `fetchHistoricalData` **reintenta** fallos transitorios (429/5xx/cuerpo vacío, 3 intentos con backoff) — primitivo compartido con el watchlist, endurece la raíz; (2) `returns/route.ts` hace **fallback a último-bueno** — si un fetch fresco vuelve degradado (1Y null) pero existe fila cacheada sana (aun expirada), sirve ese valor en vez de `null` (la caché es un almacén de último-dato-bueno; solo un ticker SIN dato previo muestra el resultado degradado). Todo se normaliza a **USD** con `useFxData` (misma fórmula que Top performers). Se **deduplica la unión** activos∪peers (cada ticker se pide una sola vez). El set de peers por activo se materializa de forma **determinista** en `/api/peers/init` (categorías SIEMPRE desde `price_cache`, no del caller) y se persiste en `user_asset_peers`; el modal y la página comparten ese set (curación con `usePeerSet`). Estado por periodo: `'won'|'lost'|'insufficient'` — se evalúa solo cuando todo está `settled` (tickers/peers/returns/prices/FX cargados); activos no-USD sin FX → `null` (nunca compara retorno local como si fuera USD). `PeerCard` renderiza "—" para `insufficient`. **Panel expandido** (`PeerCard`, animado con Framer Motion `height 0→auto`): al abrir un período muestra la fila del activo (destacada, fondo `brand-teal/10`) y una fila por peer ordenada por retorno desc (sin-dato al fondo), cada una con su **retorno USD** (`PeriodResult.peerReturns[ticker]`, ya calculado en el loop won/lost — solo se **expone**, no cambia la lógica), el **delta pp vs el activo** (`assetReturn − peerReturn`, oculto en mobile vía `hidden sm:block`), un icono **✓/✗** de comparación **1-a-1 estricta** (`assetReturn > peerReturn`; ⚠️ distinto del veredicto del período que usa el umbral ≥0.75 — un período puede estar `lost` aunque gane a algún peer suelto) y una **mini-barra de contexto CSS** proporcional al rango `[min,max]` del grupo (`bg-brand-teal` activo · `bg-chart-1` peer vencido · `bg-muted` peer ganador, mín. 4px). Nombres de peers vía `AssetComparison.peerNames` (cadena: `assets_metadata` → quote en vivo → ticker). `AssetComparison.peerTypes` expone el `AssetType` de cada peer (de `assets_metadata`; fallback a `instrumentToType(prices[].instrument_type)` para peers que no están en watchlist). **Display por tipo en `PeerCard`**: fondos (`type='fund'`) muestran solo `name` en el header y en filas expandidas (`hideTicker=true`) — el ISIN/ticker críptico queda oculto; ETFs y stocks muestran `ticker` + nombre real (backfilled desde Yahoo Finance en `quote/route.ts` con `ignoreDuplicates`). `instrumentToType()` está implementada tanto en `usePeerComparison.ts` (para el hook) como en `quote/route.ts` (para el backfill de `assets_metadata`). **Toolbar** (`PeerComparison`): `SegmentedControl` de relevancia ≥N/6 (`minWon`, default 4/6 = gana >50% de los períodos) + buscador por ticker/nombre (`filterQuery`), combinados en AND sobre `metricsWon`. ⚠️ Checkpoint conocido: la ventana del retorno del activo (por-fecha) y la del FX period return (`range=` de Yahoo) pueden desfasar levemente en activos no-USD
- **FundamentalsPanel**: panel bento premium con `NumberTicker` (importado de `components/dashboard/NumberTicker.tsx`). Tooltips de información con posición `fixed` para evitar clipping en contenedores `overflow-y-auto`
- **PriceMarquee**: marquee header con tickers de `BENCHMARK_TICKERS` (`lib/market/benchmarks.ts`) — polling independiente de las watchlists del usuario
- **Overview** (`OverviewDashboard.tsx`): dashboard agregado en `/` (ya no redirige a watchlist). KPIs best/worst performer (`useTopPerformers`), contador "beating peers" (`usePeerComparison`), snapshot de mercado (`useRealtimePrices(BENCHMARK_TICKERS)`), teaser del Market Brief (`useNewsBrief`). Solo reutiliza hooks existentes — cero endpoints nuevos.
- **AssetDetailModal — Tabs**: 3 tabs (Summary · Calendar Years · Peers). Calendar Years usa `useCalendarYearReturns` gateado: solo fetchea cuando `activeTab === 'calendar'` (pasa `null` en otras tabs, `enabled: !!ticker` previene la request). `activeTab` se resetea al cerrar el modal. Todos los hooks son incondicionales (Rules of Hooks).
- **Onboarding**: `TourProvider` + `TourSpotlight` en `components/onboarding/`. `app/(dashboard)/layout.tsx` lee `profiles.onboarding_seen` y pasa la prop. Tour arranca automáticamente una sola vez (localStorage `evolve_onboarding_seen` como fallback). Al terminar/saltar persiste en Supabase via browser client (RLS permite UPDATE del propio perfil). Anchors `data-tour="..."` en `DashboardShell` y `WatchlistManager`.
- **Comparar** (`/etf-compare`, `EtfCompare.tsx` + `useEtfComparison`/`useCompareTickers`): comparador de activos lado a lado inspirado en ETF.com, recoloreado a V2. Estado en la URL (`?tickers=DDIV,SDVY,RDVY`, compartible). **Type-lock por grupo**: el primer ticker fija el grupo (`compatGroup`: etf+index se mezclan; fund solo con fund; stock solo con stock) y el search deshabilita resultados de otro grupo. Cap `MAX_COMPARE_TICKERS`. **Fetch colapsado** (no 3N peticiones): `useRealtimePrices` (1 batch → Header/Overview/Risk/Holdings) + `useQueries` de N series 5Y (cola client-side ≤4 in-flight + `retry:2` backoff). Tabs: Overview · Performance · Holdings · Risk&Dividends — cada tab visible solo si **≥1** activo tiene su dato (índices solo Overview+Performance; stocks ocultan Holdings y muestran MktCap/PE/Sector). **Toggle "Resaltar diferencias"**: marca el "mejor" valor por fila con énfasis **bone/`font-semibold`** (NO teal, respeta el invariante) según dirección por métrica (expense/std_dev → menor mejor; returns/sharpe/alpha/aum/yield → mayor mejor). **Colores de charts**: `compareSeriesColor(i)` reordena los mismos `--chart-1..8` con la permutación `[0,4,2,6,1,3,5,7]` (máximo contraste de luminosidad para activos adyacentes **sin tocar la rampa**); el donut de holdings usa `seriesColor(i)` directo (slices dentro de un mismo fondo, no activos comparados). **Retornos**: trailing 1M/6M/YTD/1Y/3Y/5Y y anuales se derivan client-side (`deriveTrailing`/`deriveAnnual`) de una sola serie `adjclose` 5Y — los trailing 3Y/5Y se muestran **acumulados** (sección "Retornos acumulados", NO anualizados como Yahoo); los anuales matchean `annualTotalReturns` de Yahoo a ≤0.02pp. ⚠️ El BarChart anual queda acotado a la ventana 5Y (`MAX_YEARS`), aunque el fondo tenga más historia. **Verificado contra Yahoo** (RDVY/SDVY/VIG): expense/AUM/categoría/beta/yield/std_dev/sharpe/alpha/holdings/sectores/anuales matchean; std_dev e inception corregidos (ver `### yahoo-finance2 v3`).

### Sección de noticias (Market Brief)
- **Pipeline** (`lib/ai/news-pipeline.ts`): la orquestación vive en **`runNewsPipeline(supabaseAdmin)`** (export de `news-pipeline.ts`), invocada por DOS triggers: el runner `scripts/run-news-pipeline.ts` (GitHub Actions, canónico) y la route HTTP `app/api/cron/news-pipeline/route.ts` (manual/respaldo). Flujo: `enrichAssetProfiles` → `searchNews` (Tavily) → `rankCandidates` (pre-ranking determinista) → `selectTop7` (selección LLM) → `extractContent` (Firecrawl) → `analyzeAndSynthesize` (análisis/scoring LLM) → `matchAffectedSymbols` (matching determinista) → `selectFinalArticles` → insert en `market_briefs` + `market_news`
- **Trigger (GitHub Actions, canónico)**: `.github/workflows/news-pipeline.yml` corre `npx tsx scripts/run-news-pipeline.ts` los **Lun/Vie 13:00 UTC** (07:00 MX) — reemplazó al **Vercel Cron** (moría a los 60s en el plan Hobby; GitHub Actions no tiene ese límite, `timeout-minutes: 15`). El runner invoca `runNewsPipeline()` directo (sin HTTP, sin `CRON_SECRET`), con env vars desde los repo secrets. `workflow_dispatch` permite disparo manual desde la pestaña Actions. La route `/api/cron/news-pipeline` (Bearer `CRON_SECRET`, `maxDuration=300`) queda como trigger HTTP manual/respaldo y llama al MISMO `runNewsPipeline()`. `computeValidUntil()` fija la vigencia (Lun→Vie, Vie→Lun). **Guard anti-doble-ejecución con cota temporal** (`fifteenMinAgo`): salta solo si hay un brief `ready` aún válido (`valid_until > now`) **o** uno `generating` reciente (`created_at > now−15min`). **Auto-recuperación**: antes del guard, cualquier `generating` con `created_at < now−15min` (run que excedió su límite y fue matado → fila atascada que antes bloqueaba TODAS las ejecuciones futuras) se marca `failed` (`metadata.error: 'abandoned…'`) para no bloquear la regeneración. **Logging** con prefijo `[news-cron]`: filas recuperadas, decisión del guard (skip+motivo o proceed), `valid_until` calculado, SUCCESS (`briefId`) / FAILED (error real) — visible en los logs de GitHub Actions (o de Vercel si se usó la route)
- **Lectura**: `GET /api/news/current` (auth) devuelve el brief vigente; si no hay vigente, sirve el último como `stale: true`. `useNewsBrief` lo consume; `NewsBlock` renderiza `WeeklyBriefCard` + grid de `NewsCard`
- **Cadena LLM** (`lib/ai/llm.ts`): `callLLM({ role })` recorre `NEWS_LLM_CHAIN` (default `gemini,groq,cerebras`); un proveedor sin API key se salta solo; reintentos con backoff ante 429/503/timeout. Modelos DISTINTOS para `analysis` vs `selection` (no compiten por TPM). `extractJson`/`sanitizeJsonString` parsean salidas sucias sin depender del modo JSON del proveedor
- **Relevancia de portafolio = 100% DETERMINISTA** (el LLM ya NO adivina `affected_tickers`): **Fase A** `enrichAssetProfiles` enriquece cada activo UNA vez (cacheado en `assets_metadata.relevance_profile`) con señales estables (entities, themes, geography, issuer); perfiles "pobres" (sin entities ni themes) NO se cachean → reintentan. **Fase B** `matchAffectedSymbols` cruza esos perfiles contra `title + full_text_md` con guardas estrictas (entity preferido; ticker literal solo con `\b` + MAYÚSCULAS o cashtag `$XXX`, nunca substring/case-insensitive; themes solo corroboran). Índices (`type='index'`) NO generan badge 🎯. `affected_tickers` (text[]) se deriva de `affected_symbols` para no romper frontend ni el índice GIN
- **Badge 🎯 multi-tenant**: se calcula en cliente (`NewsCard` filtra `affected_tickers` contra los tickers de la watchlist activa del usuario) — la misma fila de `market_news` muestra/oculta el badge por usuario
- **Scoring**: 5 dimensiones 0–5 (`macro_impact`, `surprise_factor`, `market_relevance`, `forward_implications`, `structural_vs_noise`) + `time_decay` → TOTAL máx 25. `portfolio_relevance` NO suma al total (solo informativo + garantía de inclusión). RATING A(19-25)/B(15-18)/C(11-14)/D(<11); SIGNAL STRONG/MODERATE/WEAK. Few-shot de calibración para reducir varianza. `selectFinalArticles` arma conteo variable 5–7 por umbral de calidad (piso `min=5`; si el núcleo A/B no llega, rellena con los mejores siguientes), con garantía de inclusión por portafolio (≥C/score≥11) sin exceder 7. `MAX_CANDIDATES=10` da headroom para que tras la dedup por evento queden ≥5 distintos
- **Volumen del brief (piso 5)**: `searchNews` ensancha deliberadamente el embudo de entrada para que incluso en semanas tranquilas entren ≥5 sucesos distintos: ~22 dominios de acceso abierto (`NEWS_SOURCES`), 5 queries con `max_results` 12–15, ventana de 12 días (`cutoff` + `timeRange:'month'`), piso de score Tavily 0.3 y `slice(0,40)` (corte generoso → la diversidad/recorte fino lo hace `rankCandidates`, no el score crudo). Downstream: `MAX_CANDIDATES=10` (headroom para la dedup) y `selectFinalArticles(min=5,max=7)`. ⚠️ El piso de 5 es *best-effort*: si tras la dedup hay <5 sucesos distintos (semana genuinamente pobre), devuelve los que haya (no inventa). La diversidad cross-categoría depende de que exista cobertura real (una semana 100% Fed+tech dará esas 2 categorías aunque las cuotas estén activas)
- **Anti-cámara-de-eco (diversidad)**: un macro-evento grande satura el scoring (todas sus notas con `macro_impact` alto), tendiendo a copar el brief. Dos defensas combinadas determinista+semántica: **(1) Cuotas en el pre-ranking** — `searchNews` etiqueta cada uno de sus 5 queries con una `category` (`fed-macro`/`mexico`/`geopolitics`/`portfolio`/`technology`; la 1ª query que surfa una URL le fija la categoría) y `rankCandidates(articles, urls, limit=14, perCategory=3)` reparte en **round-robin por categoría** (cada bucket coloca su mejor candidato antes del 2.º de cualquiera) y rellena los slots restantes con los mejores globales → el LLM de selección recibe un pool forzosamente diverso. `category` es bucket de diversidad, NO el `topic` de Tavily (`finance`/`news`). **(2) Dedup semántica dura** — `analyzeAndSynthesize` pide un `core_event_tag` por artículo (etiqueta canónica ≤5 palabras del SUCESO base; mismo tag literal para notas del mismo evento aunque difieran fuente/ángulo; se normaliza a `string` tras el parseo). `selectFinalArticles` corre **`dedupeByEvent` como Paso 0** (antes del núcleo A/B y de la garantía de portafolio): agrupa por `normalizeEventTag(core_event_tag)` (minúsculas/sin acentos/sin puntuación/espacios colapsados) y conserva SOLO el de mayor score por suceso (empate → prefiere el relevante para portafolio); tags vacíos/ausentes → cada artículo es único (clave por `source_url`, nunca se fusionan)
- **FOCO GEOGRÁFICO EE.UU./México**: queries de Tavily, prompt de `selectTop7` y rubric de `analyzeAndSynthesize` priorizan Fed/macro de EE.UU., Banxico/peso, gobierno/empresas de EE.UU. y temas globales que mueven esos mercados (petróleo, geopolítica, grandes tecnológicas, treasuries). DESPRIORIZA fuerte decisiones de bancos centrales/política doméstica de OTROS países (Sudáfrica, Corea, etc.) salvo contagio claro a EE.UU./México descrito en el texto (`market_relevance`/`macro_impact` ≤2 en esos casos)
- **NO REDUNDANCIA**: doble capa. **Blanda** (regla de prompt en `selectTop7`): agrupa noticias del MISMO evento/sub-tema (p.ej. varias declaraciones de funcionarios de la Fed la misma semana = UN tema) y elige solo la MEJOR de cada grupo; una 2ª del mismo tema solo si aporta un ángulo nuevo. **Dura** (determinista en `selectFinalArticles` vía `core_event_tag`, ver "Anti-cámara-de-eco"): aunque el LLM ignore la regla blanda, la dedup por evento garantiza 1 noticia por suceso antes de la selección final. Prefiere cobertura amplia sobre profundizar en un solo tema
- **Redacción** (`analyzeAndSynthesize`): `summary`/`insight` en español, neutral; prohibido inventar cifras (si el artículo no da el número, descríbelo cualitativamente); dirección suave permitida, recomendaciones prescriptivas no; lista de frases prohibidas para evitar relleno genérico
- **`published_at`**: usa la fecha del LLM si es válida; fallback a `published_date` de Tavily (en el objeto raw de `searchNews`) — la fecha aparece siempre que la haya, aunque el LLM no la devuelva bien.
- **Disparo manual**: `scripts/refresh-news.mjs` (ver Comandos). Verificación de la cadena LLM: `scripts/check-llm.mjs`
