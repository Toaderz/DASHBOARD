# Plan de remediación v2 — Auditoría de seguridad Evolve Dashboard

## Workflow de ejecución multiagente

Modelo: **olas de agentes en paralelo con propiedad de archivos disjunta y una compuerta de integración entre olas.** No uso el orquestador de workflows en background porque las compuertas reales de este repo (`npm`, `next build`, `git commit`) son recursos de un solo escritor: los serializo yo entre olas y verifico antes de dejar avanzar.

### Estado verificado del entorno (condiciona el alcance)

| Hecho | Consecuencia |
|---|---|
| `node_modules` **ausente** | Ola 0 empieza por `npm ci` limpio; el baseline de `tsc`/`build` se mide antes de tocar nada |
| Registry alcanzable, `next@16.3.5` = latest | §A ejecutable tal cual |
| **CLI de Supabase ausente** (y sin proyecto linkeado) | `db pull` / `migration repair` / `db reset` / `db diff --linked` **no corren aquí**. Entrego los `.sql` + runbook; los corres tú |
| Sin credenciales de prod en el entorno | Smoke tests de login/refresh, corrida real del pipeline de noticias y verificación de `/vs-peers` en preview quedan como checklist para ti |

### Reglas de concurrencia (no negociables)

1. **Un solo agente posee `npm`/lockfile a la vez.** Nadie más instala ni audita en paralelo.
2. **Nadie corre `next build`** salvo yo, en las compuertas (un solo `.next`).
3. **Propiedad de archivos disjunta, declarada antes de lanzar la ola.** Si dos tareas necesitan el mismo archivo, la ola las separa o una sola las hace.
4. **Ningún agente commitea ni hace push.** Commiteo yo en cada compuerta (evita carreras de índice y deja un commit por unidad, revertible).
5. Ningún agente lee `.env*` ni corre el CLI de Supabase.

### Olas

**Ola 0 — baseline + PR0 (yo).** `npm ci`, `tsc --noEmit`, `npm run build` con el árbol actual → sin esto, cualquier fallo posterior es inatribuible. Más los artefactos de PR0 que no necesitan el CLI: `npm audit --json` / `npm ls` / `npm explain` por paquete vulnerable, matriz de permisos de funciones, matriz de ownership por columna, inventario de invariantes, plan de rollback, runbook de las órdenes de Supabase que corres tú, y `docs/PLAN-REMEDIACION-SEGURIDAD.md` (lo pediste explícitamente). → commit PR0.

**Ola 1 — PR1 dependencias (1 agente, dueño exclusivo de `npm`).** Los 6 upgrades de padre de §A, cero overrides, tabla de residual, y el dictamen sobre si el SDK de `firecrawl@4.40.0` propaga `AbortSignal` hasta axios (insumo que la ola 2 necesita). Compuerta: `npm ls next` ≥16.3.5, `npm audit` 0 critical, `tsc`, `build`. → commit PR1.

**Ola 2 — 3 agentes en paralelo, disjuntos.**
- **B1 · PR2 foundations** — dueño de `lib/supabase/service-role.ts` (nuevo), `lib/market/validation.ts` (nuevo), `lib/utils/concurrency.ts` (nuevo), las 5 copias de `getAdminClient` (incluye `peers/init:322`, que es A-14), `lib/market/history.ts`, `lib/market/finnhub.ts`, `app/api/market/{quote,returns}/route.ts`, `app/api/cron/news-pipeline/route.ts`, y el runner de tests + unitarios.
- **B2 · PR4 base de datos** — dueño de `supabase/migrations/002…006*.sql`, `scripts/verify-seed.sql`, `.github/workflows/db-migrations.yml`, `components/dashboard/WatchlistView.tsx` (normalización de ticker) y la ruta nueva `share-team`. **No toca** `peers/init` (es de B1).
- **B3 · PR5 noticias/LLM** — dueño de `lib/ai/news-pipeline.ts` y `lib/ai/llm.ts`.

Compuerta: `tsc`, `build`, unitarios, y **un agente revisor independiente** que audita el diff de la ola contra los invariantes de PR0. → commits PR2, PR4, PR5.

**Ola 3 — 2 agentes.** **C1 · PR3 auth** (`lib/auth/require-user.ts` nuevo, las 4 rutas de market sobre el refactor de B1, borrar `export/route.ts`, `history` 400, manejo de 401→`signOut`, tests negativos de auth: 401 ⇒ *cero* llamadas a Yahoo y *cero* escrituras). **C2 · PR7 plataforma** (`next.config.ts` headers fase A + `remotePatterns`, actions a SHA + `permissions`, `ci.yml`, `eslint.config.mjs`, scripts `lint`/`typecheck`/`test` en `package.json`). Disjuntos. Compuerta + revisor. → commits PR3, PR7.

**Ola 4 — 2 agentes.** **D1 · PR6 performance** (periodos parametrizables en `returns`, migración de `usePerformanceMetrics`/`useTopPerformers` al POST bulk, lease de trabajo en vuelo, A-3/A-5/A-6, estado explícito en vez de `[]`). **D2 · PR8 corrección financiera** (golden fixtures + tests de funciones puras + re-derivación de `score`/`rating`/`signal` en servidor). Corren en paralelo porque D2 vive en archivos de test: **los golden de D2 son la compuerta de D1** — "cifras financieras idénticas" se demuestra, no se supone. → commits PR6, PR8.

**Ola 5 — cierre (yo).** Build completo, suite entera, pase de `security-review` sobre el diff acumulado, push a `claude/security-audit-plan-xna7ct`, y reporte honesto separando *verificado aquí* de *pendiente en tu máquina* (migraciones, smoke tests con credenciales, preview de `/vs-peers`). Sin PR salvo que lo pidas.

### Qué hace fallar la ejecución (criterio de parada)

Si una compuerta se pone roja y el arreglo no es local al diff de esa ola, **paro y te lo digo** en vez de ensanchar el cambio. Y si el revisor encuentra que un PR alteró una cifra financiera antes de PR8, se revierte ese commit: es el invariante que la revisión crítica pone por encima de todo.

---

## Context

Dos documentos previos: la auditoría de seguridad (24 hallazgos) y la revisión crítica del plan v1. Verifiqué la auditoría contra el código (resultado: sustancialmente real, con 2 recomendaciones peligrosas y 16 hallazgos que no cubría) y ahora incorporo la revisión crítica.

