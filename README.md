# Evolve Dashboard

Dashboard financiero multiusuario SaaS para monitoreo de portafolios globales en tiempo real.

## Stack

- **Framework**: Next.js 16.2.5 — dev con Turbopack, build con Webpack
- **UI**: React 19, TypeScript, Tailwind CSS + shadcn/ui (Radix UI)
- **Tabla**: TanStack Table v8
- **Data fetching**: TanStack Query v5 (polling 5s para precios)
- **Auth + DB**: Supabase (RLS, SSR cookies vía `@supabase/ssr`)
- **Precios**: Yahoo Finance v8 REST (sin API key)
- **Fundamentals**: `yahoo-finance2` v3 (maneja crumb/cookies automáticamente)
- **Históricos**: Yahoo Finance v8 REST
- **Noticias**: Tavily (búsqueda) + Firecrawl (extracción) + cadena LLM Gemini→Groq→Cerebras
- **Animaciones**: Framer Motion (shared-element, ValuePulse, count-up, stagger — sistema en `lib/motion-tokens.ts` + `lib/motion-client.ts`)
- **Charts**: Recharts
- **PWA**: Serwist (service worker)

## Funcionalidades

- **Overview** — dashboard agregado al entrar: KPIs de mejor/peor performer, cuántos activos "beating peers", snapshot de mercado en tiempo real y teaser del Market Brief; con enlaces "Ver todo" a cada sección
- **Onboarding** — tour guiado automático la primera vez (spotlight interactivo paso a paso); se persiste en el perfil del usuario y no vuelve a aparecer
- **Watchlists** por usuario con categorías y orden personalizable
- **Precios en tiempo real** con flash verde/rojo al cambio (polling 5s)
- **Marquee header** con índices y commodities globales (SPY, QQQ, BTC, GLD, etc.)
- **Columnas configurables**: precio, retornos (1D/1W/1M/6M/YTD/1Y/3Y/5Y/10Y/MAX), market cap, P/E, beta, AUM, expense ratio, dividend yield. Reordénalas con flechas ↑↓ desde el popover "Columns"; al añadir una métrica entra en su lugar cronológico y "Sort by time" reordena todo. El orden persiste por watchlist
- **Anualizar retornos** (toggle "Ann.") — CAGR para períodos ≥1Y con años nominales fijos (el orden del ranking no cambia al anualizar)
- **Convertir a USD** (toggle "USD") — precio, AUM, mkt cap y retornos usando FX en tiempo real
- **Columna CCY** — moneda nativa de cada activo
- **Filtro inline** — busca por ticker o nombre dentro de la watchlist
- **Ordenar por métrica** — click en cualquier cabecera; nulls siempre al fondo; respeta Ann. y USD
- **Compartir watchlists** — por email; el destinatario ve la lista (solo lectura) con `de @usuario`; puede dejar de seguirla. Opción **"Team Evolve"**: comparte de un golpe con todos los miembros del equipo (perfiles con `is_team_evolve=true`); el alta de cuentas y el flag se gestionan fuera de la app con `scripts/manage-team-evolve.mjs`
- **Modal de detalle** — 3 tabs: Summary (gráfico histórico + fundamentals), Calendar Years (retornos por año calendario desde 2019), Peers (comparativa BarChart + tabla editable)
- **Top 10 / Bottom 10** — vistas dedicadas de mejores y peores performers por período
- **Beating Peers** — por cada activo de tus watchlists, en cuántas de 6 métricas (1D/1W/1M/6M/YTD/1Y) le gana a sus peers (gana un periodo si supera al ≥75% de los peers con dato), con detalle de a cuántos y a cuáles. Al expandir un período se ve el retorno (en USD) del activo y de cada peer, por cuántos puntos porcentuales le gana o le pierde a cada uno, y una mini-barra de contexto que ubica cada retorno dentro del rango del grupo. El denominador mostrado es siempre el total de peers asignados (constante entre períodos). Incluye filtro de relevancia (mostrar solo activos que ganan ≥N de 6 períodos) y buscador por ticker/nombre. Retornos en USD. Peers auto-sugeridos deterministas (STATIC_PEERS exactos como override + scoring con categoría Morningstar/sector/geo), editables desde el modal y persistidos por usuario. **Display por tipo**: fondos (mutual funds) muestran nombre en el header y en filas (sin ISIN/ticker críptico); ETFs muestran ticker + nombre real (backfilled automáticamente desde Yahoo Finance)
- **Comparar (ETF Comparison)** — comparador de activos lado a lado inspirado en ETF.com: agrega hasta varios ETFs/fondos/acciones/índices (el primero fija el grupo; ETFs e índices se comparan entre sí, fondos y acciones por separado) y compáralos en Overview (emisor, expense ratio, AUM, inception, categoría), Performance (gráfico "Crecimiento de $10,000", retornos acumulados 1M/6M/YTD/1Y/3Y/5Y y retornos por año calendario), Holdings (donut de top-10 + barras por sector) y Risk & Dividends (beta, std dev, sharpe, alpha, dividend yield). Estado compartible en la URL (`?tickers=...`), toggle "Resaltar diferencias" que marca el mejor valor por métrica, y fetch optimizado (2 llamadas batched + N series, con cola de concurrencia) para no saturar Yahoo
- **Market Brief (noticias)** — brief de mercado generado por IA dos veces por semana: resumen semanal (tema dominante, riesgo clave, qué vigilar) + tarjetas de noticias con señal (STRONG/MODERATE/WEAK), score 0–25, análisis y artículo completo legible. Foco geográfico EE.UU./México, sin redundancia temática, y badge 🎯 cuando la noticia toca un activo de tu watchlist
- **Buscador global ⌘K** — command palette (⌘K / Ctrl+K) para navegar entre páginas y buscar tickers desde cualquier pantalla
- **Login "Transforming Investments"** — fondo vivo de "profundidad de mercado" en Canvas 2D (barras que divergen de una baseline de retornos y se iluminan bajo el cursor) + logo oficial circle-"e" como medallón 3D girando (EvolveLogo3D) + narrativa scroll que cuenta el producto. Top bar minimalista (estilo Lovable) con botones que abren el formulario en un dialog; siempre en tema oscuro
- **Tema claro/oscuro co-protagonistas** con toggle — identidad **"Evolve Signal"**: grafito frío aireado por capas en dark, "cool paper" institucional en light (ambos AA); acento de marca cian-teal; paleta de charts adaptativa (navy→teal→sky)
- **Movimiento premium** — shared-element al abrir el modal, pulso de valor cuando un precio live cambia, contadores count-up, transiciones de página, reveals escalonados, indicador "● Live", toasts y skeletons con shimmer; todo respeta `prefers-reduced-motion`

