# Sección de Noticias — Cómo funciona

Brief de mercado semanal generado por IA. Un pipeline automatizado busca noticias en fuentes
oficiales/neutras, extrae el artículo completo, lo analiza con un LLM y lo presenta como tarjetas
con resumen, análisis de contexto, rating de importancia y artículo completo legible.

---

## 1. Vista de alto nivel

```
Cron (Lun/Vie 07:00 MX)
        │
        ▼
[1] Tickers del usuario ──► [2] Búsqueda (Tavily) ──► [3] Selección de 5 (LLM)
        │                                                      │
        ▼                                                      ▼
[4] Extracción del artículo (Firecrawl AI) ──► [5] Análisis + scoring (gpt-oss-120b)
        │
        ▼
   Supabase (market_briefs + market_news)
        │
        ▼
   /news  ──►  NewsBlock ──► WeeklyBriefCard + NewsCard (resumen, análisis, modal)
```

- **Selección de noticias** → la decide un **LLM por importancia de mercado** (con respaldo determinista).
- **Análisis y resúmenes** → los escribe **`gpt-oss-120b`** (modelo de Groq).
- **Frecuencia**: lunes y viernes, 07:00 hora de México (13:00 UTC).

---

## 2. El pipeline paso a paso

Todo vive en [`lib/ai/news-pipeline.ts`](../lib/ai/news-pipeline.ts), orquestado por
[`app/api/cron/news-pipeline/route.ts`](../app/api/cron/news-pipeline/route.ts).

### Paso 1 — Tickers del usuario (`getTopTickers`)
Obtiene los tickers más frecuentes en las watchlists (RPC `get_top_tickers`, o consulta directa a
`watchlist_assets` como respaldo). Top 50.

### Paso 1b — Catálogo de tickers (`getTickerCatalog`)
Trae `nombre + sector` de cada ticker desde `assets_metadata` (top 25). Esto permite que el LLM sepa
**qué es** cada ticker (p. ej. `CIBR — First Trust NASDAQ Cybersecurity ETF`) y solo etiquete una
noticia como "relevante para tu portafolio" cuando hay relación **real**, no temática vaga.

### Paso 2 — Búsqueda (`searchNews`, vía **Tavily**)
- 5 consultas en paralelo: macro global, bancos centrales/inflación, geopolítica/aranceles,
  earnings de tus tickers, y tecnología/IA.
- **Restringida a fuentes oficiales/neutras y abiertas** (`NEWS_SOURCES`):
  `reuters.com, apnews.com, bbc.com, theguardian.com, cnbc.com, marketwatch.com`.
  Esto **excluye automáticamente** Yahoo Finance y el paywall duro (WSJ, Bloomberg, FT).
- Filtros: ventana de 7 días, score de relevancia ≥ 0.4, descarta artículos > 10 días, y un
  **pre-filtro `JUNK_TITLE`** que tira páginas no-artículo (índices de titulares, "Market Talk",
  live blogs, "what to watch"). Devuelve hasta 25 candidatos.

### Paso 3 — Selección de las 5 (`selectTop7`)
- **Un LLM elige las 5 más IMPORTANTES** por impacto de mercado real (bancos centrales, macro,
  movimientos corporativos relevantes, geopolítica que mueve mercados), excluyendo opinión/listicles
  y con máximo 2 por fuente.
- **Por qué LLM y no algoritmo:** el score de Tavily mide *relevancia de búsqueda*, no *importancia de
  mercado* — por sí solo pone páginas índice y columnas de opinión por encima de decisiones de bancos
  centrales. El LLM cura por importancia.
- **Respaldo determinista**: si el LLM falla, cae a top-por-score con diversidad de dominio.

### Paso 4 — Extracción del artículo (`extractContent`, vía **Firecrawl**)
- Usa la **extracción AI server-side de Firecrawl** (formato `json`) para sacar solo el cuerpo del
  artículo en markdown limpio + imágenes de contenido.
- `proxy: 'auto'` (salta paywalls ligeros sin gastar de más), `blockAds`, `removeBase64Images`.
- Limpieza propia: quita el `# Título` duplicado, normaliza párrafos y **filtra imágenes basura**
  (logos de agencias como Reuters/Getty, iconos, avatares), conservando **fotos y gráficas** de
  contenido. Respaldo a markdown plano si la extracción AI falla.
- El resultado se guarda en `market_news.full_text_md`.

### Paso 5 — Análisis + scoring (`analyzeAndSynthesize`, vía **`gpt-oss-120b`**)
Por cada artículo produce:
- **`summary`** — 1 párrafo descriptivo (qué pasó + contexto), solo con datos del artículo.
- **`insight`** (Análisis) — 1 párrafo de trasfondo y hacia dónde apunta el tema, para que el lector
  saque su propio juicio.
- **`affected_tickers`** — tickers del catálogo **directamente** afectados (o vacío).
- **`score` + `rating` + `signal`** (ver §4).

Reglas duras del prompt: prohibido inventar cifras, prohibido dar llamadas de mercado/recomendaciones,
prohibido relleno; cada frase con un dato específico del artículo.

También genera el **resumen semanal** (`top_theme`, `key_risk`, `context_md` de 3 párrafos,
`watchlist_items` "qué vigilar").

**Robustez**: reintenta gpt-oss con backoff ante `503`/`429` transitorios de Groq; cae a `llama-3.3-70b`
si persiste; y **lanza error en vez de guardar un brief vacío** si el modelo no devuelve artículos.

---

## 3. Almacenamiento (Supabase)

Definidos en [`supabase/schema.sql`](../supabase/schema.sql), con RLS (lectura para autenticados,
escritura solo vía service role).