**La revisión tiene razón en lo esencial y acepto sus 12 cambios obligatorios.** Su tesis — que a estas alturas el riesgo mayor ya no es encontrar otra vulnerabilidad sino *introducir una regresión al corregir seguridad* — es correcta, y reordena el plan de "lista de vulnerabilidades" a "sistema con invariantes que hay que demostrar que no se rompen".

Al verificar dos de sus puntos encontré que la conclusión correcta es **más fuerte** que lo que propone (§A y §B abajo). Y hay tres correcciones factuales menores.

Alcance: P0–P4, auth sin rate limiting inmediato, `yahoo-finance2` en 3.x, `export` se borra, polling en 5 s.
Rama: `claude/security-audit-plan-xna7ct`.

---

## A. Dependencias: aplicar su procedimiento elimina los 9 overrides

La revisión (§4) exige verificar cada override individualmente, con orden de preferencia `upgrade parent → override compatible → replace → aceptar riesgo`. **Lo hice, y el resultado es cero overrides.** Mi bloque v1 era perezoso y, en un caso, activamente peligroso:

| Vulnerable | Mi override v1 | Realidad verificada |
|---|---|---|
| `postcss` | `^8.5.28` | ⚠️ **`next` lo pinea exacto** (`8.4.31` hoy). El override habría forzado al bundler de Next contra una versión que nunca probó — exactamente el riesgo que advierte §4. Innecesario: **`next@16.3.5` ya pinea `postcss: 8.5.23`**, que está parcheado |
| `sharp` | `^0.35.4` | Innecesario: `next@16.3.5` ya pide `sharp: ^0.35.4` |
| `nanoid` | `^3.3.19` | Innecesario: entra vía `postcss`, que sube con Next |
| `browserslist` | `^4.29.0` | Innecesario: **`@serwist/build@9.5.12` ya no depende de `browserslist`**. (Y el fix que sugería `npm audit` — degradar `@serwist/next` a 9.4.1 — era un major hacia atrás, incorrecto) |
| `axios` | `^1.20.0` | Innecesario vía padres: **todos los advisory ranges topan en `<1.18.0`**, y `firecrawl@4.40.0` pinea `axios 1.18.0`; `@tavily/core@0.7.12` usa `^1.7.7` → resuelve 1.20.0 |
| `form-data` | `^4.0.6` | Innecesario: entra vía `axios` |
| `ws` | `^8.21.3` | Innecesario: **`@supabase/realtime-js@2.116.0` ya no depende de `ws`** |
| `js-yaml` | `^4.3.2` | Build-time (`@eslint/eslintrc`); se resuelve al subir `eslint` |
| `brace-expansion` | `^5.0.12` | Build-time (`glob`); verificar residual tras subir serwist |

**Plan de dependencias resultante — cinco upgrades de padre, ningún override:**

| Paquete | De → A | Qué cierra | Riesgo |
|---|---|---|---|
| `next` + `eslint-config-next` | 16.2.5 → 16.3.5 | 12 advisories (2 RCE críticos, bypass de middleware/proxy) + `postcss` + `sharp` + `nanoid` | Bajo. Peer `react ^19.0.0` ✓ |
| `@serwist/next` + `serwist` | 9.5.11 → 9.5.12 | `browserslist` (por eliminación de la dependencia) | Bajo (patch) |
| `firecrawl` | 4.25.1 → 4.40.0 | Su propio advisory directo + `axios` + `form-data` | ⚠️ **15 minors, en el pipeline de noticias.** Necesita smoke test. Puede además cambiar la superficie del SDK relevante para §21 (AbortSignal) — probablemente a mejor |
| `@tavily/core` | 0.7.3 → 0.7.12 | `axios` | Medio-bajo |
| `@supabase/supabase-js` | 2.105.3 → 2.116.0 | `ws` (por eliminación) | ⚠️ **11 minors, toca auth.** Necesita smoke test de login/refresh |
| `yahoo-finance2` | 3.14.0 → 3.15.4 | Nada (sin advisories) — solo higiene | Bajo, dentro de 3.x |

Residual documentado tras esto: `esbuild` y `brace-expansion` (build-time, low). Verificar con `npm audit` y aceptar explícitamente si siguen.

**Consecuencia para el orden de PRs:** dos de estos upgrades son de riesgo real (`firecrawl`, `supabase-js`). Por eso separo dependencias en su propio PR, en vez de meterlas en "Security foundations" como propone §35 — es justo el "mega PR de infraestructura" que §5 pide evitar, y si algo se rompe quieres un revert de un commit.

---

## B. Migraciones: `db pull` es mejor que escribir el baseline a mano

La revisión (§2) tiene toda la razón en el diagnóstico: mi v1 proponía un baseline que reafirmaba todo el schema **y se corría en prod**, incluyendo `DROP`/`CREATE FUNCTION` condicional sobre las funciones de signup. Que el primer movimiento de seguridad en producción sea una reconstrucción amplia del estado de la DB es inaceptable. Acepto el cambio.

Pero su propuesta (baseline escrito a mano desde `schema.sql`, solo para DBs nuevas) hereda un problema: **el baseline seguiría describiendo lo que `schema.sql` *cree*, no lo que prod *tiene*** — y ese desajuste es precisamente el drift que estamos corrigiendo (6 columnas que el código usa y el schema no define, incluidas 2 sin ni texto de migración).

**Mejor: generar el baseline por introspección de producción.**

```
prod real ──(supabase db pull)──> 001_baseline.sql ──(migration repair --status applied)──> marcado como ya aplicado
                                         │
                                         └─> deltas 002…N, forward-only, pequeñas
```

Ventajas sobre ambas versiones:
- El baseline **es** el snapshot que pide §2, no una transcripción aspiracional.
- **Ninguna DDL del baseline corre nunca en prod** (`migration repair` solo marca el estado en `supabase_migrations.schema_migrations`). Desaparece todo el aparato de `DROP FUNCTION` condicional y el riesgo 42P13.
- `db diff --linked` vacío pasa a ser significativo desde el primer día.
- §34 sale gratis: `schema.sql` se convierte en artefacto generado (`supabase db dump`), no en segunda fuente de verdad.
- Revela el drift real en vez de asumirlo: si prod no tiene `price_cache.currency`, el pull lo demuestra.

Nota práctica: **el CLI de Supabase no está instalado en este entorno**, así que `db pull` / `db reset` los corres tú en local con el proyecto linkeado. Yo preparo los archivos de delta y el script de verificación.

---

## C. Correcciones factuales menores a la revisión

