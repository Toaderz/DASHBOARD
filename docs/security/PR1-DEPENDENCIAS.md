# PR1 — Dependencias verificadas

`npm audit`: **16 → 2** paquetes vulnerables. Crítico cerrado.

```
antes:   critical 1   high 11   moderate 1   low 3   total 16
después: critical 0   high  2   moderate 0   low 0   total  2
```

**Cero entradas `overrides`.** Todo se cerró subiendo padres o refrescando transitivas dentro de
los rangos que ya declaraban sus padres (`npm update`), que es el mecanismo legítimo.

---

## Cambios en `package.json`

| Paquete | De → A | Qué cierra |
|---|---|---|
| `next` | `^16.2.5` → `^16.3.5` | **2 RCE críticos** (`GHSA-p293-qw3h-jr36`, `GHSA-2xp9-vwfh-vxw4` vía optimizador de imágenes/AVIF) + bypass de middleware/proxy en App Router, SSRF, DoS en Server Actions, confusión de caché. Arrastra `postcss` 8.5.23 y `sharp` ^0.35.4 |
| `eslint-config-next` | `^16.2.5` → `^16.3.5` | Sin advisory propio; se mantiene en lockstep con `next` |
| `@serwist/next` + `serwist` | `^9.5.11` → `^9.5.12` | **Nada.** 9.5.12 ya es la última estable. Ver residual |
| `firecrawl` | `^4.25.1` → `^4.40.0` | Sube su pin **exacto** de `axios` 1.15.2 → 1.18.0, cerrando ~18 advisories de axios (ReDoS, fuga de `Proxy-Authorization` en redirect HTTP→HTTPS) |
| `@tavily/core` | `^0.7.3` → `^0.7.12` | Su `axios@^1.7.7` ahora dedupea sobre 1.18.0 (antes era una segunda copia en 1.16.1) |
| `@supabase/supabase-js` | `^2.49.4` → `^2.116.0` | **Elimina `ws` del árbol por completo** (realtime-js ya no lo usa) → los dos advisories de `ws` desaparecen estructuralmente, no solo parcheados |
| `yahoo-finance2` | `^3.14.0` → **`~3.14.3`** | Nada. Es el pin más estrecho a propósito — ver abajo |
| `postcss` (dev) | `^8` → `^8.5.28` | 4 advisories (XSS vía `</style>`, lectura de archivo vía `sourceMappingURL`). **Es dependencia directa**: subir `next` no la cerraba. El caret se conserva; solo se elevó el piso, porque `^8` a secas puede resolver vulnerable en caché frío |
| `@types/node` (dev) | `^20` → `^22` | Requisito de `vitest` 5 (peer `^22 \|\| >=24`). Node 20 además está fuera de soporte |
| `vitest` (dev) | — → `^5.0.1` | Nuevo. Runner de tests. 5.0.1 está **fuera** del rango vulnerable de `vitest`/`@vitest/mocker` (`2.1.0 - 4.1.10`) |
| `zod` | — → `^4.4.3` | Nuevo, producción. **0 paquetes añadidos** (ya estaba en el árbol) |
| `server-only` | — → `^0.0.1` | Nuevo, producción. Un archivo, cero dependencias. Hace que importar código de servidor desde cliente sea error de build |
| scripts | + `typecheck`, + `test` | `lint` se deja intacto: lo cambia PR7 junto con la configuración de ESLint, para que no quede roto entre commits |

### Transitivas cerradas sin tocar `package.json` y sin overrides
`npm update` refresca transitivas **dentro de los rangos que ya declaran sus padres**:
`@babel/core` → 7.29.7 · `brace-expansion` → 1.1.21 / 5.0.12 · `form-data` → 4.0.6 ·
`js-yaml` → 4.3.2 · `nanoid` → 3.3.19 · `postcss-selector-parser` → 6.1.4 ·
`esbuild` → 0.28.2 · `baseline-browser-mapping` → 2.11.24 · `sharp` → 0.35.4 · `eslint` → 9.39.5.

Nota sobre `js-yaml`: **no** dependía de la versión de `eslint`. Se cierra porque el
`js-yaml@^4.1.1` de `@eslint/eslintrc` flota a la 4.3.2 parcheada.

## Por qué `yahoo-finance2` queda en `~3.14.3` y no en `3.15.4`

