-- ============================================================
-- 006 — Unicidad de email en `profiles` (case-insensitive)
-- ============================================================
-- Va en SU PROPIO ARCHIVO y en SU PROPIO DESPLIEGUE. Es el único delta de este
-- lote que modifica `handle_new_user()`, que es la primera función de la cadena
-- de alta de usuarios: si se rompe, nadie puede registrarse.
--
-- CUÁNDO APLICAR: **solo si el paso 0.3 del runbook devolvió CERO filas.**
-- Exige despliegue propio y prueba end-to-end de signup (scripts/verify-seed.sql
-- + un registro real en preview).
--
-- ------------------------------------------------------------
-- POR QUÉ ESTO YA ES UN BUG VIVO, NO UNA MEJORA TEÓRICA
-- ------------------------------------------------------------
-- 1. `app/api/users/find/route.ts` normaliza el email a minúsculas y consulta
--    con `.maybeSingle()`. Con duplicados, PostgREST devuelve **PGRST116** y la
--    ruta responde "Usuario no encontrado" → compartir por email falla.
-- 2. `handle_new_user()` guarda `new.email` **tal cual**, sin normalizar.
--    Una fila con mayúsculas (p.ej. 'Alejandro@evolveam.com.mx') es
--    **inencontrable para siempre** desde esa ruta, que busca en minúsculas.
--
-- ORDEN DE ESTE ARCHIVO (documentado a propósito — cada paso depende del anterior):
--    0. inspeccionar duplicados  → paso 0.3 del runbook / bloque de guarda (paso 1)
--    1. decidir la resolución    → MANUAL, fuera de esta migración
--    2. normalizar lo existente  → paso 2
--    3. corregir la creación futura → paso 3
--    4. crear el índice único    → paso 4
-- Crear el índice antes de normalizar fallaría; normalizar antes de arreglar
-- `handle_new_user()` dejaría entrar filas nuevas sin normalizar por la ventana
-- entre ambos pasos.
-- ============================================================

-- ------------------------------------------------------------
-- PASO 1 — Guarda: abortar limpiamente si hay duplicados
-- ------------------------------------------------------------
-- Sin esto, el `create unique index` del paso 4 fallaría con un mensaje opaco a
-- mitad del archivo, dejando aplicados los pasos 2 y 3.
do $$
declare
  v_dups int;
  v_sample text;
begin
  -- Conteo COMPLETO de emails duplicados (ignorando mayúsculas y espacios).
  select count(*) into v_dups
  from (
    select 1
    from   public.profiles
    where  email is not null
    group  by lower(btrim(email))
    having count(*) > 1
  ) d;

  -- Muestra acotada, solo para el mensaje de error.
  select coalesce(string_agg(email_norm, ', '), '')
    into v_sample
  from (
    select lower(btrim(email)) as email_norm
    from   public.profiles
    where  email is not null
    group  by 1
    having count(*) > 1
    order  by 1
    limit  10
  ) s;

  if v_dups > 0 then
    raise exception
      '006 ABORTADA: hay % email(s) duplicados en profiles (ignorando mayúsculas). '
      'Resuélvelos A MANO antes de aplicar este archivo — decidir qué fila sobrevive '
      'NO es automatizable (cada una puede tener watchlists y shares propios). '
      'Muestra: [%]. Consulta completa en el paso 0.3 de docs/security/RUNBOOK-SUPABASE.md.',
      v_dups, v_sample;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- PASO 2 — Normalizar los emails existentes
-- ------------------------------------------------------------
-- Tras la guarda sabemos que no hay colisiones, así que este UPDATE no puede
-- crear duplicados.
update public.profiles
set    email = lower(btrim(email))
where  email is not null
  and  email is distinct from lower(btrim(email));

-- ------------------------------------------------------------
-- PASO 3 — Corregir la creación futura (⚠️ CAMBIO CRÍTICO DE SIGNUP)
-- ------------------------------------------------------------
-- ⚠️ Esta es la función que dispara `on_auth_user_created` sobre `auth.users`.
-- Si falla, **la creación del usuario se aborta entera** (ni perfil ni cuenta).
-- El cuerpo de abajo es el de `supabase/schema.sql:187` LETRA POR LETRA, con un
-- único cambio: `new.email` → `lower(btrim(new.email))`. No se añade nada más.
--
-- ⚠️ Riesgo 42P13 (`cannot change name of input parameter`): `handle_new_user()`
-- NO tiene parámetros de entrada, así que `create or replace` es seguro aquí.
-- Se deja el DROP escrito y COMENTADO como advertencia porque las funciones
-- `seed_*_watchlist(p_user_id uuid)` de esta misma cadena SÍ tienen parámetro y
-- ya provocaron ese error una vez al intentar repararlas. **No descomentes esto
-- salvo que el CREATE OR REPLACE falle**: el DROP se lleva por delante el
-- trigger `on_auth_user_created` (CASCADE) y hay que recrearlo.
--   -- drop function if exists public.handle_new_user() cascade;
--   -- (y después: drop trigger if exists on_auth_user_created on auth.users;
--   --             create trigger on_auth_user_created after insert on auth.users
--   --               for each row execute function handle_new_user();)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(btrim(new.email)),   -- ← ÚNICO cambio respecto a schema.sql:187
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- El REVOKE de 003 sobre esta función se conserva: `create or replace` NO
-- reinicia la ACL de una función existente. Aun así, reafírmalo por si este
-- archivo se aplicara en un entorno donde 003 nunca corrió.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ------------------------------------------------------------
-- PASO 4 — El índice único funcional
-- ------------------------------------------------------------
-- Funcional sobre `lower(email)`: hace la unicidad case-insensitive sin cambiar
-- el tipo de la columna ni exigir citext. Los NULL no colisionan entre sí en un
-- índice único de Postgres, así que los perfiles sin email siguen permitidos.
create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email));

-- ============================================================
-- REVERSIÓN (comentada a propósito)
-- ============================================================
-- El índice se revierte limpio. La normalización de emails (paso 2) NO tiene
-- vuelta atrás: no se guarda el casing original. Si eso importa, saca un dump de
-- `select id, email from profiles` ANTES de aplicar.
--
-- drop index if exists public.profiles_email_lower_key;
--
-- Y para devolver handle_new_user() a su forma anterior (guardar new.email
-- sin normalizar) — solo si el signup se rompe y hay que volver YA:
-- create or replace function public.handle_new_user()
-- returns trigger language plpgsql security definer set search_path = public as $revert$
-- begin
--   insert into profiles (id, email, full_name, avatar_url)
--   values (new.id, new.email,
--           new.raw_user_meta_data ->> 'full_name',
--           new.raw_user_meta_data ->> 'avatar_url')
--   on conflict (id) do nothing;
--   return new;
-- end;
-- $revert$;
--
-- Verificación obligatoria tras aplicar:
--   1. psql -f scripts/verify-seed.sql  → debe reportar VERIFY-SEED OK watchlists=3
--   2. registro real de una cuenta nueva en preview → perfil creado + 3 watchlists
--   3. compartir por email con esa cuenta → /api/users/find la encuentra