1. **§15 — `profiles` no tiene `display_name`**, tiene `full_name` (columnas reales: `id`, `email`, `full_name`, `avatar_url`, `created_at`). Y en mi diseño el endpoint de Team Evolve hace el *write* completo en servidor y devuelve solo `{count}` — el roster no sale del servidor en absoluto, que es más estricto que la proyección mínima que pides.
2. **§14 — la matriz necesita dos precisiones.** `service_role` **no** necesita EXECUTE en las seeds: la cadena de trigger corre como el *owner* (`postgres`), no como `service_role`. Y `get_shared_watchlist_ids` necesita `authenticated` pero **no** `anon` (no hay acceso anónimo a watchlists). Dejarlo en "según necesidad"/"revisar" invita a conceder de más.
3. **§9 — `import 'server-only'` requiere instalar el paquete.** `next` no lo trae como dependencia (verificado en el lockfile). Es `server-only@0.0.1`, un archivo, cero dependencias — trivial, pero es un paquete nuevo de verdad, a diferencia de `zod`, que ya estaba presente como transitiva de producción.

Y un refuerzo a §7 que conviene explicitar: la duplicación de trabajo en vuelo no es *incidental*, es **garantizada**. Al ordenar `needsFundamentals` por `fundamentals_fetched_at ASC NULLS FIRST` y cortar a 12, dos invocaciones concurrentes eligen **exactamente los mismos 12 tickers**. Sin lease, el polling de 5 s duplica trabajo de forma sistemática.

---

## Verificación de la auditoría original (sin cambios respecto a v1)

### Confirmado tal cual

| ID | Evidencia |
|---|---|
| SEC-01 | `package-lock.json:8203` → `next@16.2.5` |
| SEC-02 | `returns/route.ts` — sin auth; `MAX_TICKERS=1500` (:19); admin client con fallback a anon (:24) |
| SEC-03 | `quote/route.ts` — sin auth; **sin tope de tickers** (:73); `Promise.allSettled` sin pool (:179-200) |
| SEC-04 | `export/route.ts:22-26` `.slice(0,200)` + `Promise.allSettled` sin pool; sin auth |
| SEC-05 | `history/route.ts` — sin auth; `ticker` solo presencia (:13); `year` solo `isNaN` (:19-22). **Cero rate limiting en el repo** |
| SEC-06 | `cron/news-pipeline/route.ts:22` compara con `` `Bearer ${CRON_SECRET}` `` sin verificar existencia → `"Bearer undefined"` autentica. `:32-34` devuelve `String(error)` |
| SEC-07 | 3 funciones `security definer` con `p_user_id`, **sin** chequeo `auth.uid()`, **sin** `REVOKE` (grep: 0) — `schema.sql:238, 444, 538` |
| SEC-08 | `schema.sql:733-735` `using (auth.uid() is not null)`; al ser permisiva se OR-ea con la propia y gana la amplia |
| SEC-09 | No existe `supabase/migrations/`; `schema.sql:737-839` son migraciones comentadas |
| SEC-10 | `llm.ts:35-51` `extractJson` = `JSON.parse` + `as T` |
| SEC-11 | `news-pipeline.ts:662-672` pide `source_url`/`source_name`/`date` al LLM; `:873-902` los inserta |
| SEC-12 | `:605-614` interpola scraping de terceros crudo en el prompt (`:689-690`) |
| SEC-13 | `withTimeout` (:515-520) = `Promise.race` sin `AbortController`; timer nunca se limpia |
| SEC-14 | `users/find/route.ts:21-25` resuelve por `profiles.email`; **sin UNIQUE** (`schema.sql:10`) |
| SEC-15 | `schema.sql:167-168` INSERT con solo `auth.uid() is not null`; writes de navegador en `WatchlistView.tsx:22` y `usePeerSet.ts:146`, **error descartado** |
| SEC-16 | `usePerformanceMetrics.ts:53-80` → `N×(P+CY)` |
| REL-05 | `next.config.ts:8` `hostname: '**'`; cero headers |
| REL-06 | `news-pipeline.yml:21,23` usan `@v4`; sin `permissions:`, con 12 secrets |
| REL-07 | Un workflow, sin lint/typecheck/build. **Cero tests** |
| REL-08 | `history.ts` — toda ruta de fallo devuelve `[]` |

### Subestimados por la auditoría

1. **SEC-01 — 16 paquetes vulnerables, no solo Next.** En `next`: 12 advisories, 2 RCE críticos no autenticados (`GHSA-p293-qw3h-jr36` CVSS 9.0; `GHSA-2xp9-vwfh-vxw4` vía AVIF) y **bypass de middleware/proxy en App Router**, que aplica justo a `proxy.ts`. Cadena real: `remotePatterns: '**'` + RCE del optimizador + `sharp` vulnerable.
2. **SEC-09 — son 6 columnas de drift, no 2.** La peor: `price_cache.currency`, que `quote/route.ts:134` escribe **en el upsert principal** → en DB limpia **todo** upsert de `price_cache` falla con PGRST204 y el error solo se loguea (`:143`): los precios se renderizan pero la caché **jamás** se puebla. Las otras: `profiles.onboarding_seen` (rompe cada carga del dashboard), `profiles.is_team_evolve` (0 ocurrencias en `schema.sql`, ni comentada), `price_cache.inception_date`, `.morningstar_category`, `.global_category`.
3. **SEC-11 — no existe ningún `candidate_id`.** El `source_url` del LLM es la clave de join de todo: `contentMap.get()` (:863), filtro de relevancia (:870), clave de dedup (:440), `sourceAuthority()` (:895). Un carácter de desvío → `full_text_md` null en silencio. El ejemplo del propio prompt usa `"wsj.com"`, dominio que **no está** en `NEWS_SOURCES` y al que `sourceAuthority` da 0.9.
4. **SEC-10 — cero validación de `score`/`rating`/`signal`**, y `score` alimenta aritmética de ordenación (:445, :467, :483).
5. **SEC-13 — hasta ~260 s por URL**: `withTimeout` se aplica **por cliente** dentro de `withClientChain` (:529-541).
6. **SEC-16 + REL-04 se multiplican**: 30 tickers × todas las métricas = 480 requests por pestaña cada 5 min → ~1.440 fetches a Yahoo. Y `calculateMultiReturns` degradado = **hasta 18 requests por ticker**.
7. **REL-01 — no hay análisis estático en absoluto**: `next lint` no existe en Next 16 **y** no hay ningún archivo de config de ESLint.
8. **`schema.sql` no es re-ejecutable**: `market_briefs`/`market_news` sin `if not exists`, 5 índices anónimos, 19 `create policy` a pelo, y `auth.role()` deprecado (`:720-727`).