## Watchlists por defecto

Todos los usuarios nuevos reciben automáticamente (vía trigger Supabase):

| Watchlist | Descripción |
|---|---|
| **First Trust** | ETFs First Trust seleccionados |
| **Evolve Universe** | Benchmarks y fondos globales (US, Small Caps, Tech, Japan, Europa, EM, China) |
| **Pershing Square** | Holdings del portafolio Pershing Square |

## Setup

### 1. Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # empieza con eyJ
FINNHUB_API_KEY=             # 'your-finnhub-api-key' activa modo mock

# Pipeline de noticias (Market Brief)
TAVILY_API_KEY=              # búsqueda de noticias
FIRECRAWL_API_KEY=           # extracción del artículo completo
FIRECRAWL_API_KEY_2=         # respaldo: se usa si la primaria se queda sin créditos
CRON_SECRET=                 # Bearer del trigger HTTP manual/respaldo (/api/cron/news-pipeline); el automático es GitHub Actions y no lo usa
NEWS_LLM_CHAIN=gemini,groq,cerebras   # cadena de fallback LLM (default)
GEMINI_API_KEY=              # principal: Gemini 2.5 Flash (free, 1M ctx)
OLLAMA_API_URL=https://api.groq.com/openai   # fallback 1: Groq
OLLAMA_API_KEY=
CEREBRAS_API_KEY=            # fallback 2: Cerebras (free)
```

> Ver `CLAUDE.md` para la lista completa de variables del LLM (modelos por rol, etc.).

### 2. Base de datos

Corre `supabase/schema.sql` completo en el SQL Editor de Supabase. Incluye DDL, RLS, triggers de seed y migraciones (columnas `source`/`peer_of` en `watchlist_assets`, curación en `user_asset_peers`, `country` en `price_cache`, `onboarding_seen` e `is_team_evolve` en `profiles`).

> El trigger chain de alta de usuarios (`auth.users` → `profiles` → seed de las 3 watchlists) es frágil: si una función seed falla, **toda la creación del usuario aborta**. Diagnóstico en `scripts/diagnose-seed.sql` y fix en `scripts/fix-seed-trigger.sql` (ver `CLAUDE.md` para los modos de fallo conocidos).

### 3. Desarrollo

```bash
npm install
npm run dev    # Turbopack dev server
npm run build  # TypeScript check + build
```

## Arquitectura

### API Routes

```
app/api/market/
  quote/    → precios + fundamentals (cache 60s/24h en price_cache); backfill name+type en assets_metadata (ignoreDuplicates)
  history/  → retornos históricos + FX period returns
  returns/  → POST batch: retornos multi-periodo (1W/1M/6M/YTD/1Y) con caché returns_cache (TTL 6h) + fallback a último-bueno ante fallo transitorio de Yahoo
  search/   → búsqueda de tickers
  export/   → export CSV de watchlist
