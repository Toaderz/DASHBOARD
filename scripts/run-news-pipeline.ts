// Runner standalone del pipeline de noticias para GitHub Actions.
// Invoca runNewsPipeline() directamente — sin HTTP, sin auth, SIN el límite de 60s
// del plan Hobby de Vercel. Es el trigger automático canónico (Lun/Vie 13:00 UTC).
//
// Uso local:  npx tsx scripts/run-news-pipeline.ts   (lee .env.local)
// En CI:      las env vars vienen de GitHub repo secrets (process.env)
//
// Nota sobre alias: la cadena lib/ai/ NO tiene imports `@/` en runtime (el único es
// `import type` en asset-enrichment.ts, que tsx/esbuild borra). Por eso se importa
// por ruta RELATIVA y no se necesita tsconfig-paths.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { runNewsPipeline } from '../lib/ai/news-pipeline'

// Carga .env.local solo si existe (local). En CI las vars ya están en process.env.
try {
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
  }
} catch {
  // sin .env.local (entorno CI) → se usa process.env tal cual
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('[news-cron] FALTAN env vars: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabaseAdmin = createClient(url, serviceKey)

try {
  const result = await runNewsPipeline(supabaseAdmin)
  console.log('[news-cron] resultado:', JSON.stringify(result))
  process.exit(0)
} catch (error) {
  console.error('[news-cron] runner falló:', error)
  process.exit(1)
}
