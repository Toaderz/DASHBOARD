import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `lib/supabase/service-role.ts` starts with `import 'server-only'`, which THROWS outside a React
// Server Component environment. Stubbing it here is what lets the module be unit-tested at all —
// and the fact that this stub is required is itself the proof the guard is in place.
vi.mock('server-only', () => ({}))

import { createCacheClient, createServiceRoleClient } from '@/lib/supabase/service-role'

const URL = 'https://example.supabase.co'
const SERVICE_KEY = 'service-role-key'
const ANON_KEY = 'anon-key'

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  // Silence the intentional structured warnings this suite provokes.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k] as string
  }
  vi.restoreAllMocks()
})

describe('createServiceRoleClient — fail closed', () => {
  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    expect(() => createServiceRoleClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('throws when the URL is missing', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    expect(() => createServiceRoleClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('throws on an empty-string key rather than treating it as present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = ''
    expect(() => createServiceRoleClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('NEVER falls back to the anon key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    // The old `SERVICE_ROLE ?? ANON` shape would have produced a working (but unprivileged) client.
    expect(() => createServiceRoleClient()).toThrow()
  })

  it('builds a client when both are present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    expect(createServiceRoleClient()).toBeTruthy()
  })
})

describe('createCacheClient — models the RLS read/write split', () => {
  it('canWrite: true with a service-role key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    expect(createCacheClient('quote').canWrite).toBe(true)
  })

  it('canWrite: false — anon client, reads still served', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    const { client, canWrite } = createCacheClient('quote')
    expect(canWrite).toBe(false)
    expect(client).toBeTruthy()
  })

  it('degradation is announced, never silent', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY
    createCacheClient('returns')
    const warned = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(warned.length).toBeGreaterThan(0)
    expect(String(warned[0][0])).toContain('service_role_missing')
    expect(String(warned[0][0])).toContain('returns')
  })

  it('throws when there is no key at all', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL
    expect(() => createCacheClient('quote')).toThrow()
  })

  it('throws when the URL is missing', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    expect(() => createCacheClient('quote')).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})
