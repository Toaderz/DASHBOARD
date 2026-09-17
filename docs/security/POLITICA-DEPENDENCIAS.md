# Política de dependencias

Cómo se resuelve un advisory en este repositorio. Es normativo: si una PR se salta el
orden de abajo, se rechaza en revisión.

El caso de estudio completo —16 paquetes vulnerables cerrados a 2 sin una sola entrada
`overrides`— está en [`PR1-DEPENDENCIAS.md`](./PR1-DEPENDENCIAS.md). Este documento no
lo duplica: formaliza la regla que salió de allí.

---

## Orden obligatorio

Se prueban en este orden. No se salta un escalón porque el siguiente sea más rápido.

### 1. Subir el padre

Primera opción **siempre**. Incluye `npm update`, que refresca transitivas dentro de los
rangos que sus padres ya declaran: no toca `package.json` y **no es un override**.

Es el mecanismo legítimo porque respeta el contrato que el padre publicó. En PR1 cerró
`@babel/core`, `brace-expansion`, `form-data`, `js-yaml`, `nanoid`, `esbuild`, `sharp` y
el propio `eslint` sin escribir una línea en `package.json`.

### 2. Override compatible — condicionado

Solo si **ningún padre lo cierra** subiendo de versión.

> ⛔ **Si algún padre pinea la transitiva de forma EXACTA, el override está prohibido.**

Un pin exacto (`"browserslist": "4.28.6"`, sin caret ni tilde) no es descuido: es el
padre declarando que probó su build contra *esa* versión y solo esa. Un `overrides` que
lo fuerza a otra sustituye tu criterio por el suyo en un componente que tú no ejecutas
—su bundler, su pipeline de build— y lo hace en silencio, sin que ninguna suite de tests
del repo lo cubra. El resultado más probable no es un fallo ruidoso: es un artefacto de
build sutilmente distinto.

Es exactamente el error que la remediación rechazó en su plan v1 con `postcss`. La regla
no se relaja porque el paquete de turno parezca inocente.

Si se aplica un override, requiere **justificación escrita** en `docs/security/`:
qué padre, qué rango declaraba, por qué no bastaba subirlo, y qué se probó después.

### 3. Reemplazar el paquete

Cuando no hay versión sana y el paquete no es esencial. Cuenta también **quitar
superficie**: en PR1, `@supabase/supabase-js` 2.116 eliminó `ws` del árbol por completo,
así que sus dos advisories no se parchearon, desaparecieron.

Corolario del mismo PR: **subir de versión no siempre reduce superficie**.
`yahoo-finance2` 3.15.x no cerraba ningún advisory y en cambio metía `express`, `hono` y
el SDK de MCP en producción (+86 paquetes). Se fijó `~3.14.3`. Antes de subir, mirar qué
entra: `npm ls --omit=dev | wc -l` antes y después.

### 4. Aceptar el residual, documentado

Último escalón, y solo por escrito. Un residual sin documentar es un residual olvidado.
Cada uno necesita las cinco cosas:

| Campo | Qué responde |
|---|---|
| Severidad | Lo que dice el advisory |
| Causa raíz | Por qué no se cierra con los pasos 1–3 |
| **Clase** | **runtime vs build-time** — la distinción que más cambia el riesgo real |
| Exposición | ¿Es alcanzable la ruta vulnerable en esta app? Verificado, no supuesto |
| Vía de salida | Qué versión o cambio lo cerrará, para poder reevaluarlo |

Los 2 high aceptados hoy (`browserslist`, `@serwist/next`) están documentados así en
[`PR1-DEPENDENCIAS.md`](./PR1-DEPENDENCIAS.md#residual-aceptado--2-high-una-sola-causa-raíz):
ambos build-time, sin `browserslist` configurado en el repo, nada en la ruta de servicio.

---

## `npm audit fix --force` no es aceptable

No se ejecuta en este repositorio. La bandera `--force` autoriza a la herramienta a
**romper rangos semver**, y lo que propone no es un arreglo evaluado, es la primera
versión del grafo que deja el audit en verde. Medido en PR1:

- Para `browserslist` proponía **degradar `@serwist/next` de 9.5.12 a 9.4.1** — un major
  hacia atrás en el generador del service worker, para cerrar un advisory *build-time*.
  Peor que el residual que evitaba.
- Para `vitest` habría dejado el runner recién añadido **dentro** del rango vulnerable.

`npm audit` sin `--force` sí se usa, como **señal**: dice qué mirar, no qué hacer.
Su arreglo se verifica, no se aplica.

---

## Compuertas antes de mezclar un cambio de dependencias

Las corre el CI (`.github/workflows/ci.yml`) salvo la última:

```
npm ci            # el lockfile tiene que ser autosuficiente
npm run lint
npm run typecheck
npm test
npm run build
npm audit         # informativo: comparar contra el residual documentado
```

Dos notas sobre el build:

- `next build` exige `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` porque
  `/login` se prerenderiza estáticamente. En CI se inyectan **placeholders definidos en el
  propio workflow**, nunca secrets: el build no hace ninguna petición a Supabase, solo
  necesita dos strings no vacíos.
- Verde en las cinco compuertas **no** es verde funcional. Un salto grande de minors en
  un paquete de auth (`@supabase/ssr`, `@supabase/supabase-js`) es type-clean y
  build-clean mucho antes de ser correcto. Esos suben en su propio PR, nunca dentro de
  una tanda de seguridad, y se prueban a mano: login, refresh de sesión, RLS, sharing.

## Reglas permanentes

1. **Un PR de dependencias no mezcla cambios de producto.** Si el diff toca `.tsx`, ya no
   es un PR de dependencias.
2. **El lockfile se commitea siempre.** Un `package.json` sin lockfile actualizado es un
   cambio a medias.
3. **Nada de rangos abiertos nuevos** (`*`, `latest`, `>=x`). Caret o tilde.
4. **La tilde es una decisión, no un descuido.** Donde aparece (`~3.14.3`) hay un motivo
   escrito al lado. Cambiarla a caret exige releer ese motivo.
