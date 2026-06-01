# Métricas de selección y scoring de noticias

Documento de referencia de **cómo se eligen y puntúan** las noticias del Market Brief.
Refleja la lógica **real implementada** en [`lib/ai/news-pipeline.ts`](../lib/ai/news-pipeline.ts)
(es la fuente de verdad; cualquier `SKILL.md` externo es solo diseño histórico).

---

## A. Selección — qué noticias entran

El embudo descarta ruido en 3 capas antes de que un LLM elija las 5 finales.

### Capa 1 — Fuentes permitidas (`NEWS_SOURCES`)
Solo se buscan noticias en fuentes oficiales/neutras y de acceso abierto:

`reuters.com · apnews.com · bbc.com · theguardian.com · cnbc.com · marketwatch.com`

Esto excluye automáticamente Yahoo Finance y el paywall duro (WSJ, Bloomberg, FT).

### Capa 2 — Filtros automáticos (en `searchNews`)
- **Relevancia (Tavily)** ≥ `0.4`.
- **Antigüedad** ≤ 10 días (ventana de búsqueda de 7 días).
- **`JUNK_TITLE`** — descarta páginas que no son artículos:
  índices de titulares, columnas "Market Talk", "live blog/updates", "what to watch",
  "market wrap/roundup", "things to know", newsletters.
- Dedupe por URL. Quedan hasta 25 candidatos.

### Capa 3 — Selección por importancia (LLM, en `selectTop7`)
Un LLM elige las **5 más importantes por impacto de mercado real**:

| Prioriza | Descarta |
|---|---|
| Decisiones de bancos centrales | Páginas índice de titulares |
| Datos macro (inflación, empleo, PIB) | Columnas de opinión tipo "Market Talk" |
| Movimientos corporativos relevantes | "What to watch", live blogs |
| Geopolítica que mueve mercados | Listicles ("top/bottom performers"), guías genéricas |

Reglas: **máximo 2 noticias por fuente** (diversidad); si el LLM falla, hay un **respaldo
determinista** (top por score de Tavily + diversidad de dominio).

> **Por qué LLM y no solo el score de Tavily:** el score de Tavily mide *relevancia de búsqueda*,
> no *importancia de mercado*. Por sí solo coloca páginas índice y opinión por encima de decisiones
> de bancos centrales. El LLM cura por importancia real.

---

## B. Scoring — cómo se puntúa cada noticia

El LLM (`analyzeAndSynthesize`) puntúa **5 dimensiones de mercado**, cada una de **0 a 5**:

| Dimensión | 0 | 3 | 5 |
|---|---|---|---|
| **macro_impact** | Evento local/micro | Relevancia regional | Cambio macro global |
| **surprise_factor** | Totalmente descontado | Sorpresa parcial | Desviación fuerte vs consenso |
| **market_relevance** | Sin reacción | Reacción moderada | Fuerte reacción cross-asset |
| **forward_implications** | No cambia el panorama | Revisión menor | Cambia el caso base |
| **structural_vs_noise** | Ruido/puntual | Señal mixta | Cambio estructural/de régimen |

Más dos ajustes:

- **time_decay** (penalización por antigüedad): `0` si ≤ 2 días · `−1` si 3–4 días · `−2` si 5–7 días.
- **portfolio_relevance** (0–5, **solo informativo**): `5` = ticker directo, `3` = universo amplio,
  `0` = ninguno. **NO suma al total** — la importancia de una noticia no depende de si toca tu cartera.

### Total y clasificación

```
TOTAL = macro_impact + surprise_factor + market_relevance
      + forward_implications + structural_vs_noise + time_decay     (máx 25)
```

| Rating | Score | Signal | Score |
|---|---|---|---|
| **A** — Alta convicción | 19–25 | 🔴 **STRONG** | ≥ 19 |
| **B** — Relevante | 15–18 | 🟡 **MODERATE** | 15–18 |
| **C** — Bajo impacto | 11–14 | ⚪ **WEAK** | < 15 |
| **D** — Ruido | < 11 | | |

- **Actionability** (solo A/B): `MONITOR · REVIEW · CONFIRMS · CONTRADICTS`.
- Las noticias rating **D** se descartan al guardar, **salvo** que queden menos de 3
  (nunca se deja el brief vacío).

---

## C. Relevancia de portafolio (badge 🎯)

Separado del rating. El LLM recibe el **catálogo real** de tus tickers
(`ticker — nombre [sector]`, vía `getTickerCatalog` desde `assets_metadata`) y aplica una regla
**estricta** para `affected_tickers`:

- Etiqueta un ticker **solo** si el artículo menciona explícitamente esa empresa/activo,
  **o** si su sector/tema es el **foco directo** de la noticia.
- Si ninguno aplica directamente → lista **vacía** (mejor sin etiqueta que con una falsa).
- Prohibidas las asociaciones temáticas vagas (p. ej. NO etiquetar un ETF de ciberseguridad para
  una noticia de chips de memoria).

El badge **"🎯 Relevante para tu portafolio"** en la tarjeta aparece solo cuando `affected_tickers`
cruza con los tickers de la watchlist activa del usuario.

---

## D. Reglas de redacción (calidad del texto)

Aplican a `summary` y `insight`:

- **Prohibido inventar datos**: solo cifras/fechas/nombres que estén en el artículo.
- **Prohibido predecir o recomendar**: nada de llamadas de mercado ni consejos.
- **Prohibido relleno**: cada frase aporta un hecho o contexto específico del artículo.
- Tono institucional y descriptivo — el lector saca **sus propias** conclusiones.

---

## Resumen rápido

1. **Fuentes** oficiales/neutras → 2. **filtros** (relevancia, antigüedad, anti-basura) →
3. **LLM elige 5** por importancia → 4. **scoring** de 5 dimensiones (máx 25, portafolio aparte) →
5. **rating/signal** + badge 🎯 si toca tu cartera.

Ver el flujo completo del pipeline en [`news-section.md`](./news-section.md).