### Donde la auditoría se equivoca — no seguir

1. **«Bajar `MAX_TICKERS` a 20-50» rompería Beating Peers.** El comentario en `returns/route.ts:14-18` documenta que manda la unión activos∪peers (~475) en un POST y que el tope anterior de 400 la truncaba en silencio. Correcto: exigir auth y **mantener** el tope. Lo mismo para `quote`, que recibe la *misma* unión vía `useRealtimePrices(unionTickers)` (`usePeerComparison:96`).
2. **La guarda `auth.uid() is distinct from p_user_id` rompería todos los registros.** En el signup el INSERT lo hace GoTrue: no hay JWT, `auth.uid()` es NULL, la excepción salta y aborta la creación del usuario entera. Y la guarda es casi inútil incluso bien escrita, porque `anon` también tiene `auth.uid() IS NULL`. `REVOKE` es el único control real.
3. **SEC-14 insinúa que `/api/users/find` no valida sesión. Sí la valida** (`:13-15`). El problema real: es un oráculo email→user_id con service role (que salta RLS) y sin UNIQUE en el email.
4. **REL-02/REL-03 sobrevaloran el riesgo**: `@supabase/ssr@0.6.1` y `yahoo-finance2@3.14.0` **no tienen advisories**.

### Hallazgos adicionales (no cubiertos por la auditoría)

| # | Hallazgo | Ubicación |
|---|---|---|
| A-1 | 5ª ruta pública sin auth, sin tope de query. **No usa Finnhub** — pega a Yahoo `v1/finance/search`; `FINNHUB_API_KEY` no lo lee ningún código. El riesgo es que Yahoo banee la IP de egreso, compartida con las otras rutas | `search/route.ts`, `finnhub.ts:275` |
| A-2 | La caché **nunca se puebla** sin service role: `price_cache`/`returns_cache` solo tienen política SELECT, **no hay política de INSERT/UPDATE**. Y el `catch {}` no lo oculta: `supabase-js` **devuelve `{error}`, no lanza** — el error nunca se lee | `returns:133-139`, `schema.sql:171-186` |
| A-9 | Segundo fan-out sin acotar: `Promise.allSettled(tickers.map(fetchQuoteV8Chart))` sin pool → 475 requests de golpe **antes** del bloque de fundamentals | `finnhub.ts:241` |
| A-10 | `quote` **borra fundamentals buenos**: `fetchFundamentals` devuelve `EMPTY_FUNDAMENTALS` en su catch y `:195-197` lo upserta sin condición → un hipo de Yahoo deja en null `morningstar_category`/`sector_weightings`/`aum` 24 h. Son las columnas que `peers/init:188` necesita | `quote:195-197`, `finnhub.ts:232` |
| A-11 | `inception_date` se re-deriva para siempre: un `fetchHistoricalData(ticker,'MAX')` en **cada** refresco de 24 h para tickers sin fecha → amplificador ×2 permanente | `quote:183-188` |
| A-12 | `createAdminClient` es código muerto | `lib/supabase/server.ts:31` |
| A-13 | **CLAUDE.md documenta 3 scripts que nunca se commitearon**: `diagnose-seed.sql`, `fix-seed-trigger.sql`, `manage-team-evolve.mjs`. Son justo las herramientas del trigger de signup. Hay que **reconstruir** la verificación | `CLAUDE.md:250-251, 346` |
| A-14 | `peers/init:322` upserta `assets_metadata` con el cliente **ligado a RLS**, con campos curados → se rompería al endurecer la política | `peers/init:322` |
| A-15 | El `source_url` que redacta el LLM se renderiza como **`href` clicable** en la UI editorial | `NewsCard.tsx:175, 231` |
| A-16 | El insert en `market_news` es **una sola sentencia todo-o-nada**; columnas `not null` + CHECK en `rating`/`signal`. **Un artículo malformado destruye el brief completo** | `news-pipeline.ts:902-906`, `schema.sql:688-708` |
| A-3 | `updateWatchlist(id, Partial<Watchlist>)` pasa el objeto del caller directo al `.update()` sin allowlist | `useWatchlistAssets.ts:60-71` |
| A-5 | `GBP`/`GBX`/`GBp` → mismo `GBPUSD=X`, pero el loop de periodos no deduplica | `useFxData.ts:6-16, 77-101` |
| A-6 | `tickers.sort()` muta el array del prop | `usePerformanceMetrics.ts:87` |
| A-7 | `parseChart` puede **lanzar** (no devuelve `[]`): `indicators.quote[0]` y `timestamp.map` sin guardas | `history.ts:59-63` |
| A-8 | `price_cache`/`returns_cache` son `select using (true)` → legibles por cualquiera con la anon key pública | `schema.sql:180, 186` |

### Nota de arquitectura que condiciona todo

`lib/supabase/middleware.ts:37-39` **exime `/api`** del gate de auth, y `proxy.ts` solo refresca la sesión. **No hay red de seguridad.** Además `updateSession` ya llama a `auth.getUser()` en todas las peticiones incluidas `/api/*` (`:30-32` corre *antes* del check), así que añadir `requireUser()` deja dos round-trips a GoTrue en una ruta que se sondea cada 5 s. Se acepta por corrección; optimizar solo si aparece en el p95.

---

## Principios de ejecución (nuevos, de la revisión)

1. **Primero seguro sin cambiar comportamiento; después optimizar; al final cambiar semántica de producto con tests que la respalden.** (§39)
2. **Input limit ≠ execution limit.** Aceptar 475 tickers nunca significa ejecutar 475 requests upstream. (§6)
3. **Idempotencia como requisito de diseño**, no como detalle: `quote`/`returns` refresh, pipeline de noticias, seeds, team shares, asset metadata. Ejecutar dos veces no debe producir dos estados incompatibles. (§29)
4. **Sin degradación silenciosa.** `canWrite: false` ⇒ log estructurado, no `200 OK` como si nada. (§10)
5. **Nada de blanket REVOKE / blanket override.** Función por función, dependencia por dependencia, con justificación escrita. (§4, §13)
6. **`db diff` vacío es necesario pero no suficiente**: hay que revisar además grants, owners, funciones, RLS, triggers, Auth config, Storage, extensiones y objetos fuera de `public`. (§3)

---

## Implementación: PR0 + 8 PRs

Acepto la secuencia de §35 con **una desviación**: separo dependencias de "security foundations", porque `firecrawl` (+15 minors) y `@supabase/supabase-js` (+11 minors, toca auth) son riesgo real y merecen un revert propio. Eso es coherente con §5 ("PR1 lo más pequeño posible").

