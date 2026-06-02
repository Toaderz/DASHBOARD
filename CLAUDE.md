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
- **Fuentes**: Fraunces (editorial/números), Plus Jakarta Sans (UI), JetBrains Mono (mono)
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
- `serverExternalPackages: ['yahoo-finance2']` en `next.config.ts`: evita que webpack bundlee el paquete (tiene imports de test que fallan en build).

## Estructura de archivos clave
```
proxy.ts                           # Protección de rutas (Next.js 16) — NO es middleware.ts
app/
  layout.tsx                       # Root layout — fuentes, ThemeProvider, QueryProvider
  globals.css                      # Variables CSS (ink, electric, gain, loss), base styles
  manifest.ts                      # PWA manifest
  sw.ts                            # Service worker (Serwist)
  (auth)/
    login/page.tsx                 # Login + registro dual-mode
  (dashboard)/
    layout.tsx                     # Server — verifica auth, renderiza DashboardShell
    page.tsx                       # Redirect a primera watchlist del usuario
    top10/page.tsx                 # Vista top 10 performers (wrapper de TopPerformers)
    bottom10/page.tsx              # Vista bottom 10 performers (wrapper de BottomPerformers)
    vs-peers/page.tsx              # Vista Beating Peers (wrapper de PeerComparison)
    news/page.tsx                  # Brief de mercado (wrapper de NewsBlock)
    watchlist/[id]/page.tsx        # Server — carga watchlist + assets por ID
  api/
    market/
      quote/route.ts               # Precios + fundamentals; cache en price_cache (TTL 60s / 24h)
      history/route.ts             # Yahoo Finance v8 históricos + FX period returns
      returns/route.ts             # POST batch — retornos multi-periodo (1W/1M/6M/YTD/1Y) + caché returns_cache (TTL 6h)
      search/route.ts              # Búsqueda de tickers (Finnhub)
      export/route.ts              # Export de watchlist a CSV
    peers/
      init/route.ts                # POST — materializa (determinista) el set inicial de peers por usuario/activo
    news/
      current/route.ts             # GET — brief vigente (o último como stale) + market_news (auth)
    cron/
      news-pipeline/route.ts       # POST (Bearer CRON_SECRET) — orquesta el pipeline de noticias
    users/
      find/route.ts                # GET ?email= — resuelve email → user_id (service role)
components/
  providers.tsx                    # QueryClient + ThemeProvider (wrapper raíz)
  dashboard/
    DashboardShell.tsx             # Layout principal: sidebar + nav + PriceMarquee (client)
    WatchlistView.tsx              # Bridge server→client: recibe props del server, renderiza tabla
    WatchlistTable.tsx             # TanStack Table: columnas, filtro inline, sort, modal
    WatchlistManager.tsx           # CRUD watchlists + share dialog en sidebar
    AssetDetailModal.tsx           # Modal: gráfico Recharts + fundamentals + peers (editables/persistidos vía usePeerSet)
    FundamentalsPanel.tsx          # Panel premium bento: métricas animadas con NumberTicker
    PriceCell.tsx                  # Celda tabla con flash CSS verde/rojo
    AnimatedPrice.tsx              # Precio animado con Framer Motion (slide up/down)
    PriceMarquee.tsx               # Ticker marquee header (SPY, QQQ, IWM, GLD, BTC, etc.)
    MetricsSelector.tsx            # Checkbox toggle columnas (persiste en JSONB watchlists)
    TickerSearch.tsx               # Búsqueda con debounce 300ms
    TopPerformers.tsx              # Vista top 10 performers por período
    BottomPerformers.tsx           # Vista bottom 10 performers por período
    PeerComparison.tsx             # Vista Beating Peers: lista de activos ordenada por métricas ganadas
    PeerCard.tsx                   # Tarjeta por activo: "ganó X/6" + filas por periodo expandibles (a quién le gana)
    NewsBlock.tsx                  # Brief de mercado: header + WeeklyBriefCard + grid de NewsCard
    WeeklyBriefCard.tsx            # Resumen semanal: tema/riesgo, conteos de señal, qué vigilar
    NewsCard.tsx                   # Tarjeta de noticia: señal/rating, badge 🎯, análisis, artículo completo
    ThemeToggle.tsx                # Toggle dark/light mode
  ui/                              # shadcn/ui: badge, button, checkbox, dialog, input, label, popover, skeleton
hooks/
  useWatchlistAssets.ts            # useWatchlists + useWatchlistAssets + useWatchlistShares
  useRealtimePrices.ts             # Polling 5s + flashStates (useRef para prev prices)
  usePerformanceMetrics.ts         # Cálculo retornos históricos (1D→MAX)
  useFxData.ts                     # FX spot rates (1-min) + period returns (5-min)
  useTopPerformers.ts              # useAllWatchlistTickers + rankings top/bottom por período
  usePeerComparison.ts             # Beating Peers: dedup activos∪peers + retornos USD + "ganó X/6" por activo
  usePeerSet.ts                    # Set de peers persistido por usuario (load + add/remove; init vía /api/peers/init)
  useNewsBrief.ts                  # GET /api/news/current — brief vigente + market_news
lib/
  ai/
    news-pipeline.ts               # Pipeline de noticias: searchNews→rankCandidates→selectTop7→extractContent→analyzeAndSynthesize→selectFinalArticles
    asset-enrichment.ts            # Relevancia determinista: enrichAssetProfiles (Fase A) + matchAffectedSymbols (Fase B)
    article-clean.ts               # Limpieza determinista del full_text_md (quita nav/ads/social/bio/relacionados; corta en "Our Standards"/"Read Next")
    llm.ts                         # callLLM provider-agnostic (cadena Gemini→Groq→Cerebras) + extractJson robusto
    source-authority.ts            # Mapa dominio→autoridad (0..1) para pre-ranking determinista
  supabase/
    client.ts                      # Browser Supabase client (createBrowserClient)
    server.ts                      # Server Supabase client (cookies async)
    middleware.ts                  # updateSession — refresca tokens en cada request
  market/
    finnhub.ts                     # Finnhub API client (search + quote fallback)
    history.ts                     # Yahoo Finance v8 históricos + calculateReturn + calculateMultiReturns (1 serie 1Y → 5 periodos)
    peer-taxonomy.ts               # STATIC_PEERS map + computeInitialPeers() + scoring con boost de categoría Morningstar
    morningstar-categories.ts      # MS_GLOBAL_CATEGORY (MS→global) + MS→clasificación; compartido finnhub/peer-taxonomy
  utils/
    cn.ts                          # clsx + tailwind-merge
    formatters.ts                  # formatCurrency, formatPercent, formatMarketCap, etc.
types/index.ts                     # AssetType, MetricKey, Profile, Watchlist, WatchlistAsset,
                                   # QuoteData, HistoricalDataPoint, WatchlistShare,
                                   # FlashState, MetricDefinition, METRIC_DEFINITIONS
supabase/schema.sql                # DDL completo + RLS + triggers + funciones seed
scripts/
  diagnose.mjs                     # node scripts/diagnose.mjs <TICKER> — 3 capas de debug
  inspect-asset.mjs                # Inspección de metadata + peers de un activo
  refresh-news.mjs                 # Expira el brief vigente + dispara el pipeline (default localhost:3000)
  check-llm.mjs                    # Verifica conectividad de la cadena LLM (Gemini/Groq/Cerebras)
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
CRON_SECRET=                     # Header Authorization para el cron de Vercel (/api/cron/news-pipeline)
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
```

