# Revisión del avance de remediación en Supabase

**Fecha:** 2026-09-18
**Revisa:** `Reporte_avance_remediacion_Supabase_Evolve.md` (Paso 0 completado, baseline bloqueado por Docker)
**Contrastado contra:** `docs/security/RUNBOOK-SUPABASE.md`, las 6 migraciones de `supabase/migrations/`, y el estado real de `origin/master`

---

## 1. Veredicto

El Paso 0 está **bien hecho y es válido**. Las tres precondiciones duras del runbook quedaron
satisfechas y desbloqueadas.

Pero **lo que falta no es Docker.** El camino crítico pasa por fusionar y desplegar la rama
`claude/security-audit-plan-xna7ct`: tres de las seis migraciones dependen de código que
producción todavía no tiene. Con Docker instalado esta noche, seguirían siendo inaplicables.

A cambio, hay **tres migraciones que puedes aplicar hoy** — sin Docker y sin desplegar — y una de
ellas cierra una escalada de privilegios que lleva abierta en producción todo este tiempo.

---

## 2. Lo que confirmaste, y vale

| Chequeo | Tu resultado | Qué desbloquea |
|---|---|---|
| **0.1** owner de las `SECURITY DEFINER` | `postgres` en las 7 | **003 es aplicable.** Sin esto, la suposición de que la cadena de trigger sobrevive al `REVOKE` se cae y había que parar |
| **0.2** drift de columnas | falta **1** (`price_cache.fundamentals_refresh_started_at`) | 002 es casi un no-op; es idempotente (`add column if not exists`), así que es seguro aunque 8 de las 9 ya existan |
| **0.3** duplicados de email | cero filas | **006 desbloqueado.** Su propio bloque de guarda (paso 1 del archivo) lo re-verifica antes de tocar nada |
| **0.4** snapshots RLS / triggers / extensiones | obtenidos | Referencia para el Paso 4. `db diff` **no** cubre grants, owners, Auth, Storage ni objetos fuera de `public`: por eso este snapshot no es opcional |

### Hallazgo extra tuyo que cierra una duda abierta

**`get_top_tickers` sí existe en producción**, con owner `postgres` y `security definer = true`.

El runbook advertía que en el DDL vigente esa función solo está **comentada**, y que si no aparecía
en la consulta 0.1 significaba que el RPC que invoca `lib/ai/news-pipeline.ts:111` estaba roto
**ahora mismo** — fuera del alcance de esta remediación, pero había que anotarlo. Apareció. No hay
nada que arreglar ahí.

### Y confirma lo que ya habías dicho

Tu §4.2 demuestra que las 8 columnas que `schema.sql` no define **ya estaban aplicadas a mano** en
producción. El drift real era de 1 columna, no de 6. Coincide con tu respuesta de hace días
("prod está al día"), que ahora está medida en vez de supuesta.

---

## 3. El bloqueo de verdad: el código no está desplegado

```bash
git ls-tree -r --name-only origin/master | grep -c "share-team"   #  →  0
```

La rama está pusheada pero **no fusionada**. Producción corre `master`, que no tiene el endpoint
`share-team`, ni la normalización de ticker, ni el cambio de `peers/init`. Consecuencia directa:

- **004** → rompe **"compartir con Team Evolve"**. La lectura del navegador
  `.eq('is_team_evolve', true)` muere con la política acotada y no hay endpoint que la reemplace.
- **005** → rompe **"añadir activo"**, y lo hace **en silencio**: un ticker en minúsculas falla el
  `WITH CHECK`, el error se descarta y `addAsset` cae en FK 23503.
- **007** → el runbook lo coloca después de 004.

Tu §9 dice que la siguiente acción exacta es instalar Docker y correr `db pull`. **No lo es.**

---

## 4. Lo que sí puedes aplicar hoy — sin Docker y sin desplegar

### 002 y 003

Ninguna de las dos depende de código de la rama.

- **002** además está en el camino crítico: el runbook lo pide **antes** de desplegar el código de
  PR2/PR6. Aditivo puro; el `not null default false` en `profiles` es metadata-only en PG11+.
- **003** son solo grants, y tu consulta 0.1 ya lo autorizó.
  Nota: el backfill manual `SELECT seed_<name>_watchlist(id) FROM profiles` **sigue funcionando**
  después de 003, porque el SQL Editor corre como `postgres` y el `revoke ... from public` no toca
  los privilegios implícitos del owner.

### 007 — y esto no estaba en tu reporte

**007 tampoco depende de código de la rama.** El único UPDATE de navegador sobre `profiles` que
existe en `master` es:

```
components/onboarding/TourProvider.tsx:117
  supabase.from('profiles').update({ onboarding_seen: true }).eq('id', userId)
```

y `onboarding_seen` está justo en el `grant` de 007. Además:

- `service_role` **no se toca** (tiene grant propio, no depende del de `PUBLIC`).
- `handle_new_user()` inserta como owner → el `revoke` no le afecta.

O sea: **007 cierra hoy la escalada de privilegios, sin romper nada y sin esperar el deploy.** La
dependencia con 004 que marca el runbook es narrativa, no técnica.

### Lo único urgente de verdad

007 bloquea futuras auto-promociones, pero **no revierte las que ya ocurrieron**. El agujero
(`update profiles set is_team_evolve = true` desde la consola del navegador) ha estado abierto en
producción. Antes o después de aplicar 007, corre esto y **compara la lista contra el equipo real**:

```sql
select id, email, is_team_evolve, created_at
from   profiles
where  is_team_evolve = true
order  by created_at;
```

---

## 5. Docker: qué compra y qué no

| No necesitan Docker | Lo necesitan |
|---|---|
| `db push`, `migration repair`, `migration list`, SQL Editor | `db pull`, `db dump`, `db reset`, `db diff` |

Lo importante: **las dos verificaciones que de verdad importan corren en el SQL Editor de
producción**, sin Docker. Los dos scripts terminan en `RAISE EXCEPTION` a propósito → ROLLBACK,
así que no persiste nada:

- **`scripts/verify-seed.sql`** — "¿sigue funcionando el signup?", el eslabón más frágil del sistema.
- **`scripts/verify-rls.sql`** — 21 casos negativos con dos usuarios reales.
  ⚠️ **No lo has corrido y no está en tu lista de pendientes.** Requiere un rol que pueda
  `SET ROLE authenticated` e insertar en `auth.users` (en Supabase, `postgres`).

Sin Docker pierdes exactamente tres cosas:

1. el baseline por introspección,
2. tu condición de parada #1 (`db diff --linked` vacío),
3. el ensayo local con `db reset`.

Vale la pena instalarlo — es el único chequeo **mecánico** de que no hay más drift del que ya
mediste a mano — pero **no dejes que bloquee 002 / 003 / 007**.

---

## 6. Dos trampas del camino CLI

### 6.1 El orden de versiones

`db pull` genera el baseline con un timestamp de 14 dígitos (`20260918…`). Nuestros deltas se
llaman `002_…`, `003_…`. Al marcar el baseline como `applied`, el CLI verá 002–007 como
**anteriores a la última migración remota** y los va a **saltar**, avisando de migraciones fuera de
orden.

Salidas:

- correr `supabase migration list` **antes** de cualquier push, para verlo;
- y después, o `db push --include-all`, o **renombrar los seis deltas** a timestamps posteriores al
  baseline.

### 6.2 `db push` aplica todo lo pendiente de golpe

Tu regla #4 ("no aplicar en lote") es correcta y `db push` no tiene selección por archivo. Para
cumplirla: deja en `supabase/migrations/` solo el delta siguiente, o aplícalos por el SQL Editor.
**Cada archivo lleva su propio bloque de reversión comentado al final.**

---

## 7. Orden corregido

- [ ] **1 · Hoy, sin Docker ni deploy**
  - [ ] Auditar `is_team_evolve = true` (consulta de §4) y contrastar con el equipo real
  - [ ] **002** → `verify-seed.sql`
  - [ ] **003**
  - [ ] **007** → `verify-rls.sql` (los casos 18–20 comprueban que el tour de onboarding sigue guardando)
- [ ] **2 · Docker** → `db pull` → renombrar → `migration repair --status applied` → `db diff --linked` vacío → `db reset` local
- [ ] **3 · Fusionar y desplegar la rama** `claude/security-audit-plan-xna7ct` — es la puerta de 004/005
- [ ] **4 · 004** → `verify-seed.sql` → probar "compartir con Team Evolve"
- [ ] **5 · 005** → `verify-seed.sql` → probar "añadir activo" **con un ticker en minúsculas**
- [ ] **6 · 006** en su propia ventana (toca `handle_new_user`) → `verify-seed.sql` + un registro real en preview
- [ ] **7 · Smoke tests del deploy** (tu reporte no los cubre porque es solo de DB)
  - [ ] Login y refresh de sesión — subió `@supabase/supabase-js` 11 minors
  - [ ] Pipeline de noticias completo — subió `firecrawl` 15 minors
  - [ ] **`/vs-peers` en preview** — el crítico: ejercita la unión de ~475 tickers por `quote` **y** por `returns`
- [ ] **8 · Auditoría final** — re-correr las consultas del Paso 0 y compararlas con tus snapshots

---

## 8. Nota menor

`npm install -g supabase` funcionó (2.117.0), pero Supabase desaconseja la instalación global por
npm. Si da problemas al actualizar, Scoop es el camino soportado en Windows.