### PR0 — Production safety baseline · **no despliega nada**

- `supabase db pull` → `supabase/migrations/001_baseline.sql` + `supabase migration repair --status applied`. El baseline **se genera por introspección**, no se escribe a mano, y su DDL no corre nunca en prod (§B).
- Snapshot de referencia versionado: `prod-schema-before-remediation-2026-09-17.sql` + volcados de las consultas de grants/owners/policies/triggers/`SECURITY DEFINER`/`proacl`/extensiones.
- **Matriz de permisos de funciones**, verificada contra prod (no asumida) — con las precisiones de §C.2:

  | Función | SEC DEF | PUBLIC | anon | authenticated | service_role | Invocada por |
  |---|---|---|---|---|---|---|
  | `seed_first_trust_watchlist` | sí | ❌ | ❌ | ❌ | ❌ | trigger (como owner) |
  | `seed_evolve_universe_watchlist` | sí | ❌ | ❌ | ❌ | ❌ | trigger (como owner) |
  | `seed_pershing_square_watchlist` | sí | ❌ | ❌ | ❌ | ❌ | trigger (como owner) |
  | `handle_new_user` | sí | ❌ | ❌ | ❌ | ❌ | trigger en `auth.users` |
  | `handle_new_user_default_watchlists` | sí | ❌ | ❌ | ❌ | ❌ | trigger en `profiles` |
  | `get_shared_watchlist_ids` | sí | ❌ | ❌ | ✅ | ✅ | **3 políticas RLS** (`:657`, `:731`) |
  | `get_top_tickers` | sí | ❌ | ❌ | ❌ | ✅ | `news-pipeline.ts:111` |

- **Matriz de ownership por columna** de `assets_metadata` (columnas reales verificadas):

  | Campo | Cliente | Backend |
  |---|---|---|
  | `ticker`, `name`, `type` | ✅ | ✅ |
  | `sector`, `region`, `industry`, `benchmark`, `manager`, `relevance_profile` | ❌ | ✅ |

- Inventario de invariantes de producto (lo que no debe cambiar): Beating Peers ≈475 tickers, Top/Bottom en 9 periodos, watchlist sin cambios, sharing y Team Evolve, signup siembra 3 watchlists, cifras financieras idénticas.
- `npm audit --json`, `npm ls`, `npm explain` por dependencia vulnerable → la tabla de §A, con el residual aceptado por escrito.
- Plan de rollback por PR.

### PR1 — Dependencias verificadas

Los 6 upgrades de padre de §A. **Cero overrides.** Smoke test obligatorio por upgrade riesgoso:
- `firecrawl`: `npx tsx scripts/run-news-pipeline.ts` completo + revisar la superficie del SDK (`node_modules/firecrawl/dist/index.d.ts`) para §21.
- `@supabase/supabase-js`: login, refresh de sesión, RLS de watchlists, sharing.
- `next`: build + arranque + service worker + optimizador de imágenes.

Verificación: `npm ci && npm ls next` (≥16.3.5), `npm audit` (0 critical), `npx tsc --noEmit`, `npm run build`.

### PR2 — Security foundations (sin cambio de contrato externo)

- **`lib/supabase/service-role.ts`** con `import 'server-only'` en la primera línea (§9; requiere `server-only@0.0.1`, ver §C.3) → un import accidental desde cliente es **fallo de build**, no riesgo latente.
  - `createServiceRoleClient()` **fail-closed** (patrón de `peers/init:44-49`, la única de las 5 copias que ya falla cerrada).
  - `createCacheClient(): { client, canWrite }` con **log estructurado** si `canWrite === false` (§10) — nunca degradación muda. Modela el split real de RLS (lectura pública, escritura solo service role) en vez del fallo permanente silencioso actual (A-2).
  - Borrar `createAdminClient` (A-12) y las 5 copias divergentes de `getAdminClient`.
- **Regla de CI**: grep que falle si `SUPABASE_SERVICE_ROLE_KEY` aparece fuera de archivos explícitamente autorizados (§9).
- **`lib/market/validation.ts`** con `zod` (ya presente como transitiva de producción, `zod@4.4.3` top-level → declararlo añade **cero paquetes**): `parseTickerList`, `parsePeriod`, `parseCalendarYear`, un solo `VALID_PERIODS`.
  - `parseCalendarYear` con `Number()` + `Number.isInteger`, no `parseInt` (hoy `history:19` acepta `'2024junk'` y el año `999999999`).
  - ⚠️ **Trampa de casing**: `quote` indexa su respuesta con la cadena exacta que mandó el cliente (`Object.fromEntries(freshMap)`, `:206`) y el `.in('ticker', …)` es case-sensitive en Postgres. Normalizar a mayúsculas en `quote`/`returns` **renderizaría los precios en blanco**. → `uppercase: false` en ambas.
- **`lib/utils/concurrency.ts`** — `mapWithConcurrency`, de `returns:28-43`. Cuatro call sites lo consolidan, incluido **dentro de `finnhub.ts:241`** (A-9: arreglar el primitivo, no el call site).
- **Controles de disponibilidad, adelantados desde PR5** (§25 — no son optimizaciones):
  - `AbortSignal` con timeout por request en `lib/market/history.ts` (hoy no hay ninguno).
  - Presupuesto de reintentos por ticker en `calculateMultiReturns:299-315` (hoy hasta 18 fetches/ticker).
  - Guardas de optional chaining en `parseChart:59-63` para que no lance (A-7).
  - Pool en `quote` (fundamentals @4) + **presupuesto de 12 por request** ordenado por `fundamentals_fetched_at ASC NULLS FIRST`. ⚠️ El techo de función síncrona de Netlify (~10 s) no honra `maxDuration = 60`, así que el pool solo convertiría la ráfaga en timeout garantizado: el presupuesto es obligatorio, no opcional.
  - A-11: condicionar el re-derive de `inception_date` al primer fetch.
  - A-10: si fundamentals no trae señal, upsertar **solo** `{ ticker, fundamentals_fetched_at }` sin pisar columnas de datos.
  - A-2: leer `{ error }` de los upserts y loguear.
