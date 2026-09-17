# Runbook — pasos de Supabase que hay que correr a mano

El CLI de Supabase **no está disponible** en el entorno donde se preparó esta remediación, y no
hay proyecto linkeado. Los archivos `.sql` se entregan listos; **estos pasos los corres tú** en
local, con el proyecto linkeado. Están en el orden en que hay que ejecutarlos.

Requisitos: `supabase` CLI instalado, `supabase login` hecho, y `supabase link --project-ref <ref>`
apuntando al proyecto correcto. Ten a mano acceso al SQL Editor del dashboard para las consultas
de inspección.

---

## Paso 0 — Antes de nada: consultas de inspección (solo lectura)

Corre esto **en el SQL Editor de producción** y guarda la salida. Es el snapshot de referencia y
además valida dos suposiciones de las que depende `003_harden_seed_grants.sql`.

### 0.1 Owner y ACL de las funciones `SECURITY DEFINER`

Si alguna función **no** es propiedad de `postgres`, la suposición de que la cadena de trigger
sobrevive al `REVOKE` se cae y hay que parar.

```sql
select  p.proname,
        pg_get_userbyid(p.proowner) as owner,
        p.prosecdef                 as security_definer,
        p.proacl                    as acl
from    pg_proc p
join    pg_namespace n on n.oid = p.pronamespace
where   n.nspname = 'public'
  and   p.proname in (
          'handle_new_user',
          'handle_new_user_default_watchlists',
          'seed_first_trust_watchlist',
          'seed_evolve_universe_watchlist',
          'seed_pershing_square_watchlist',
          'get_shared_watchlist_ids',
          'get_top_tickers'
        )
order by p.proname;
```

Qué esperar: `owner = postgres` y `security_definer = t` en todas.
`get_top_tickers` **puede no aparecer**: en el DDL vigente solo existe comentada, aunque
`lib/ai/news-pipeline.ts:111` la invoca. Si no aparece, ese RPC está roto en producción **ahora**
y hay que crearla (fuera del alcance de esta remediación; anótalo).

### 0.2 Qué columnas existen de verdad (confirma el drift de 8 columnas)

```sql
select table_name, column_name
from   information_schema.columns
where  table_schema = 'public'
  and  (   (table_name = 'price_cache' and column_name in
             ('currency','inception_date','morningstar_category','global_category',
              'price_to_book','median_market_cap','fundamentals_refresh_started_at'))
        or (table_name = 'profiles'    and column_name in
             ('onboarding_seen','is_team_evolve'))
       )
order by table_name, column_name;
```

Cada columna que **no** salga aquí es drift real. `002_add_missing_columns.sql` las añade todas de
forma idempotente, así que es seguro aunque algunas ya existan.

### 0.3 Duplicados de email en `profiles` (bloquea `006`)

```sql
select lower(email) as email_norm, count(*), array_agg(id) as ids
from   profiles
where  email is not null
group  by 1
having count(*) > 1;
```

Si esto devuelve filas, **no apliques `006`**: primero hay que decidir cómo resolver cada
duplicado. El índice único fallaría y, peor, hoy ya es un bug vivo (`.maybeSingle()` con
duplicados devuelve `PGRST116` y `/api/users/find` reporta "Usuario no encontrado").

### 0.4 Políticas RLS, triggers y extensiones (snapshot de referencia)

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from   pg_policies where schemaname = 'public' order by tablename, policyname;

select  c.relname as table_name, t.tgname, p.proname as function_name, t.tgenabled
from    pg_trigger t
join    pg_class c on c.oid = t.tgrelid
join    pg_proc  p on p.oid = t.tgfoid
where   not t.tgisinternal
order by 1, 2;

