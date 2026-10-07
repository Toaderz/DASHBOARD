-- M00 · N-15 · RLS activo en profiles
-- Certeza: CONFIRMADO. En producción profiles tenía rls=false (Anexo A); Alejandro lo corrigió a mano el
-- 2026-10-07 y verificó relrowsecurity = true. supabase/schema.sql ya lo declara; este archivo deja el
-- cambio registrado y hace que staging o un entorno nuevo no repitan el desfase. Idempotente.
--
-- ORDEN: primero de todos. En producción ya está aplicado: correrlo es inofensivo.
--
-- ── PRECHECK (solo lectura): debe devolver rls = true después de aplicar ────────────────
--   select relname, relrowsecurity as rls from pg_class
--   where relnamespace = 'public'::regnamespace and relname = 'profiles';
--
-- ── REVERSA: NO se recomienda (dejaría profiles legible y editable por cualquiera con la clave anon).
--   alter table public.profiles disable row level security;

alter table public.profiles enable row level security;
