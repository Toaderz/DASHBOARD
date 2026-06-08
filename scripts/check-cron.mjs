// Diagnóstico del pipeline de noticias y su estado en Supabase.
// Uso: node scripts/check-cron.mjs [baseUrl]   (default http://localhost:3000)
//
// 1. GET  /api/news/current        → status + valid_until del brief vigente (¿guard bloqueando?)
// 2. POST /api/cron/news-pipeline   → dispara con Bearer CRON_SECRET y muestra status + body
// 3. (si hay service-role key) últimos 5 market_briefs directos de Supabase
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Carga simple de .env.local (mismo parser que refresh-news.mjs)
const env = {}
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
} catch {
  console.warn('⚠️  No se pudo leer .env.local — se usará process.env')
}
const get = (k) => env[k] ?? process.env[k]

const baseUrl = process.argv[2] ?? 'http://localhost:3000'
console.log(`Base URL: ${baseUrl}\n`)

// 1. Brief vigente vía API pública (auth: requiere sesión, así que esto puede dar 401 — lo mostramos igual)
console.log('── 1. GET /api/news/current ──')
try {
  const res = await fetch(`${baseUrl}/api/news/current`)
  const body = await res.text()
  console.log('Status:', res.status)
  try {
    const json = JSON.parse(body)
    console.log('status:', json?.brief?.status ?? json?.status ?? '(n/a)')
    console.log('valid_until:', json?.brief?.valid_until ?? json?.valid_until ?? '(n/a)')
    console.log('stale:', json?.stale ?? '(n/a)')
  } catch {
    console.log('Body:', body.slice(0, 300))
  }
} catch (e) {
  console.error('Error:', e.message)
}

// 2. Disparo del pipeline con Bearer CRON_SECRET
console.log('\n── 2. POST /api/cron/news-pipeline (Bearer CRON_SECRET) ──')
const cronSecret = get('CRON_SECRET')
if (!cronSecret) {
  console.warn('⚠️  CRON_SECRET no disponible — se omite el disparo')
} else {
  try {
    const res = await fetch(`${baseUrl}/api/cron/news-pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    console.log('Status:', res.status)
    console.log('Body:', await res.text())
  } catch (e) {
    console.error('Error:', e.message)
  }
}

// 3. Historial directo en Supabase (service role)
console.log('\n── 3. Últimos 5 market_briefs (Supabase service role) ──')
const supabaseUrl = get('NEXT_PUBLIC_SUPABASE_URL')
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY')
if (!supabaseUrl || !serviceKey) {
  console.warn('⚠️  Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY — se omite')
} else {
  const supabase = createClient(supabaseUrl, serviceKey)
  const { data, error } = await supabase
    .from('market_briefs')
    .select('id, status, created_at, valid_until, metadata')
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) {
    console.error('Error:', error.message)
  } else {
    for (const b of data) {
      console.log(
        `${b.created_at}  [${b.status}]  valid_until=${b.valid_until}  id=${b.id}` +
          (b.metadata?.error ? `  error=${b.metadata.error}` : '')
      )
    }
  }
}