select extname, extversion from pg_extension order by 1;
```

Guarda las tres salidas. `supabase db diff` **no** cubre grants, owners, configuración de Auth,
Storage ni objetos fuera de `public`: por eso este snapshot es aparte y no opcional.

## Paso 1 — Generar el baseline por introspección (no escrito a mano)

El baseline **es** el estado real de producción, no lo que `schema.sql` cree que es. Así el drift
se revela en vez de asumirse.

```bash
supabase db pull --schema public
# renombra el archivo generado a supabase/migrations/001_baseline.sql si el CLI no lo hizo ya
```

Ahora márcalo como **ya aplicado**, para que su DDL **no corra nunca en producción** (solo escribe
la fila de estado en `supabase_migrations.schema_migrations`):

```bash
supabase migration list                      # confirma el timestamp del baseline
supabase migration repair --status applied <timestamp-del-baseline>
supabase migration list                      # ahora debe salir como applied en remoto
```

Guarda además una copia inmutable de referencia:

```bash
supabase db dump --schema public -f docs/security/prod-schema-before-remediation-2026-09-17.sql
```

Comprobación de que el paso salió bien: `supabase db diff --linked` debe salir **vacío**.
Si no está vacío, para: significa que el pull no capturó algo y aplicar deltas encima es
arriesgado.

## Paso 2 — Aplicar los deltas, uno a uno, verificando entre cada uno

Cada archivo lleva su propio bloque de reversión comentado al final. **No los apliques en lote.**

```bash
supabase db reset          # PRIMERO en local: reconstruye desde cero con baseline + deltas
psql "$LOCAL_DB_URL" -f scripts/verify-seed.sql   # debe reportar watchlists=3
supabase db lint
```

Orden y condición de cada delta:

| Delta | Cuándo aplicar | Condición previa |
|---|---|---|
| `002_add_missing_columns.sql` | **Antes** de desplegar el código de PR2/PR6 | Ninguna. Aditivo puro; `not null default false` en `profiles` es metadata-only en PG11+ |
| `003_harden_seed_grants.sql` | Tras 002 | **El paso 0.1 debe mostrar `owner = postgres`** en todas |
| `004_narrow_profiles.sql` | **Después** de desplegar el endpoint `share-team` de PR4 | Si lo aplicas antes, "compartir con Team Evolve" se rompe |
| `005_restrict_assets_metadata.sql` | **Después** de desplegar la normalización de ticker y el cambio de `peers/init` | Si lo aplicas antes, "añadir activo" falla en silencio con FK 23503 |
| `006_profiles_email_unique.sql` | Solo si el paso 0.3 devolvió **cero filas** | Va en su propio despliegue: toca `handle_new_user()`, que es crítico para el signup |

Tras cada delta en remoto:

```bash
supabase db push
supabase db diff --linked   # debe quedar vacío
```

## Paso 3 — Verificación del trigger de signup (el más frágil del sistema)

`scripts/verify-seed.sql` inserta un `auth.users` falso, cuenta las watchlists y los assets
sembrados, y termina en `RAISE EXCEPTION` — que hace **ROLLBACK**, así que no persiste nada, y es
la única forma de ver el resultado (`RAISE NOTICE` **no** aparece en el panel de resultados del
SQL Editor de Supabase).

- **Éxito**: reporta `watchlists=3` con los tres nombres esperados.
- **`23503` en `watchlist_assets_asset_ticker_fkey`**: una seed inserta un ticker que no existe en
  `assets_metadata`. Significa que **el signup está roto ahora mismo**, no que la migración falló.
- **`23503` en `watchlist_assets_watchlist_id_fkey`**: la seed está corrupta en la base de datos
  (cuerpo sin `DECLARE v_watchlist_id` / sin `INSERT INTO watchlists RETURNING id`). La fuente
  correcta está en `supabase/schema.sql`. ⚠️ Si la versión corrupta se guardó con el parámetro mal
  nombrado, `CREATE OR REPLACE` lanza **42P13** (`cannot change name of input parameter`): hay que
  `DROP FUNCTION seed_<name>_watchlist(uuid)` primero.

Corre esto **después de cada delta** que toque `profiles`, `watchlists`, `watchlist_assets` o
`assets_metadata` — es decir, después de 002, 004, 005 y 006.

## Paso 4 — Lo que `db diff` no cubre

`db diff --linked` vacío es **necesario pero no suficiente**. Antes de dar la migración por buena,
vuelve a correr las consultas del paso 0 y **compáralas** con el snapshot guardado. Revisa aparte:
grants, owners, cuerpos de función, políticas RLS, triggers, configuración de Auth, Storage,
extensiones y cualquier objeto fuera del esquema `public`.