La decisión previa fue "subir a 3.15.4, quedarse en 3.x". Al medirlo, 3.15.4 **no cierra ningún
advisory** (nunca estuvo en la lista de vulnerables) y en cambio `3.15.0` añadió
`@modelcontextprotocol/sdk`, que arrastra **`express`, `hono`, `body-parser`, `cors`,
`express-rate-limit`, `eventsource`, `jose`, `ajv`, `qs`, `send`, `serve-static`** a
**producción**:

| | `^3.15.4` | `~3.14.3` |
|---|---|---|
| Entradas de lockfile | 853 | **780** |
| Entradas de producción | 433 | **347** (baseline: 354) |
| `express`/`hono`/MCP SDK en el árbol | sí | **no** |
| Advisories cerrados | 0 | 0 |

Ese código **no es alcanzable** desde la app (MCP vive en subpaths de export `./mcp*`; el repo solo
hace `import YahooFinanceLib from 'yahoo-finance2'`), así que no es una vía explotable hoy. Pero en
una remediación cuyo objetivo es **reducir superficie**, añadir 86 paquetes de producción para cerrar
cero advisories va en dirección contraria: es tamaño de artefacto, ruido de SCA y superficie de
advisories futuros. `3.14.3` es la última versión sin el SDK.

El rango es `~3.14.3` (no `^3.14.3`) **a propósito**: el caret volvería a resolver 3.15.x y a
reintroducir el SDK. La tilde acota a la línea 3.14.x y sigue recibiendo parches.
Revertir esta decisión es una línea: `"yahoo-finance2": "^3.15.4"` + `npm install`.

## Residual aceptado — 2 high, una sola causa raíz

| Paquete | Sev | Por qué no se cierra | Clase |
|---|---|---|---|
| `browserslist@4.28.6` | high — crecimiento de memoria no acotado (OOM); crash/escritura de prototipo vía `browserslist-stats.json` no confiable | **Existe la 4.29.0 parcheada, pero `@serwist/next@9.5.12` la pinea EXACTA** (`"browserslist": "4.28.6"`). Los otros 3 consumidores (`autoprefixer`, `@babel/helper-compilation-targets`, `update-browserslist-db`) aceptarían la parcheada; el pin exacto es lo que retiene la copia hoisted | **solo build-time** |
| `@serwist/next@9.5.12` | high | El audit atribuye el advisory del hijo al padre. 9.5.12 **es** la última estable; lo único superior es `10.0.0-preview.14`, un major en prerelease | **solo build-time** |

**Por qué NO se pone un `overrides` aquí, aunque sea tentador**: forzaría el pin *exacto* de un
padre contra una versión que ese padre nunca probó. Es exactamente el error que esta remediación
rechazó en su plan v1 con `postcss`, y la regla no se rompe porque esta vez el paquete sea más
inocente. El único "fix" que ofrece `npm audit` es **degradar `@serwist/next` a 9.4.1**, un major
hacia atrás — peor que el residual.

**Evaluación de exposición**: los dos advisories requieren entrada de build controlada por un
atacante (consultas *distintas* de browserslist sin acotar, o un `browserslist-stats.json` no
confiable). Verificado: el repo **no** tiene clave `browserslist` en `package.json`, ni
`.browserslistrc`, ni `browserslist-stats.json`. Los consumidores son el build del service worker,
el build de CSS (`autoprefixer`) y el lint. **Nada en la ruta de servicio.** Se acepta.

Vía de salida cuando exista: `@serwist/next` 10.x estable.

## Política de dependencias (para que el próximo `npm audit` no acabe en overrides a ciegas)

1. **Subir el padre.** Primera opción siempre. Incluye `npm update` para refrescar transitivas
   dentro de rangos ya declarados: no toca `package.json` y no es un override.
2. **Override compatible.** Solo si ningún padre lo cierra **y** ningún padre pinea la transitiva de
   forma exacta. Si algún padre la pinea exacta, **no se hace**: forzarías su bundler contra una
   versión no probada. Requiere justificación escrita en este documento.
3. **Reemplazar** el paquete.
4. **Aceptar el residual**, documentado: severidad, causa raíz, clase (runtime vs build-time),
   evaluación de exposición y vía de salida.

Corolario aprendido aquí: **`npm audit fix --force` no es aceptable**. Para `browserslist` proponía
un downgrade de major de `@serwist/next`, y para `vitest` el runner recién añadido habría quedado
vulnerable. El arreglo que propone la herramienta se verifica, no se aplica.

