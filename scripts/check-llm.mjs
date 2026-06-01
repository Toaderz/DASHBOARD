// Valida la cadena de LLM (lib/ai/llm.ts) contra los proveedores REALES configurados.
// Para cada proveedor con API key: hace una llamada real pidiendo JSON y confirma que
// el output parsea limpio (directo) o vía sanitización. Útil para verificar Gemini ANTES
// de confiar en su modo JSON por el endpoint OpenAI-compatible.
//
// Uso:  node scripts/check-llm.mjs
import { readFileSync } from 'node:fs'

// ── carga .env.local ──────────────────────────────────────────────────────────
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of env.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
} catch {
  console.error('No se pudo leer .env.local'); process.exitCode = 1
}

// ── helpers (espejo de lib/ai/llm.ts) ─────────────────────────────────────────
function sanitizeJsonString(raw) {
  let result = '', inString = false, escaped = false
  for (const ch of raw) {
    if (escaped) { result += ch; escaped = false; continue }
    if (ch === '\\') { result += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue }
      if (ch === '\r') { result += '\\r'; continue }
      if (ch === '\t') { result += '\\t'; continue }
    }
    result += ch
  }
  return result.replace(/,(\s*[}\]])/g, '$1')
}
function parseJson(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  const raw = match ? (match[1] ?? match[0]) : text.trim()
  try { return { value: JSON.parse(raw), clean: true } }
  catch { return { value: JSON.parse(sanitizeJsonString(raw)), clean: false } }
}

function buildProvider(name) {
  switch (name) {
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) return null
      const base = process.env.GEMINI_API_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai'
      return { name, endpoint: `${base.replace(/\/$/, '')}/chat/completions`, apiKey, model: process.env.GEMINI_SELECTION_MODEL ?? 'gemini-2.5-flash-lite' }
    }
    case 'groq': {
      const base = process.env.OLLAMA_API_URL; if (!base) return null
      return { name, endpoint: `${base.replace(/\/$/, '')}/v1/chat/completions`, apiKey: process.env.OLLAMA_API_KEY, model: process.env.OLLAMA_MODEL ?? 'llama-3.3-70b-versatile' }
    }
    case 'cerebras': {
      const apiKey = process.env.CEREBRAS_API_KEY; if (!apiKey) return null
      const base = process.env.CEREBRAS_API_URL ?? 'https://api.cerebras.ai/v1'
      return { name, endpoint: `${base.replace(/\/$/, '')}/chat/completions`, apiKey, model: process.env.CEREBRAS_SELECTION_MODEL ?? 'llama-3.3-70b' }
    }
    default: return null
  }
}

const PROMPT = 'Devuelve SOLO este JSON, sin texto adicional: {"ok": true, "items": ["a", "b"], "nota": "línea1\\nlínea2"}'

async function test(p) {
  const headers = { 'Content-Type': 'application/json' }
  if (p.apiKey) headers['Authorization'] = `Bearer ${p.apiKey}`
  const t0 = Date.now()
  const res = await fetch(p.endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: PROMPT }], temperature: 0, stream: false }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('sin content en choices[0].message')
  const { value, clean } = parseJson(content)
  if (!value || typeof value !== 'object') throw new Error('JSON no es objeto')
  return { ms: Date.now() - t0, clean, sample: JSON.stringify(value) }
}

const chain = (process.env.NEWS_LLM_CHAIN?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) ?? ['gemini', 'groq', 'cerebras']
console.log(`Cadena: ${chain.join(' → ')}\n`)

let anyOk = false
for (const name of chain) {
  const p = buildProvider(name)
  if (!p) { console.log(`SKIP  ${name.padEnd(9)} (sin API key)`); continue }
  process.stdout.write(`...   ${name.padEnd(9)} ${p.model} `)
  try {
    const r = await test(p)
    anyOk = true
    console.log(`\rPASS  ${name.padEnd(9)} ${p.model} — ${r.ms}ms — JSON ${r.clean ? 'limpio ✓' : 'requirió sanitización ⚠'}\n      ${r.sample}`)
  } catch (e) {
    console.log(`\rFAIL  ${name.padEnd(9)} ${p.model} — ${String(e).slice(0, 180)}`)
  }
}
console.log(anyOk ? '\nAl menos un proveedor responde JSON parseable.' : '\nNingún proveedor disponible respondió OK.')
process.exitCode = anyOk ? 0 : 1
