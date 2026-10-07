// Límite por clave en memoria (ventana deslizante). Es una barrera de contención, NO un control
// fuerte: en serverless cada instancia tiene su propio contador. El control real es exigir sesión.

const hits = new Map<string, number[]>()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): { ok: boolean; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) }
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k)
  }
  return { ok: true, retryAfterSec: 0 }
}

export function resetRateLimit(): void {
  hits.clear()
}