## Verificación ejecutada

| Compuerta | Resultado |
|---|---|
| `npm install` → `rm -rf node_modules && npm ci` | ✅ exit 0. El lockfile es autosuficiente |
| `npx tsc --noEmit` | ✅ **0 errores** |
| `npm test` | ✅ 3/3 (el test humo demuestra que el alias `@` resuelve) |
| `npm run build` | ✅ exit 0, 18 páginas estáticas, service worker y proxy compilados |
| `npm audit` | ✅ 2 high, ambos build-time, documentados arriba |
| `npm ls` | `next@16.3.5` · `axios` una sola copia 1.18.0 · **`ws` ausente** · `zod` una sola copia hoisted 4.4.3 |

⚠️ El build **requiere** `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` porque
`/login` se prerenderiza estáticamente y construye un cliente de Supabase. Aquí pasó con valores
placeholder. **No es una regresión de PR1**: el baseline falla igual. CI debe inyectar las dos.

## Pendiente de verificar con credenciales o en preview

Nada de lo anterior cubre comportamiento en vivo. Sin `.env` en el entorno de ejecución, queda:

1. **`@supabase/supabase-js` 2.49 → 2.116 (67 minors, toca auth)**: login, refresh de sesión, RLS
   de watchlists, sharing. Es type-clean y build-clean, pero **funcionalmente sin probar**.
2. **`firecrawl` 4.40.0 contra la API real** — y sobre todo el punto de abajo.
3. **`yahoo-finance2` 3.14.3 en runtime**: los quirks documentados en CLAUDE.md
   (`validateResult:false`, `fundProfile.brokerages`, `beta3Year`, `fundInceptionDate`, la regla de
   que `stdDev` **no** lleva ×100) no se ejercitaron. Comprobar con `node scripts/diagnose.mjs <TICKER>`.
4. **Service worker en navegador** (Serwist 9.5.12 compila; su comportamiento en runtime no se probó).
5. **`@netlify/plugin-nextjs@5.15.11` contra Next 16.3.5** — no se subió ni se probó.
6. **ESLint**: `npm run lint` no se corrió y no hay configuración todavía (es de PR7).
   `eslint-config-next@16.3.5` puede sacar violaciones nuevas.

## ⚠️ Hallazgo que condiciona PR5: `autoResume` de Firecrawl

El dictamen sobre el SDK de `firecrawl@4.40.0` dio dos resultados que **cambian el diseño de PR5**:

1. **La superficie que usa el repo no se rompe.** Constructor, `scrape(url, opts)`, `JsonFormat`
   con `prompt`/`schema`, `onlyMainContent`, `blockAds`, `proxy:'auto'`, `removeBase64Images`,
   `result.json` y `result.markdown` siguen idénticos o ampliados (superset).

2. **`AbortSignal` no existe en el SDK, en ninguna versión.** Cero apariciones de
   `AbortSignal`/`AbortController` en sus tipos. Y hay una trampa silenciosa: pasar `signal` al
   *constructor* es error de compilación, pero pasarlo a `scrape(url, {…, signal})` **compila y no
   hace nada** — la sobrecarga genérica se salta el chequeo de propiedades excedentes, y el SDK
   spreadea las opciones desconocidas **al cuerpo de la petición**. Cancelación en un momento
   arbitrario: **imposible**; se documenta como limitación.

3. **Pero sí hay deadline real de transporte**, mejor de lo que suponía el plan:
   `ScrapeOptions.timeout` se cablea directo al `timeout` de axios, que **aborta la petición HTTP de
   verdad**. Así que el deadline se implementa con `timeout`, no con `Promise.race`.

4. **`autoResume` es nuevo en 4.40.0 y viene activado por defecto.** Ante un timeout del servidor,
   el SDK duerme y **reintenta la misma petición**, hasta 5 veces / 20 minutos. El `withTimeout`
   actual del pipeline es un `Promise.race` de 60–70 s: cuando la carrera rechaza y
   `extractContent` sigue adelante, **el SDK puede seguir reintentando 20 minutos**, quemando
   créditos de forma invisible y pudiendo disparar la ruta de "key agotada" en URLs posteriores.
   **Es un cambio de comportamiento introducido por este upgrade**, no un bug preexistente.

→ PR5 debe llamar con `autoResume: false` y un `timeout` explícito, y sustituir `Promise.race` por
el deadline de transporte.