- **`market_briefs`** — un registro por corrida: `period_start/end`, `valid_until`, `status`
  (`generating` → `ready` / `failed`), `top_theme`, `key_risk`, `context_md`, contadores de señales,
  `metadata` (incl. `watchlist_items`).
- **`market_news`** — las noticias del brief: `rank`, `title`, `summary`, `insight`, `full_text_md`,
  `source_url`, `source_name`, `published_at`, `affected_tickers`, `score`, `rating`, `signal`,
  `actionability`, `score_breakdown`.

---

## 4. Sistema de scoring

El LLM puntúa 5 dimensiones de mercado (0–5 c/u) + `time_decay` (penalización por antigüedad):

`macro_impact · surprise_factor · market_relevance · forward_implications · structural_vs_noise`

- **TOTAL = suma de las 5 dimensiones + time_decay (máx 25).**
  La relevancia de portafolio **NO** suma al total — la importancia de una noticia no depende de si
  toca tu cartera (eso se muestra aparte como el badge 🎯).
- **Rating**: `A` 19–25 · `B` 15–18 · `C` 11–14 · `D` < 11.
- **Signal**: `STRONG` ≥ 19 · `MODERATE` 15–18 · `WEAK` < 15.
- **Actionability** (solo A/B): `MONITOR | REVIEW | CONFIRMS | CONTRADICTS`.
- Los artículos rating **D** (ruido) se descartan al guardar, **salvo** que queden menos de 3
  (nunca se deja el brief vacío).

---

## 5. Frontend

- **Página**: [`app/(dashboard)/news/page.tsx`](../app/(dashboard)/news/page.tsx).
- **API de lectura**: [`app/api/news/current/route.ts`](../app/api/news/current/route.ts) — devuelve
  el brief vigente (con bandera `stale` si ya pasó su `valid_until`).
- **Hook**: [`hooks/useNewsBrief.ts`](../hooks/useNewsBrief.ts).
- **Componentes**:
  - [`NewsBlock.tsx`](../components/dashboard/NewsBlock.tsx) — encabezado "Market Brief", estado
    Live/stale, y la grilla.
  - [`WeeklyBriefCard.tsx`](../components/dashboard/WeeklyBriefCard.tsx) — resumen de la semana:
    contadores de señales, tema dominante, riesgo clave, narrativa (`context_md`), "qué vigilar".
  - [`NewsCard.tsx`](../components/dashboard/NewsCard.tsx) — por noticia: badges (signal/rating/
    actionability), título, fuente/fecha, **badge 🎯 "Relevante para tu portafolio"** (solo si
    `affected_tickers` cruza con tus tickers), `summary`, "Ver análisis" (insight + score breakdown) y
    **"📄 Artículo completo"** → modal que renderiza `full_text_md` con formato de lectura (párrafos,
    encabezados editoriales, imágenes redondeadas).

---

## 6. Configuración (variables de entorno)

```
TAVILY_API_KEY=        # búsqueda de noticias
FIRECRAWL_API_KEY=     # extracción del artículo completo
OLLAMA_API_URL=        # endpoint LLM (OpenAI-compatible). Producción: Groq → https://api.groq.com/openai
OLLAMA_API_KEY=        # API key de Groq
OLLAMA_MODEL=          # modelo de selección/respaldo (llama-3.3-70b-versatile)
NEWS_ANALYSIS_MODEL=   # modelo de análisis (default openai/gpt-oss-120b)
CRON_SECRET=           # autoriza POST a /api/cron/news-pipeline
```

**Modelos (Groq):**
- *Selección y respaldo* → `llama-3.3-70b-versatile`.
- *Análisis/resúmenes* → `openai/gpt-oss-120b` (mejor seguimiento de instrucciones).
- Se usan modelos distintos a propósito: Groq aplica el límite de tokens/min **por modelo**, así que no
  compiten por el mismo cupo.

> ⚠️ **Límites del free tier de Groq**: tokens/min (TPM) y tokens/día (TPD) por modelo. Con 2 corridas/
> semana no son problema, pero pruebas intensivas pueden agotarlos (resetean por tiempo). Para uso sin
> límites, subir Groq a **Dev tier** (pago por uso).

---

## 7. Programación y ejecución manual

- **Cron** ([`vercel.json`](../vercel.json)): `0 13 * * 1,5` → 13:00 UTC lunes y viernes (07:00 MX).
- **Guard anti-doble-ejecución**: si ya existe un brief `generating` o uno `ready` aún vigente
  (`valid_until` futuro), la corrida se salta. *(Importante: reactivar un brief manualmente como
  `ready` con vigencia futura bloquea el cron.)*
- **Vigencia** (`valid_until`): lunes → viernes; viernes → lunes; corrida manual → +1 día.
- **Disparo manual**: `scripts/refresh-news.mjs` expira el brief vigente y dispara el pipeline:
  ```bash
  node scripts/refresh-news.mjs http://localhost:3000
  ```

---

## 8. Archivos clave

| Archivo | Rol |
|---|---|
| `lib/ai/news-pipeline.ts` | Lógica del pipeline (búsqueda, selección, extracción, análisis) |
| `app/api/cron/news-pipeline/route.ts` | Endpoint del cron + guard + persistencia |
| `app/api/news/current/route.ts` | Lectura del brief vigente |
| `hooks/useNewsBrief.ts` | Hook de datos del frontend |
| `components/dashboard/NewsBlock.tsx` | Contenedor de la sección |
| `components/dashboard/WeeklyBriefCard.tsx` | Resumen semanal |
| `components/dashboard/NewsCard.tsx` | Tarjeta de noticia + modal de artículo |
| `supabase/schema.sql` | Tablas `market_briefs` y `market_news` |
| `scripts/refresh-news.mjs` | Refresco manual del brief |
| `vercel.json` | Programación del cron |
