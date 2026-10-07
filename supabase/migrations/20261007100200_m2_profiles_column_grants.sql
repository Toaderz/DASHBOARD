-- M2 · N-01 · profiles: ningún cliente puede escribir salvo onboarding_seen
-- Certeza: CONFIRMADO (Anexo A, 4b): anon y authenticated tienen INSERT/UPDATE en todas las columnas;
-- hoy solo lo frena RLS ("own profile update" no limita columnas → un usuario puede ponerse is_team_evolve = true).
--
-- ORDEN: después de M0. Independiente del código desplegado.
-- Inventario de escrituras a profiles desde el cliente (grep 2026-10-07):
--   · components/onboarding/TourProvider.tsx:117 → update({ onboarding_seen }) con la sesión del usuario → se conserva.
--   · scripts/manage-team-evolve.mjs → service_role (ignora estos grants).
--   · el INSERT lo hace el trigger handle_new_user (SECURITY DEFINER).
--   Ningún cliente hace INSERT en profiles. CONFIRMADO por grep.
-- No se toca SELECT (eso es M4). El UPDATE por columnas sigue sujeto a la política RLS "own profile update".
--
-- ── PRECHECK (solo lectura) ──────────────────────────────────────────────────────────────
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon','authenticated')
--     and privilege_type in ('INSERT','UPDATE') order by 1, 2, 3;
--
-- ── REVERSA (exacta) ─────────────────────────────────────────────────────────────────────
--   grant insert, update on table public.profiles to anon, authenticated;
--
-- ── POSTCHECK: en la app terminar o saltar el tour (debe seguir guardando onboarding_seen)
--    y correr el Anexo C, prueba N-01a → "Bloqueado".

revoke insert, update on table public.profiles from public, anon, authenticated;
grant update (onboarding_seen) on table public.profiles to authenticated;