- **Cron fail-closed** (`cron/news-pipeline/route.ts`): `CRON_SECRET` ausente → **500**, nunca 200/401; `crypto.timingSafeEqual`; respuesta genérica + log interno con correlation id.
- **Observabilidad formal** (§28), desde aquí y no como extra: contadores `market_api_requests`, `cache_hit`/`miss`, `yahoo_429`/`5xx`/`timeout`/`parse_error`, `fundamentals_refresh`/`failure`, y cada error con correlation id + ticker + endpoint + provider + latencia + status.
- **Tests unitarios** (§32): validación (ticker/year/period), service-role fail-closed, cron fail-closed, `mapWithConcurrency`. Esto obliga a introducir el runner de tests aquí, no en el último PR.

### PR3 — API authorization

- `requireUser()` en las 4 rutas de market restantes (`quote`, `returns`, `history`, `search`), con rama alternativa `Bearer CRON_SECRET` guardada (si el secret no está definido, la rama debe ser inalcanzable).
- **Borrar `app/api/market/export/route.ts`** — cero llamadores (solo lo referencia su propio comentario `:6`; no hay UI de CSV) + actualizar CLAUDE.md.
- Tope compartido en `quote` = el mismo de `returns` (1500). **No bajarlo.**
- `history` en modo chart **falla con 400** en vez de caer en silencio a `'1Y'` (`:37`).
- **Manejo de sesión revocada en este mismo PR** (§12): `401` → `signOut()` → redirect `/login`. Sin esto, una sesión revocada **congela el dashboard con precios viejos** y sin aviso, porque el `redirect()` server-side solo corre al navegar y la app no navega.
- **Tests negativos de auth** (§11), con el criterio fuerte:
  - anónimo → 401 en las 4 rutas;
  - y **401 ⇒ ninguna llamada a Yahoo y ninguna escritura en DB** (el orden de operaciones importa: `requireUser()` va primero, y hay que *demostrarlo*, no suponerlo);
  - autenticado → 200 poblado;
  - sesión revocada → redirect.
- Verificar en **preview deploy**: `/vs-peers` es el crítico (ejercita la unión de ~475 por `quote` **y** por `returns`).

Por qué va solo: es el único cambio que puede dejar fuera a un usuario real. Verificado que no rompe nada — los ~20 llamadores viven bajo `app/(dashboard)/`, el login no hace **ni un `fetch()`** (escenas Canvas/Framer con datos hardcoded) y el service worker rutea `/^\/api\//` por `NetworkOnly`.

### PR4 — Database security + migrations

Deltas forward-only, pequeñas, sobre el baseline generado en PR0. Idempotentes (`if not exists`, `drop policy if exists`) pero **sin reconstruir estado**.

- `002_add_missing_columns.sql` — las **6** columnas del drift + la columna de lease de §7 (`fundamentals_refresh_started_at`). Aditivo puro, seguro **antes** de desplegar código; `not null default false` en `profiles` es metadata-only en PG11+.
- `003_harden_seed_grants.sql` — **solo grants, sin tocar ni un cuerpo de función** (§13). Reescribir esos cuerpos de ~200 líneas es exactamente la operación que ya los corrompió una vez (CLAUDE.md:346, modo de fallo 2), a cambio de una guarda que no aporta nada tras el REVOKE. Enumerado según la matriz de PR0: revocar las 3 seeds + los 2 `handle_new_user*`; **conservar** `get_shared_watchlist_ids` para `authenticated` y `get_top_tickers` para `service_role`.
  - Por qué sobrevive el trigger: `EXECUTE` se chequea contra `current_user`, y dentro de un `SECURITY DEFINER` ese es el *owner*. `revoke … from public` no toca los privilegios implícitos del owner. **Verificar `proowner` antes de desplegar**: si alguna la creó otro rol, la suposición se cae.
- `004_narrow_profiles.sql` — sustituir `authenticated_read_profiles` por una política acotada a contrapartes de share, vía función `SECURITY DEFINER` **sin parámetros** que derive la identidad de `auth.uid()` internamente (patrón de `get_shared_watchlist_ids`): no hay nada que falsificar, y el definer rompe la recursión de RLS.
  - Rompe **tres** lecturas de navegador, no una: `useWatchlistAssets.ts:27` y `:185` **siguen funcionando** con la política acotada; `:228` (`.eq('is_team_evolve', true)`) **se rompe** → `POST /api/watchlists/[id]/share-team`, que hace el write completo en servidor con chequeo explícito de propiedad (el service role salta RLS, así que es obligatorio), responde **404 y no 403** para no filtrar existencia, es idempotente vía `on conflict do nothing`, y devuelve solo `{count}`. De paso elimina una race que ya existe en cliente.
- `005_restrict_assets_metadata.sql` — acotar el `WITH CHECK` (no quitar la política: evita el peligro de orden código↔DB) según la matriz de ownership de PR0: ticker normalizado + regex, largo de `name`, `type` en enum, y **`null` obligatorio** en los 6 campos curados.
  - En el mismo PR: **A-14** (`peers/init:322` → cliente admin) y normalizar el ticker en `WatchlistView.handleAddAsset` — o mejor, un trigger `before insert` con `upper(btrim())`, ya que el `WITH CHECK` se evalúa sobre la fila post-trigger. Si no, un resultado en minúsculas falla el check, el error se descarta y `addAsset` cae en FK 23503: "añadir activo" se rompe en silencio.
- `006_profiles_email_unique.sql` — **en su propio PR y en este orden** (§16): inspeccionar duplicados → decidir resolución → normalizar → corregir creación futura → crear índice único funcional. Hoy ya es un bug vivo: `.maybeSingle()` con duplicados devuelve PGRST116 y la ruta reporta "Usuario no encontrado". Y `handle_new_user()` guarda `new.email` tal cual mientras la ruta normaliza a minúsculas → una fila no-minúscula es **inencontrable para siempre**. Modificar `handle_new_user()` es cambio crítico de signup: PR aparte con pruebas end-to-end propias.
- **Verificación** — hay que **reconstruir** el bloque: `fix-seed-trigger.sql` y `diagnose-seed.sql` **no existen** (A-13). Escribir `scripts/verify-seed.sql` con el patrón de CLAUDE.md:346 (inserta `auth.users` falso, cuenta watchlists/assets, termina en `RAISE EXCEPTION` — que hace ROLLBACK y es la única forma de ver el resultado, porque `RAISE NOTICE` no aparece en el SQL Editor). Éxito: `watchlists=3` con los 3 nombres. Un `23503` sobre `watchlist_assets_asset_ticker_fkey` significa que el signup está roto **ahora**.
- **Tests negativos de RLS como criterio de aceptación** (§33), con dos usuarios reales: A no puede leer/modificar B, no puede crear shares de B, **no puede ejecutar las seed RPC**, no puede escribir campos curados, no puede enumerar profiles arbitrarios.
- Cierre: `db reset` limpio → `verify-seed.sql` → `db lint` → `db diff --linked` vacío **más** la revisión de grants/owners/RLS/triggers/Auth/Storage/extensiones de §3. Añadir `.github/workflows/db-migrations.yml` que corra `db reset` + `verify-seed.sql` en cada PR que toque `supabase/**`.
- Reducir `supabase/schema.sql` a artefacto generado (`supabase db dump`) o puntero (§34).