app/api/peers/
  init/     → POST: materializa (determinista) el set inicial de peers por usuario/activo
app/api/users/
  find/     → resuelve email → user_id (service role, para compartir)
app/api/news/
  current/  → brief vigente (o último como stale) + market_news (auth)
app/api/cron/
  news-pipeline/  → POST (Bearer CRON_SECRET) — trigger HTTP manual/respaldo; llama runNewsPipeline() (el automático es GitHub Actions)
```

> El trigger automático del brief es **GitHub Actions** (`.github/workflows/news-pipeline.yml` → `npx tsx scripts/run-news-pipeline.ts`), no Vercel Cron — el plan Hobby mataba el cron a los 60s. La orquestación vive en `runNewsPipeline()` (compartida por el runner y la route HTTP de respaldo).

### Hooks

```
useRealtimePrices.ts        → polling 5s + flashStates (up/down 1.5s)
usePerformanceMetrics.ts    → retornos históricos 1D→MAX
useFxData.ts                → spot FX rates (1-min) + period returns (5-min)
useWatchlistAssets.ts       → CRUD watchlists + sharing (incluye source/peer_of)
useTopPerformers.ts         → rankings top/bottom (solo source='user'); anualiza con años nominales fijos → orden estable
usePeerComparison.ts        → Beating Peers: won/lost/insufficient, normalizado USD; denominador = peers asignados (constante); expone retorno USD (peerReturns), nombre (peerNames) y tipo (peerTypes) por peer; nombre vía assets_metadata → quote en vivo → ticker
usePeerSet.ts               → add→pinned, remove→removed; STATIC_PEERS inalterables
useCalendarYearReturns.ts   → retornos CY2019..actual (mode=calYear, staleTime 6h)
useNewsBrief.ts             → brief vigente + market_news
useCompareTickers.ts        → tickers del comparador en la URL (?tickers=); add/remove/reset, uppercase/dedup/cap
useEtfComparison.ts         → orquesta quotes (useRealtimePrices) + N series 5Y (useQueries, cola ≤4); deriva trailing (acumulado) + anuales (= Yahoo) client-side
```

### Componentes clave

```
OverviewDashboard.tsx  → dashboard agregado (KPIs, snapshot, leaderboards, brief)
DashboardShell.tsx     → layout: sidebar (EvolveGlyph oficial + disparador ⌘K), nav, PriceMarquee, CommandPalette (data-tour attrs)
WatchlistTable.tsx     → TanStack Table: sort, filter, flash, modal, toggle auto-peers
AssetDetailModal.tsx   → Tabs: Summary (AreaChart) · Calendar Years · Peers
FundamentalsPanel.tsx  → bento grid con NumberTicker animado (import externo)
NumberTicker.tsx       → contador Framer Motion spring (extraído)
SegmentedControl.tsx   → selector pill multi-opción
PageHeader.tsx         → cabecera editorial reutilizable
EmptyState.tsx         → estado vacío con CTA
StatCard.tsx           → tarjeta de KPI con Tooltip
PeerComparison.tsx     → lista ordenada por métricas ganadas + toolbar (filtro ≥N/6 + buscador)
PeerCard.tsx           → won/lost/insufficient + filas por periodo; fondos muestran nombre-solo (sin ticker), ETFs muestran ticker+nombre real; panel expandido (motion): retorno del activo + cada peer, delta pp, ✓/✗ 1-a-1, mini-barra de contexto
etf-compare/           → módulo Comparar: EtfCompare (orquesta tabs + type-lock), CompareTickerBar, CompareHero, CompareMetricsTable (transpuesta + resaltar diferencias), CompareGrowthChart, CompareAnnualReturns, CompareHoldings; compare-utils (compareSeriesColor reordena --chart-1..8 sin tocarla)
```

### Sistema de diseño

Identidad **"Evolve Signal" — inteligencia financiera, viva**: SaaS financiero moderno/institucional/elegante (vibe Stripe/Linear/Mercury), **no una terminal de trading**. Ligero, aireado y por capas; **light y dark son co-protagonistas** (mismo nivel de detalle y AA en ambos). Base de grafito frío por capas (dark) o "cool paper" institucional (light), con escalera de elevación visible (fondo ≠ card ≠ elevado). Acento de marca **cian-teal "signal"** (`--electric`) para lo vivo/interactivo (acciones primarias, Live, focus, glow del logo). Cromo neutro **"mist"** (`--bone`, plata fría) para bordes/hover/hairlines. Aliases Tailwind `signal`/`mist` (se conservan `spark`/`bone` apuntando al mismo token). Charts: las series (`--chart-1..8`) son dato e intocables; solo se recolorearon a frío los neutrales que las rodean. Capa de verdad financiera preservada (`gain`/`loss`, flash, heartbeat realtime).

La identidad se aplica redefiniendo los **valores** de las CSS vars (mismos nombres → cascada a toda la app). Cada vista tiene un acento/kicker propio vía `PageHeader` (`eyebrow` + `accent`). La marca oficial circle-"e" (`EvolveGlyph`, geometría compartida) vive en sidebar/header y se extruye en 3D para el hero del login (`EvolveLogo3D`); `EvolveMark` (nodos) queda para empty states y loader. `.theme-dark` es una clase de scope que fuerza dark (login always-dark; también re-scopea el dialog de auth que portalea fuera del wrapper).

```
app/globals.css           → tokens CSS (:root/.theme-dark dark + .light); utilidades .glass/.ambient-grid/.spotlight-accent
lib/chart-theme.ts        → useChartTheme(): paleta reactiva al tema para Recharts
lib/asset-style.ts        → typeBadgeClass()/typeLabel(): badges centralizados (stock/etf/fund → neutro)
lib/market/benchmarks.ts  → BENCHMARK_TICKERS/LABELS para marquee y Overview
lib/motion-tokens.ts      → constantes/variants de motion PURAS (fadeUp/fadeBlur/scaleIn/stagger, SPRING_CURSOR; importables desde Server Components)
lib/motion-client.ts      → 'use client': usePulseOnChange + <ValuePulse> (pulso al cambiar precio live)
lib/watchlist-table-style.ts → helpers de estilo de tabla (colClass/pillClass/min-widths anti-jitter)
components/brand/EvolveGlyph.tsx    → marca oficial circle-"e" plana; FUENTE ÚNICA de la geometría (sidebar/header + base del hero 3D)
components/brand/EvolveLogo3D.tsx   → logo oficial extruido en CSS 3D (medallón girando) — hero del login
components/brand/EvolveMark.tsx     → marca viva de nodos (logo + EvolveLoader), para empty states/loader
components/auth/MarketDepthField.tsx → fondo vivo del login (Canvas 2D nativo: profundidad de mercado, reactivo al cursor)
components/auth/scenes/             → escenas presentacionales de la narrativa del login (datos scripted, sin red)
components/dashboard/CommandPalette.tsx → buscador global ⌘K (navegar + buscar tickers)
components/dashboard/LiveIndicator.tsx  → indicador "● Live" único
components/ui/card.tsx    → Card, CardHeader, CardTitle, CardContent, CardFooter
components/ui/tabs.tsx    → Tabs in-house con teclado (sin @radix-ui/react-tabs)
components/ui/tooltip.tsx → Tooltip sobre Radix Popover (sin nueva dep)
components/ui/toast.tsx   → ToastProvider + useToast() (aria-live, auto-dismiss, glass)
components/ui/skeleton.tsx → Skeleton con shimmer
components/dashboard/PageTransition.tsx → cross-fade de ruta dentro de <main>
components/onboarding/    → TourProvider + TourSpotlight (tour guiado)
```

**Movimiento** (Framer Motion, sin deps nuevas, todo gateado por `prefers-reduced-motion`): shared-element fila→modal (`layoutId`), "el tablero late con el mercado" (`<ValuePulse>` en precios live a 5s de tabla/snapshot/modal), count-up `NumberTicker` (`startOnView`), transición de página, reveals con stagger, hero 3D del logo en turntable (CSS 3D, sin dep) y el fondo de profundidad de mercado del login (Canvas 2D, 1 rAF con pausa fuera de viewport). El flash CSS verde/rojo (`PriceCell`/`AnimatedPrice`) permanece intacto.

### Pipeline de noticias (Market Brief)

Genera el brief dos veces por semana (**GitHub Actions**, Lun/Vie 13:00 UTC / 07:00 MX — reemplazó al Vercel Cron, que moría a los 60s en el plan Hobby). El workflow corre `npx tsx scripts/run-news-pipeline.ts`, que invoca `runNewsPipeline()` directo (sin HTTP, sin límite de tiempo); `workflow_dispatch` permite disparo manual desde la pestaña Actions. La route `/api/cron/news-pipeline` (Bearer `CRON_SECRET`) queda como trigger HTTP de respaldo y llama al mismo `runNewsPipeline()`. El guard anti-doble-ejecución tiene cota temporal y auto-recupera briefs atascados en `generating` >15 min (un run matado ya no bloquea las ejecuciones siguientes); logging con prefijo `[news-cron]`. Flujo:

```
enrichAssetProfiles → searchNews (Tavily) → rankCandidates (cuotas por categoría) →
selectTop7 (LLM) → extractContent (Firecrawl) → analyzeAndSynthesize (LLM, +core_event_tag) →
matchAffectedSymbols (determinista) → selectFinalArticles (dedup dura por evento) →
market_briefs + market_news
```

**Diversidad (anti-cámara-de-eco):** un macro-evento grande (p.ej. una decisión de la Fed) tiende a copar el brief porque todas sus notas reciben un score altísimo. Dos defensas combinadas: (1) **cuotas en el pre-ranking** — `rankCandidates` reparte candidatos en round-robin por categoría (Fed, México, geopolítica, portafolio, tecnología), garantizando un pool diverso para el LLM; (2) **deduplicación semántica dura** — el análisis emite un `core_event_tag` canónico por noticia y `selectFinalArticles` colapsa las del mismo suceso (conserva la de mayor score) antes de la selección final, liberando espacio para otros sectores.

```
lib/ai/news-pipeline.ts    → pipeline completo (búsqueda, selección, análisis, scoring)
lib/ai/asset-enrichment.ts → relevancia de portafolio 100% determinista (sin que el LLM adivine)
lib/ai/llm.ts              → callLLM con cadena de fallback (Gemini → Groq → Cerebras)
lib/ai/source-authority.ts → autoridad de fuente para el pre-ranking
```

Características: selección por **importancia de mercado** (no por score de búsqueda), **foco geográfico EE.UU./México**, **diversidad forzada** (cuotas por categoría + dedup dura por `core_event_tag`, sin redundancia temática), relevancia de portafolio **determinista** (badge 🎯 calculado por usuario), scoring de 5 dimensiones (máx 25) con calibración few-shot, y redacción neutral en español sin cifras inventadas.

## Diagnóstico

```bash
node scripts/diagnose.mjs <TICKER>      # 3 capas: HTTP, paths JSON de Yahoo, API route interna
node scripts/refresh-news.mjs           # regenera el brief ahora vía HTTP (necesita npm run dev corriendo)
npx tsx scripts/run-news-pipeline.ts    # corre el pipeline standalone (igual que GitHub Actions); lee .env.local
node scripts/check-cron.mjs             # estado del brief + dispara la route + últimos market_briefs en Supabase
node scripts/check-llm.mjs              # verifica la cadena LLM (Gemini/Groq/Cerebras)
node scripts/manage-team-evolve.mjs     # alta de cuentas Supabase + flag is_team_evolve (Team Evolve)
```

> Trigger chain de alta de usuarios: `scripts/diagnose-seed.sql` (diagnóstico) y `scripts/fix-seed-trigger.sql` (fix con verificación ROLLBACK) — correr por bloques en el SQL Editor de Supabase.