## Notas de arquitectura
- Caché de precios en Supabase `price_cache` (no en memoria) — serverless-safe
- TTL precios: 60s. TTL fundamentals: 24h (`fundamentals_fetched_at` timestamptz)
- `price_cache.currency` se puebla desde `meta.currency` de Yahoo Finance v8
- **Yahoo Finance v10 requiere auth**: Node.js no puede obtener crumb/cookies (Yahoo envía >16KB headers → `HPE_HEADER_OVERFLOW`). Por eso se usa `yahoo-finance2`.
- Los históricos de Yahoo Finance llevan `User-Agent: Mozilla/5.0` para evitar 403
- Los retornos YTD usan `range=ytd` de Yahoo (calcula último día hábil del año anterior automáticamente)
- **Conversión USD**: `useFxData` obtiene spot rates vía `/api/market/quote` (pares como `GBPUSD=X`) y period returns vía `/api/market/history`. GBX (peniques) usa `GBPUSD=X ÷ 100`. Fórmula retornos: `(1 + local%) × (1 + fx_period%) − 1`
- **Watchlists por defecto** (3): First Trust, Evolve Universe, Pershing Square — sembradas vía trigger `on_profile_created_seed_watchlists`. Backfill manual: `SELECT seed_<name>_watchlist(id) FROM profiles`
- **CT funds tickers**: `0P0000NCAC` (Global Tech), `0P00000R12.L` (Japan), `0P00000R0U.L` (European), `0P0001CZXM.L` (Global Focus), `0P00000XBQ.L` (North American) — tickers internos Yahoo Finance para fondos sin cotización directa
- **Peer taxonomy** (`lib/market/peer-taxonomy.ts`): mapa estático `STATIC_PEERS` curado para todos los activos de las 3 watchlists. `computeInitialPeers(selectedAsset, allAssets, { categories })` lo consulta primero (override exacto); si no hay entrada, cae al scoring algorítmico (`scorePeerSimilarity`) sobre el catálogo `TAXONOMY`. El scoring suma un **boost por categoría Morningstar** (misma `morningstarCategory` +25, misma `globalCategory` +12) cuando ambos lados la conocen; `classifyFromMetadata` usa la categoría Morningstar como señal primaria. El mapa `MS_CATEGORY_TO_CLASSIFICATION` (en `peer-taxonomy.ts`) traduce categoría→strategy/universe/etc. Las `categories` (ticker→{morningstar,global}) se inyectan desde `price_cache`
- **Filtro inline de watchlist**: input "Filter list…" en toolbar de `WatchlistTable` — filtra por ticker/nombre en tiempo real sin afectar precios ni modal
- **Ordenar por métrica**: columnas numéricas tienen `sortingFn` personalizado que extrae el valor numérico respetando toggles USD/Ann. `numSort` envía nulls al fondo. Columnas `helper.display()` necesitan `sortingFn` explícito; CCY y actions tienen `enableSorting: false`
- **Compartir watchlists**: `WatchlistManager` muestra Share2 (hover). Dialog resuelve email → `user_id` vía `/api/users/find`, inserta en `watchlist_shares`. El destinatario ve la lista con icono `Users` + subtexto `de @username`. Puede dejar de seguir (DELETE donde `shared_with_user_id = currentUserId`). PostgREST devuelve join de `profiles` como array — usar `share.profiles?.[0]?.email`
- **Top/Bottom performers** (`useTopPerformers.ts`): `useAllWatchlistTickers` carga todos los tickers del usuario vía Supabase (join `watchlist_assets` + `assets_metadata`). Luego `/api/market/history` por período para calcular retornos y ordenar
- **Beating Peers** (`/vs-peers`, `usePeerComparison.ts` + `PeerComparison`/`PeerCard`): por cada activo del usuario muestra en cuántas de **6 métricas** (1D/1W/1M/6M/YTD/1Y) le gana a sus peers. Un periodo se cuenta como **ganado si supera al ≥75%** de los peers con dato (`beaten/total ≥ 0.75`; empate NO cuenta como vencido). 1D viene de quotes en vivo; el resto de `/api/market/returns` (POST batch, caché `returns_cache` 6h, `calculateMultiReturns` = 1 serie 1Y → 5 periodos). Todo se normaliza a **USD** con `useFxData` (misma fórmula que Top performers). Se **deduplica la unión** activos∪peers (cada ticker se pide una sola vez). El set de peers por activo se materializa de forma **determinista** en `/api/peers/init` (categorías SIEMPRE desde `price_cache`, no del caller) y se persiste en `user_asset_peers`; el modal y la página comparten ese set (curación con `usePeerSet`). ⚠️ Checkpoint conocido: la ventana del retorno del activo (por-fecha) y la del FX period return (`range=` de Yahoo) pueden desfasar levemente en activos no-USD
- **FundamentalsPanel**: panel bento premium con `NumberTicker` (Framer Motion spring) para animar métricas. Tooltips de información con posición `fixed` para evitar clipping en contenedores `overflow-y-auto`
- **PriceMarquee**: marquee header con tickers globales fijos (SPY, QQQ, IWM, GLD, TLT, BND, DX-Y.NYB, CL=F, GC=F, BTC-USD) — polling independiente de las watchlists del usuario

