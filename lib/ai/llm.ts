// ════════════════════════════════════════════════════════════════════════════
// Cliente LLM provider-agnostic con cadena de fallback (endpoints OpenAI-compatibles).
//
// Cadena por defecto: Gemini 2.5 Flash → Groq → Cerebras (configurable con NEWS_LLM_CHAIN).
// - Un proveedor SIN API key se salta automáticamente (no rompe nada si solo tienes Groq).
// - Modelos DISTINTOS para 'analysis' vs 'selection' dentro del mismo proveedor (Groq/otros
//   aplican el límite de tokens/min POR MODELO; así no compiten por el mismo cupo).
// - Reintentos con backoff ante 429/503/timeout; al agotar un proveedor, salta al siguiente.
// - El parseo de JSON lo hace extractJson (robusto): NO dependemos del modo JSON del proveedor.
// ════════════════════════════════════════════════════════════════════════════

// ── JSON helpers (parser robusto para salidas de LLM) ─────────────────────────

export function sanitizeJsonString(raw: string): string {
  // Escapa caracteres de control dentro de strings JSON (problema común de salidas LLM).
  let result = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
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
  // Quita comas colgantes antes de } o ]
  return result.replace(/,(\s*[}\]])/g, '$1')
}

export function extractJson<T>(text: string): T {
  let raw = text.trim()
  // Quita el fence ```json … ``` AUNQUE falte el cierre (output truncado): captura hasta ``` o fin.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1] && fence[1].trim()) {
    raw = fence[1].trim()
  } else {
    // Sin fence: recorta del primer { o [ al último } o ] presente.
    const obj = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (obj) raw = obj[1] ?? obj[0]
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return JSON.parse(sanitizeJsonString(raw)) as T
  }
}

// ── Proveedores ───────────────────────────────────────────────────────────────

export type LLMRole = 'analysis' | 'selection'

export interface CallLLMOptions {
  role: LLMRole
  prompt: string
  system?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

interface ResolvedProvider {
  name: string
  endpoint: string
  apiKey?: string
  model: string
  // Campos extra a inyectar en el body (p.ej. desactivar el "thinking" de Gemini, que
  // consume el presupuesto de max_tokens y trunca el JSON en análisis largos).
  extraBody?: Record<string, unknown>
}

// Cadena de proveedores a intentar, en orden. Default: gemini → groq → cerebras.
function resolveChain(): string[] {
  const raw = process.env.NEWS_LLM_CHAIN
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  }
  return ['gemini', 'groq', 'cerebras']
}

// Construye la config de un proveedor para un rol. Devuelve null si no está disponible
// (falta API key/URL) → la cadena lo salta sin error.
function buildProvider(name: string, role: LLMRole): ResolvedProvider | null {
  switch (name) {
    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) return null
      const base = process.env.GEMINI_API_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai'
      const model = role === 'analysis'
        ? (process.env.GEMINI_ANALYSIS_MODEL ?? 'gemini-2.5-flash')
        : (process.env.GEMINI_SELECTION_MODEL ?? 'gemini-2.5-flash-lite')
      // Desactiva el thinking: todo el presupuesto de tokens va al JSON (evita truncamiento).
      const reasoning = process.env.GEMINI_REASONING_EFFORT ?? 'none'
      return {
        name,
        endpoint: `${base.replace(/\/$/, '')}/chat/completions`,
        apiKey,
        model,
        extraBody: { reasoning_effort: reasoning },
      }
    }
    case 'groq': {
      const base = process.env.OLLAMA_API_URL
      if (!base) return null
      const apiKey = process.env.OLLAMA_API_KEY
      const model = role === 'analysis'
        ? (process.env.NEWS_ANALYSIS_MODEL ?? 'openai/gpt-oss-120b')
        : (process.env.OLLAMA_MODEL ?? 'llama-3.3-70b-versatile')
      // Groq/Ollama exponen las completions bajo /v1/chat/completions.
      return { name, endpoint: `${base.replace(/\/$/, '')}/v1/chat/completions`, apiKey, model }
    }
    case 'cerebras': {
      const apiKey = process.env.CEREBRAS_API_KEY
      if (!apiKey) return null
      const base = process.env.CEREBRAS_API_URL ?? 'https://api.cerebras.ai/v1'
      const model = role === 'analysis'
        ? (process.env.CEREBRAS_ANALYSIS_MODEL ?? 'llama-3.3-70b')
        : (process.env.CEREBRAS_SELECTION_MODEL ?? 'llama-3.3-70b')
      return { name, endpoint: `${base.replace(/\/$/, '')}/chat/completions`, apiKey, model }
    }
    default:
      return null
  }
}

const isTransient = (e: unknown) =>
  /50[0-9]|over capacity|429|rate.?limit|timeout|fetch failed|ECONNRESET|ETIMEDOUT|aborted/i.test(String(e))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function callOnce(provider: ResolvedProvider, opts: CallLLMOptions, temperature: number): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`

  const messages: Array<{ role: string; content: string }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content: opts.prompt })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000)
  try {
    const res = await fetch(provider.endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature,
        stream: false,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(provider.extraBody ?? {}),
      }),
    })
    if (!res.ok) {
      throw new Error(`${provider.name}/${provider.model} error ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(`${provider.name}/${provider.model}: respuesta vacía`)
    }
    return content
  } finally {
    clearTimeout(timer)
  }
}

// Llama al LLM recorriendo la cadena de proveedores. Reintenta 1 vez por proveedor ante
// errores transitorios; al agotar, salta al siguiente. Lanza si TODOS fallan.
export async function callLLM(opts: CallLLMOptions): Promise<string> {
  const chain = resolveChain()
  const providers = chain
    .map((n) => buildProvider(n, opts.role))
    .filter((p): p is ResolvedProvider => p != null)

  if (!providers.length) {
    throw new Error('No hay proveedores LLM disponibles: revisa NEWS_LLM_CHAIN y las API keys (GEMINI_API_KEY / OLLAMA_* / CEREBRAS_API_KEY)')
  }

  const temperature = opts.temperature ?? 0.2
  let lastErr: unknown

  for (const provider of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callOnce(provider, opts, temperature)
      } catch (e) {
        lastErr = e
        if (attempt < 1 && isTransient(e)) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        break // siguiente proveedor
      }
    }
  }

  throw new Error(`Todos los proveedores LLM fallaron. Último error: ${String(lastErr)}`)
}
