import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { OBS, obsError, obsWarn } from '@/lib/utils/obs'

/**
 * THE single constructor for privileged (service-role) Supabase access.
 *
 * `import 'server-only'` is the first line on purpose: it turns an accidental client-side import
 * into a BUILD error instead of a latent way to ship the service-role key to a browser bundle.
 *
 * ⚠️ Because of that import this module must never be reachable from `scripts/**`, which run under
 * `tsx`/`node` outside React Server Components (`server-only` throws there). `lib/ai/news-pipeline.ts`
 * receives its client as a PARAMETER (`runNewsPipeline(supabaseAdmin)`) precisely so the scripts can
 * build their own client with plain `@supabase/supabase-js` and never touch this file.
 *
 * Per CLAUDE.md, callers must invoke these factories INSIDE the request handler — never at module
 * scope in an API route.
 */

/** Server-side clients are stateless: no session to persist, nothing to auto-refresh. */
const SERVER_AUTH_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const

function readUrl(): string | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  return url && url.length > 0 ? url : undefined
}

function readServiceRoleKey(): string | undefined {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return key && key.length > 0 ? key : undefined
}

function readAnonKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return key && key.length > 0 ? key : undefined
}

/**
 * FAIL-CLOSED privileged client. Throws when the URL or the service-role key is missing.
 *
 * There is deliberately NO fallback to the anon key: every table this client touches has
 * service-role-only write policies, so an anon fallback produces writes that silently fail RLS
 * while the code believes it is privileged. A loud throw is the correct outcome.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = readUrl()
  const key = readServiceRoleKey()

  if (!url || !key) {
    const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(Boolean)
      .join(', ')
    obsError({ event: OBS.CONFIG_ERROR, reason: 'service_role_unavailable', missing })
    throw new Error(
      `Supabase service-role client unavailable: missing ${missing}. ` +
        'Refusing to fall back to the anon key (writes would silently fail RLS).'
    )
  }

  return createClient(url, key, SERVER_AUTH_OPTIONS)
}

export interface CacheClient {
  client: SupabaseClient
  /**
   * `true` only when the client was built with the service-role key.
   * `price_cache` / `returns_cache` grant public SELECT but restrict INSERT/UPDATE to the service
   * role, so a `false` here means every write WILL be rejected. Check it before writing.
   */
  canWrite: boolean
}

/**
 * Cache-tier client, modelling the real RLS split: reads are public, writes are service-role only.
 *
 * With a service-role key → privileged client, `canWrite: true`.
 * Without one → anon client, `canWrite: false`, plus a LOUD structured log. The route can still
 * serve reads (availability preserved) but must not pretend its writes landed.
 *
 * This replaces the old `SUPABASE_SERVICE_ROLE_KEY ?? NEXT_PUBLIC_SUPABASE_ANON_KEY!` fallback,
 * which produced an anon client that looked privileged and whose cache writes always failed.
 */
export function createCacheClient(endpoint?: string): CacheClient {
  const url = readUrl()
  if (!url) {
    obsError({ event: OBS.CONFIG_ERROR, endpoint, reason: 'missing_supabase_url' })
    throw new Error('Supabase cache client unavailable: missing NEXT_PUBLIC_SUPABASE_URL.')
  }

  const serviceKey = readServiceRoleKey()
  if (serviceKey) {
    return { client: createClient(url, serviceKey, SERVER_AUTH_OPTIONS), canWrite: true }
  }

  const anonKey = readAnonKey()
  if (!anonKey) {
    obsError({ event: OBS.CONFIG_ERROR, endpoint, reason: 'no_supabase_key' })
    throw new Error(
      'Supabase cache client unavailable: neither SUPABASE_SERVICE_ROLE_KEY nor ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY is set.'
    )
  }

  // Degraded, but never silently: reads work, writes are disabled and announced.
  obsWarn({
    event: OBS.SERVICE_ROLE_MISSING,
    endpoint,
    reason: 'SUPABASE_SERVICE_ROLE_KEY not set — cache is read-only for this request',
  })
  return { client: createClient(url, anonKey, SERVER_AUTH_OPTIONS), canWrite: false }
}
