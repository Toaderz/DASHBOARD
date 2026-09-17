import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { OBS, errMessage, obsError, obsWarn } from '@/lib/utils/obs'

/**
 * Authorization gate for the market endpoints.
 *
 * WHY THIS EXISTS: `lib/supabase/middleware.ts` deliberately EXEMPTS `/api` from the route gate
 * and `proxy.ts` only refreshes the session, so a route handler that does not check for itself is
 * fully anonymous — `/api/market/*` was an open proxy onto Yahoo Finance plus a write path into
 * `price_cache`/`returns_cache`. There is no middleware safety net behind this function.
 *
 * COST, ACCEPTED ON PURPOSE: `updateSession` already calls `auth.getUser()` on every request
 * (including `/api/*`, and it runs BEFORE this check), so this adds a second GoTrue round-trip on a
 * route the dashboard polls every 5 s. Correctness over the round-trip; do not "optimise" it by
 * trusting an unverified cookie/JWT.
 *
 * CALL IT FIRST. Every handler must `requireUser()` before parsing input, before touching Yahoo and
 * before any cache write. A 401 must mean zero upstream requests and zero database writes — that
 * invariant is asserted in `lib/auth/require-user.test.ts` and in the per-route tests.
 */

export interface AuthorizedUser {
  id: string
  email: string | null
  /** How the caller proved identity. `cron` is the machine branch (see `bearerMatches`). */
  via: 'session' | 'cron'
}

export type RequireUserResult =
  | { ok: true; user: AuthorizedUser }
  | { ok: false; response: NextResponse }

export interface RequireUserContext {
  /** Short endpoint label for logs, e.g. `'quote'`. */
  endpoint: string
  /** Correlation id minted by the handler, so the auth line joins the rest of the request. */
  cid: string
}

/**
 * Generic 401. The body never says WHICH check failed (no session vs. bad bearer vs. expired):
 * distinguishing them would hand an attacker a probe for valid state.
 */
function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * Constant-time bearer comparison — same construction as `app/api/cron/news-pipeline/route.ts`.
 *
 * `timingSafeEqual` throws on a length mismatch, which would leak length and turn a wrong token
 * into a 500; hashing both sides to a fixed 32 bytes removes that while staying constant-time.
 */
function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

/**
 * The machine branch, GUARDED.
 *
 * With `CRON_SECRET` unset this returns `false` before any comparison happens, so the branch is
 * unreachable and the literal string `"Bearer undefined"` can never authenticate. That exact bug
 * (comparing against the template literal without asserting the secret exists) was fixed in the
 * cron route; it is not reintroduced here. Unlike the cron route, a missing secret is NOT a
 * misconfiguration for these endpoints — they are session-first — so it simply falls through to
 * the session check instead of 500ing.
 */
function cronBearerAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length === 0) return false
  return bearerMatches(request.headers.get('Authorization'), secret)
}

/**
 * Resolves the caller. Returns the user, or a ready-to-return 401 response.
 *
 * ```ts
 * const auth = await requireUser(request, { endpoint: 'quote', cid })
 * if (!auth.ok) return auth.response
 * ```
 */
export async function requireUser(
  request: Request,
  ctx: RequireUserContext
): Promise<RequireUserResult> {
  // Machine callers first: cheap, local, and it spares GoTrue a round-trip for scripted backfills.
  if (cronBearerAuthorized(request)) {
    return { ok: true, user: { id: 'cron', email: null, via: 'cron' } }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()

    if (error || !data?.user) {
      obsWarn({ event: OBS.AUTH_FAILURE, cid: ctx.cid, endpoint: ctx.endpoint, status: 401 })
      return { ok: false, response: unauthorized() }
    }

    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email ?? null, via: 'session' },
    }
  } catch (err) {
    // A thrown client/cookie failure is NOT a pass. Fail closed, log the real cause under `cid`,
    // and still answer with the same generic 401 so the failure mode is not externally visible.
    obsError({
      event: OBS.AUTH_FAILURE,
      cid: ctx.cid,
      endpoint: ctx.endpoint,
      status: 401,
      reason: errMessage(err),
    })
    return { ok: false, response: unauthorized() }
  }
}
