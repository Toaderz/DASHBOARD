// Manual news refresh: expira el brief vigente y dispara el pipeline.
// Uso: node scripts/refresh-news.mjs [baseUrl]   (default http://localhost:3000)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Carga simple de .env.local
const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const baseUrl = process.argv[2] ?? 'http://localhost:3000'
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// 1. Expirar el brief vigente para saltar el guard anti-doble-ejecución
const { error: expErr } = await supabase
  .from('market_briefs')
  .update({ valid_until: new Date(Date.now() - 3600_000).toISOString() })
  .eq('status', 'ready')
if (expErr) { console.error('Error expirando brief:', expErr.message); process.exit(1) }
console.log('Brief vigente expirado. Disparando pipeline…')

// 2. Disparar el pipeline (puede tardar varios minutos)
const res = await fetch(`${baseUrl}/api/cron/news-pipeline`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
})
console.log('Status:', res.status)
console.log(await res.text())
