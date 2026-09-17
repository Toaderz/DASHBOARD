'use client'

import { createClient } from '@/lib/supabase/client'

/**
 * Browser-side wrapper around `fetch` for the `/api/market/*` endpoints.
 *
 * WHY: those routes now answer 401 to an anonymous caller. The server `redirect()` in
 * `app/(dashboard)/layout.tsx` only runs on NAVIGATION, and this dashboard does not navigate — it
 * polls every 5 s. Without this, a revoked/expired session leaves the UI frozen on stale prices
 * with no indication anything is wrong, because each poll just fails silently.
 *
 * Contract: identical to `fetch`. It returns the same `Response` (including the 401) and rethrows
 * network errors unchanged, so every existing `if (!res.ok)` / `.catch()` path at the call sites
 * keeps behaving exactly as before. The sign-out is a side effect layered on top; no hook
 * signature and no visible behaviour changes.
 */

/**
 * One-way latch. Once a 401 has started the sign-out, no later 401 can start another.
 *
 * This is what makes the redirect loop-proof: a single render can have a dozen requests in flight
 * (quote + returns + N history), and every one of them will come back 401 together. Without the
 * latch that is a dozen `signOut()` calls and a dozen redirects. It is never reset — the redirect
 * below is a full document load, which discards this module's state anyway.
 */
let signOutStarted = false

/** `/login` itself must never trigger this: nothing there calls the market API, but be explicit. */
function onLoginPage(): boolean {
  return window.location.pathname.startsWith('/login')
}

function handleUnauthorized(): void {
  if (typeof window === 'undefined') return
  if (signOutStarted || onLoginPage()) return
  signOutStarted = true

  // Clear the dead session, then hard-navigate. `replace` (not `push`) keeps the expired page out
  // of history, so Back cannot return to it and re-trigger the same 401. The redirect runs whether
  // or not `signOut` succeeds: a failed sign-out must not strand the user on a frozen dashboard.
  void createClient()
    .auth.signOut()
    .catch(() => {})
    .finally(() => {
      window.location.replace('/login')
    })
}

export async function marketFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) handleUnauthorized()
  return res
}

/** Test-only: reset the latch between cases. Never call this from application code. */
export function __resetSignOutLatchForTests(): void {
  signOutStarted = false
}