### Sección de noticias (Market Brief)
- **Pipeline** (`lib/ai/news-pipeline.ts`, orquestado en `app/api/cron/news-pipeline/route.ts`): `enrichAssetProfiles` → `searchNews` (Tavily) → `rankCandidates` (pre-ranking determinista) → `selectTop7` (selección LLM) → `extractContent` (Firecrawl) → `analyzeAndSynthesize` (análisis/scoring LLM) → `matchAffectedSymbols` (matching determinista) → `selectFinalArticles` → insert en `market_briefs` + `market_news`
- **Cron**: Vercel dispara el POST con `Authorization: Bearer CRON_SECRET` los **Lun/Vie 13:00 UTC** (07:00 MX). Guard anti-doble-ejecución: salta si ya hay un brief `generating` o `ready` aún válido. `computeValidUntil()` fija la vigencia (Lun→Vie, Vie→Lun)
- **Lectura**: `GET /api/news/current` (auth) devuelve el brief vigente; si no hay vigente, sirve el último como `stale: true`. `useNewsBrief` lo consume; `NewsBlock` renderiza `WeeklyBriefCard` + grid de `NewsCard`
- **Cadena LLM** (`lib/ai/llm.ts`): `callLLM({ role })` recorre `NEWS_LLM_CHAIN` (default `gemini,groq,cerebras`); un proveedor sin API key se salta solo; reintentos con backoff ante 429/503/timeout. Modelos DISTINTOS para `analysis` vs `selection` (no compiten por TPM). `extractJson`/`sanitizeJsonString` parsean salidas sucias sin depender del modo JSON del proveedor
- **Relevancia de portafolio = 100% DETERMINISTA** (el LLM ya NO adivina `affected_tickers`): **Fase A** `enrichAssetProfiles` enriquece cada activo UNA vez (cacheado en `assets_metadata.relevance_profile`) con señales estables (entities, themes, geography, issuer); perfiles "pobres" (sin entities ni themes) NO se cachean → reintentan. **Fase B** `matchAffectedSymbols` cruza esos perfiles contra `title + full_text_md` con guardas estrictas (entity preferido; ticker literal solo con `\b` + MAYÚSCULAS o cashtag `$XXX`, nunca substring/case-insensitive; themes solo corroboran). Índices (`type='index'`) NO generan badge 🎯. `affected_tickers` (text[]) se deriva de `affected_symbols` para no romper frontend ni el índice GIN
- **Badge 🎯 multi-tenant**: se calcula en cliente (`NewsCard` filtra `affected_tickers` contra los tickers de la watchlist activa del usuario) — la misma fila de `market_news` muestra/oculta el badge por usuario
- **Scoring**: 5 dimensiones 0–5 (`macro_impact`, `surprise_factor`, `market_relevance`, `forward_implications`, `structural_vs_noise`) + `time_decay` → TOTAL máx 25. `portfolio_relevance` NO suma al total (solo informativo + garantía de inclusión). RATING A(19-25)/B(15-18)/C(11-14)/D(<11); SIGNAL STRONG/MODERATE/WEAK. Few-shot de calibración para reducir varianza. `selectFinalArticles` arma conteo variable 3–7 por umbral de calidad, con garantía de inclusión por portafolio (≥C/score≥11) sin exceder 7
- **FOCO GEOGRÁFICO EE.UU./México**: queries de Tavily, prompt de `selectTop7` y rubric de `analyzeAndSynthesize` priorizan Fed/macro de EE.UU., Banxico/peso, gobierno/empresas de EE.UU. y temas globales que mueven esos mercados (petróleo, geopolítica, grandes tecnológicas, treasuries). DESPRIORIZA fuerte decisiones de bancos centrales/política doméstica de OTROS países (Sudáfrica, Corea, etc.) salvo contagio claro a EE.UU./México descrito en el texto (`market_relevance`/`macro_impact` ≤2 en esos casos)
- **NO REDUNDANCIA** (regla en `selectTop7`): agrupa noticias del MISMO evento/sub-tema (p.ej. varias declaraciones de funcionarios de la Fed la misma semana = UN tema) y elige solo la MEJOR de cada grupo; una 2ª del mismo tema solo si aporta un ángulo nuevo (dato/postura opuesta/consecuencia distinta). Prefiere cobertura amplia sobre profundizar en un solo tema
- **Redacción** (`analyzeAndSynthesize`): `summary`/`insight` en español, neutral; prohibido inventar cifras (si el artículo no da el número, descríbelo cualitativamente); dirección suave permitida, recomendaciones prescriptivas no; lista de frases prohibidas para evitar relleno genérico
- **Disparo manual**: `scripts/refresh-news.mjs` (ver Comandos). Verificación de la cadena LLM: `scripts/check-llm.mjs`
