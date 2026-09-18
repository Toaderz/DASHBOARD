-- ============================================================
-- 007 — `profiles`: quitar del cliente las columnas que no le pertenecen
-- ============================================================
-- HALLAZGO del pase de `security-review` sobre el diff de esta remediación
-- (severidad ALTA: escalada de privilegios). No es teórico.
--
-- ------------------------------------------------------------
-- EL AGUJERO
-- ------------------------------------------------------------
-- `002_add_missing_columns.sql` añade `profiles.is_team_evolve` y su COMMENT
-- declara el invariante: «Ningún cliente autenticado debe poder escribirlo».
-- Nada lo hacía cumplir. La única política de UPDATE sobre `profiles` es
-- (`supabase/schema.sql`):
--
--     create policy "own profile update" on profiles
--       for update using (auth.uid() = id);
--
-- Sin `with check`, Postgres reutiliza el `using`: la fila resultante solo tiene
-- que seguir siendo la del propio usuario. Qué COLUMNAS cambian no se restringe.
-- Y como Supabase concede `update` a nivel de TABLA a `authenticated`, todas las
-- columnas entran en el alcance.
--
-- Cadena de explotación (una sola sentencia desde la consola del navegador):
--
--     await supabase.from('profiles').update({ is_team_evolve: true }).eq('id', myId)
--
-- El atacante queda dentro del grupo de confianza interno. A partir de ahí, cada
-- vez que un empleado real usa el flujo documentado de "Team Evolve",
-- `/api/watchlists/[id]/share-team` enumera `is_team_evolve = true` con el
-- service role e inserta un share **para el atacante**, que luego lee el
-- contenido de esa watchlist vía `shared_read_watchlists`/`shared_read_assets`.
-- No hace falta ninguna acción más: la escalada es invisible para el dueño, cuyo
-- diálogo solo informa de un conteo.
--
-- Impacto secundario de la MISMA política, relevante por 006: `profiles.email`
-- también es escribible por el cliente. Un atacante puede ponerse el email de un
-- compañero que AÚN NO tiene cuenta; `/api/users/find?email=` resolvería esa
-- dirección a su propio id, así que cualquier "compartir por email" a ese
-- compañero se entregaría al atacante. Y cuando el compañero real se registre,
-- el índice único de 006 lanza 23505 dentro de `handle_new_user()` → el alta
-- entera aborta (la cadena de aborto que documenta CLAUDE.md).
--
-- ------------------------------------------------------------
-- POR QUÉ ESTE ARREGLO Y NO OTRO
-- ------------------------------------------------------------
-- Se arregla con GRANTS de columna, no con la política, por dos razones:
--   1. Reescribir `own profile update` con un `with check` que ancle las columnas
--      protegidas exige una subconsulta a `profiles` dentro de la propia política
--      de `profiles` — recursión de RLS que habría que romper con otro
--      SECURITY DEFINER. Más piezas móviles para el mismo resultado.
--   2. Un privilegio ausente no se puede eludir con una política mal escrita en
--      el futuro. Es el control más duro de los dos.
--
-- ⚠️ ORDEN OBLIGATORIO: primero `revoke update` a nivel de TABLA, luego `grant`
-- por columna. En PostgreSQL los ACL de tabla y de columna se guardan aparte: un
-- `revoke update (col)` contra un grant de TABLA **no hace nada** (emite un
-- warning y sigue). Hay que retirar el grant de tabla y volver a conceder
-- exactamente las columnas permitidas.
--
-- ------------------------------------------------------------
-- QUÉ SIGUE ESCRIBIENDO EL CLIENTE (verificado, no supuesto)
-- ------------------------------------------------------------
-- Un solo UPDATE de navegador toca `profiles` en todo el repo:
--   components/onboarding/TourProvider.tsx:117
--     supabase.from('profiles').update({ onboarding_seen: true }).eq('id', userId)
-- `full_name` y `avatar_url` no los escribe nadie hoy, pero son datos del propio
-- usuario y un editor de perfil es esperable → se conceden.
-- NO se conceden: `id` (la identidad), `email` (la resuelve `handle_new_user`
-- desde `auth.users`; cambiarla es cosa de Auth, no de la tabla) ni
-- `is_team_evolve` (pertenencia al equipo, gestionada con service role).
--
-- INSERT no se toca: `own profile insert` exige `auth.uid() = id` y la fila ya
-- existe siempre (la crea `handle_new_user()` como owner dentro del alta), así
-- que un insert del cliente choca con la PK. No es una vía de escalada.
--
-- IDEMPOTENTE: `revoke`/`grant` se pueden reaplicar sin efecto acumulativo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Retirar el UPDATE de tabla (el que arrastra todas las columnas)
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated, anon, public;

-- ------------------------------------------------------------
-- 2. Devolver SOLO las columnas que el usuario puede escribir de su propia fila
--    (la política `own profile update` sigue acotando la fila a `auth.uid() = id`;
--     esto acota además las COLUMNAS)
-- ------------------------------------------------------------
grant update (full_name, avatar_url, onboarding_seen) on public.profiles to authenticated;

-- `anon` no escribe nada en profiles: no se le devuelve ninguna columna.

comment on column public.profiles.is_team_evolve is
  'Pertenencia a Team Evolve. Se gestiona FUERA de la app (service role / panel de '
  'Supabase). NO escribible por authenticated: 007 retiró el UPDATE de tabla y no '
  'concedió esta columna. Enumerar el roster tampoco es posible desde el navegador '
  '(004) y /api/watchlists/[id]/share-team exige que el LLAMANTE sea miembro.';