### PR5 — News / LLM integrity · **sin cambiar la semántica de scoring** (§18)

- **`candidate_id` server-controlled** (§19): el schema de `zod` **no incluye** `source_url`/`source_name`/`date`/`rank` — así la autoridad del modelo sobre identificadores es **estructuralmente inexistente**, no "validada". El servidor resuelve todo desde su propio `RawArticle`, y `rank` del orden final (hoy `rank` es la numeración pre-selección del LLM, así que tras reordenar y descartar los ranks colisionan y saltan). Borrar el ejemplo `"wsj.com"` del prompt.
  - Beneficio colateral: un `full_text_md` null pasa a ser **señal real** ("Firecrawl falló") en vez de "el LLM se equivocó un carácter".
- **Aislamiento por artículo, obligatorio** (§24): validar individualmente e insertar los válidos. Hoy un artículo malformado destruye el brief entero (A-16). Guardar `articles_received` / `articles_valid` / `articles_discarded` en `market_briefs.metadata` (ya es jsonb libre) para medir la calidad del nuevo pipeline desde el día 1.
- Política explícita por campo: descartar el artículo si falta `candidate_id`/`title`/`summary`/`insight` o si `rating`/`signal` salen del enum (hay CHECK en DB); truncar strings largos; **clampear** `score` a 0..25; `actionability` inválido → `null`; `score_breakdown` basura → ceros conservando el artículo; `weekly_summary` inválido → mantener la corrida.
- **Prompt injection** (§20), como capa de robustez y no como defensa principal: bloques **JSON-encodeados** (`JSON.stringify` escapa saltos y comillas, así que el texto scrapeado no puede emitir una línea que parezca cabecera) con **delimitador nonce por corrida** — hoy `--- ARTICLE ${i+1} ---` es un literal adivinable y sin escapar, así que un artículo que contenga esa cadena **forja un candidato extra**. Más la regla en el mensaje `system` de que el contenido es dato, enganchada a bajar `structural_vs_noise`. Nada de regex anti-"ignore previous instructions": trivialmente evadible y da falsa confianza.
- **Firecrawl**: `AbortSignal.timeout` (timer `unref`'d → arregla gratis la fuga de `:518`) + `AbortSignal.any` para componer con el deadline; patrón a copiar: `llm.ts:143-170`. **Verificar primero si el SDK propaga el signal hasta el transporte** (`node_modules/firecrawl/dist/index.d.ts`); si no lo hace, `local timeout ≠ cancel upstream` y **eso se documenta como limitación** (§21) — el transporte es axios, así que un `Promise.race` rechazado deja el socket abierto y el job facturando.
- **Presupuesto global en cascada** (§23): `pipeline → Firecrawl → LLM → DB`, por debajo del techo **menor** (el workflow da 15 min pero la route solo 5 → es lo que deja briefs colgados en `generating`). Al agotarse, **parar** y no iniciar trabajo nuevo. Concurrencia acotada a 4 (hoy 10 URLs × 2 intentos × N keys sin acotar).
- **Separar 429 de cuota agotada** (§22): hoy `isFirecrawlKeyExhausted` (`:106`) casa `429|rate.?limit`, así que **un 429 transitorio mata una key para toda la corrida** — y con dos keys, una ráfaga deja la extracción en cero. → cuota agotada: desactivar key; 429: backoff y reintentar la **misma** key; 404/410/robots: abandonar la URL sin recorrer la cadena ni el fallback markdown.

### PR6 — Performance / availability

Lo que queda tras adelantar los controles de disponibilidad a PR2.

- Extender `POST /api/market/returns` a un set de periodos parametrizable. `MULTI_RETURN_PERIODS` es hoy `['1W','1M','6M','YTD','1Y']`; `usePerformanceMetrics` necesita además `3Y/5Y/10Y/MAX` y 7 años calendario. `returns_cache.returns` es **JSONB** → sin DDL; sí revisar el heurístico `isHealthy` (`:85-86`, ancla en `1Y != null`) y el TTL.
- Migrar `usePerformanceMetrics` y `useTopPerformers` al POST bulk (`usePeerComparison:106` ya es el patrón correcto).
- ⚠️ **La optimización no puede cambiar la semántica financiera** (§26). `useEtfComparison` exporta `deriveTrailing`/`deriveAnnual`, que derivan todo de una serie — tentador, pero CLAUDE.md documenta que su 3Y/5Y es **acumulado a propósito**, distinto de `calculateReturn`. Reutilizarlos cambiaría **en silencio todas las cifras del watchlist**. Hay que extender el bulk con los mismos primitivos, y **los golden tests deben existir antes de considerar terminado este PR**.
- **Deduplicación de trabajo en vuelo en `quote`** (§7): lease vía la columna de PR4. Recordar que la duplicación es **garantizada**, no incidental (§C).
- `useFxData`: deduplicar el loop de periodos por `fxTicker` (A-5). `[...tickers].sort()` (A-6). Allowlist de columnas en `updateWatchlist` (A-3).
- **Estado explícito en vez de `[]`** (§27): `{data, status: 'no_data' | 'provider_error' | 'stale', provider}`. Interno, no hace falta exponerlo al usuario.

### PR7 — Platform hardening

- **Headers en fases** (§30): **A** — HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors`. **B** — CSP en `Report-Only`, medir violaciones. **C** — enforcement, solo tras verificar Framer Motion, Supabase, ReactMarkdown, Serwist, fuentes e imágenes. Nunca todo-o-nada.
- `remotePatterns` → whitelist de hosts reales (quitar `'**'`, que junto al RCE de AVIF es cadena real).
- Actions pineadas a SHA + `permissions: contents: read`. **Y revisar qué secrets recibe cada job** (§31): `build`/`lint`/`typecheck` no deben recibir **ninguno**; el pipeline de noticias, el mínimo necesario.
- `ci.yml`: `npm ci` → lint → `tsc --noEmit` → tests → build, sin secrets.
- `lint` → `eslint .` + **crear `eslint.config.mjs`** (hoy no existe ninguna config, así que no hay análisis estático en absoluto) + script `typecheck`. Subir `eslint` cierra `js-yaml`.
- `@supabase/ssr` 0.6.1 → 0.12.7 **en su propio PR**: cruza 6 minors con cambios en la API de cookies. Sin advisories → higiene, no urgencia.
- **Política de dependencias** escrita: orden `upgrade parent → override → replace → residual documentado`, para que el próximo `npm audit` no acabe en overrides a ciegas.

### PR8 — Financial correctness + semántica de producto

- Golden fixtures con respuestas congeladas: returns, CAGR, FX, fund performance, peer calculations. Tickers representativos (RDVY/SDVY/VIG + un fondo CT + un índice).
- Tests de funciones puras: `calculateReturn`, `calculateMultiReturns`, `deriveTrailing`/`deriveAnnual`, `computeInitialPeers`, `normalizeEventTag`.
- **Solo aquí**, con fixtures que permitan comparar `old score` vs `new score` antes de desplegar (§18): re-derivar `score`/`rating`/`signal` en servidor a partir de los 6 sub-scores y las bandas que el propio prompt declara (`:649-650`) y que hoy nunca se re-verifican. Acaba con los "rating A, score 4" y reduce la autoridad del LLM a sub-scores y prosa. ⚠️ **Cambio de producto visible**: más C/D, menos A/STRONG.
- Fixtures de prompt injection: artículo con "ignore previous instructions" + URL falsa → la URL persistida debe ser la de Tavily.

---

## Criterios de aceptación (§36)

No basta `npm audit = 0 critical`. Hay que demostrar:

**Seguridad** — API sin sesión → 401; **ninguna llamada a Yahoo ni escritura en DB antes de autenticar**; service role ausente → fail closed; seed RPC inaccesible para anon/authenticated; `profiles` sin lectura global; `assets_metadata` sin escritura de campos curados.

**Disponibilidad** — 475 tickers sin `Promise.all` sin acotar; Yahoo 429 → retry controlado; timeout → fallo controlado; un artículo malo no mata el brief.

**Integridad** — el LLM no puede elegir URL, nombre de fuente ni fecha; `candidate_id` inválido → descartado; `score` inválido → según política explícita.

**Producto (invariantes de PR0)** — Beating Peers ≈475 tickers; Top Performers en todos los periodos; watchlist, sharing y signup sin cambios; sesión revocada → login; **cifras financieras idénticas** hasta PR8.

**Base de datos** — DB limpia construye; `db reset` pasa; `verify-seed` pasa; `db diff` vacío; grants/owners/RLS/triggers/Auth/extensiones revisados aparte (§3).

---

## Fuera de alcance, con detonante explícito (§8)

- **Rate limiting**: diseñado como capa futura, no descartado. Se activa si alguna ruta de market vuelve a ser pública, si aparece tráfico problemático real, o al crecer el número de usuarios. Cuando se implemente: por `user_id` + endpoint + **coste de operación** (un cache hit no vale lo mismo que `cache miss → Yahoo → DB write`), estricto en `/search` y `/users/find`, en el handler (runtime Node, module scope caliente) y **nunca por IP** — `useTopPerformers:124-141` lanza ~107 requests legítimos en una ráfaga desde una IP, y una oficina entera comparte NAT.
- `yahoo-finance2` 4.x (major, sin red de tests hasta PR8).
- `price_cache`/`returns_cache` siguen `select using (true)` (A-8): dato de mercado, no de usuario. Decisión consciente.
- Enlaces markdown de cuerpos de terceros en `full_text_md` se renderizan con href arbitrario (HTML inerte, sin `rehypeRaw`). Mismo nivel de confianza que enlazar la fuente; si se quiere cerrar, restringir el componente `a` al host del artículo.
- No sustituye un pentest externo ni la revisión de configuración de Supabase/Netlify/Vercel/GitHub (CodeQL, Dependabot, secret scanning, protección de rama).

## Corregir documentación por el camino

CLAUDE.md contradice al código en cuatro puntos que despistaron a la auditoría y a mí: `search/route.ts` descrito como "(Finnhub)" cuando usa Yahoo; tres scripts documentados que no existen (A-13); `/api/market/export` documentado como feature sin llamadores; y "migraciones aplicadas" que incluyen 6 columnas que el schema no define.

---

## Apéndice — correcciones verificadas al arrancar la ejecución

Dos puntos del plan resultaron **más graves** de lo escrito al medirlos contra el árbol instalado. Se corrigen aquí en vez de reescribir el cuerpo, para que quede el registro de cuándo se supo.

1. **`postcss` sí necesita acción: es dependencia DIRECTA** (`postcss@8.5.14` en `package.json`), no solo el pin interno de Next. Subir `next` **no** lo cierra. §A decía "innecesario" razonando sobre la copia de Next; el razonamiento sobre el override sigue siendo correcto (no se pinea una transitiva que un padre fija exacto), pero la directa hay que subirla. Es un upgrade de padre, así que la regla de "cero overrides" se mantiene.

2. **El drift de schema son 8 columnas, no 6** (verificado comparando el DDL sin comentar de `supabase/schema.sql` contra las referencias en `app/`, `lib/`, `hooks/`, `components/`):

   | Tabla | Columna | ¿Texto de migración? | Referencias en código |
   |---|---|---|---|
   | `price_cache` | `currency` | comentada | 16 archivos |
   | `price_cache` | `inception_date` | comentada | 5 |
   | `price_cache` | `morningstar_category` | comentada | 7 |
   | `price_cache` | `global_category` | comentada | 6 |
   | `price_cache` | `price_to_book` | **ninguna** | 3 |
   | `price_cache` | `median_market_cap` | **ninguna** | 3 |
   | `profiles` | `onboarding_seen` | comentada | 3 |
   | `profiles` | `is_team_evolve` | **ninguna** | 2 |

   Las tres sin ni texto comentado son las que ningún documento previo detectó. `price_to_book` y `median_market_cap` las lee `rowToQuote` en `app/api/market/quote/route.ts`, así que comparten el modo de fallo de `currency`: en una DB limpia el upsert principal de `price_cache` falla con PGRST204 y el error solo se loguea.

3. **`get_top_tickers` no existe en el DDL vigente** — solo dentro del bloque comentado (`supabase/schema.sql:831`), mientras `lib/ai/news-pipeline.ts:111` la invoca. Consecuencia para `003_harden_seed_grants.sql`: los `REVOKE`/`GRANT` sobre esa función deben ser **condicionales a su existencia**, o la migración falla en cualquier entorno donde nunca se creó.
