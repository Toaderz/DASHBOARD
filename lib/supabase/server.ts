import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Privileged (service-role) access lives in `lib/supabase/service-role.ts`, which is `server-only`
// and fails closed. The dead `createAdminClient` that used to live here built a service-role client
// with a COOKIE-based auth adapter (nonsensical for a service role) and had zero importers.

type CookiesToSet = Array<{ name: string; value: string; options?: Record<string, unknown> }>

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            )
          } catch {
            // Server Component — cookies are read-only; handled by middleware
          }
        },
      },
    }
  )
}
