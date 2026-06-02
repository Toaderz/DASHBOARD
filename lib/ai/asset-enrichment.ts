import type { SupabaseClient } from '@supabase/supabase-js'
import type { RelevanceProfile, AffectedSymbol } from '@/types'
import { callLLM, extractJson } from './llm'

// ════════════════════════════════════════════════════════════════════════════
// RELEVANCIA DE PORTAFOLIO DETERMINISTA (sin que el LLM adivine al momento de la noticia)
//
// Fase A — enrichAssetProfiles: enriquece cada activo UNA vez (cacheado en
//          assets_metadata.relevance_profile) con señales estables vía LLM batch.
// Fase B — matchAffectedSymbols: cruza esos perfiles contra el texto del artículo
//          de forma 100% determinista (entities/nombre/ticker con guardas estrictas).
// ════════════════════════════════════════════════════════════════════════════

// ── Tipos internos ───────────────────────────────────────────────────────────

interface AssetRow {
  ticker: string
  name: string
  type: string
  manager: string | null
  relevance_profile: RelevanceProfile | null
}

interface EnrichInput {
  ticker: string
  name: string
  type: string
  manager: string | null
  morningstar_category?: string | null
  global_category?: string | null
}

// Un perfil es "pobre" si no aporta NINGÚN ancla de matching (ni entities ni themes).
// No se cachea: queda null para reintentar en la próxima corrida (y se loguea).
function isEmptyProfile(p: RelevanceProfile | null | undefined): boolean {
  if (!p) return true
  const entities = Array.isArray(p.entities) ? p.entities.filter(Boolean) : []
  const themes = Array.isArray(p.themes) ? p.themes.filter(Boolean) : []
  return entities.length === 0 && themes.length === 0
}

// ── Fase A: enriquecimiento automático por activo ─────────────────────────────

const ENRICH_SYSTEM = `Eres un clasificador de activos financieros. Para cada activo devuelves un perfil de señales ESTABLES y FACTUALES (no holdings volátiles, no cifras). Solo describes: clase de activo, gestor/emisor, geografía y sector/tema, más las entidades concretas a vigilar (la propia empresa, el gestor). PROHIBIDO inventar holdings o datos: si no tienes certeza de una entidad, NO la incluyas. Para una ACCIÓN, la propia empresa y su ticker SON la entidad. Respondes SOLO con un array JSON válido, sin texto adicional.`

function buildEnrichPrompt(batch: EnrichInput[]): string {
  const list = batch
    .map((a) => {
      const cat = [a.morningstar_category, a.global_category].filter(Boolean).join(' / ')
      return `- ticker: ${a.ticker} | nombre: ${a.name} | tipo: ${a.type}${a.manager ? ` | gestor: ${a.manager}` : ''}${cat ? ` | categoría: ${cat}` : ''}`
    })
    .join('\n')

  return `Para CADA activo de la lista, devuelve un objeto con este esquema EXACTO:
{
  "ticker": "<el mismo ticker de entrada>",
  "asset_type": "stock | etf | index | fund | closed_end_fund",
  "themes": ["sector/tema, ej: tecnología, ciberseguridad, smart grid"],
  "issuer_or_manager": "gestor o emisor si aplica, ej: 'Pershing Square / Bill Ackman'; null si no aplica",
  "geography": "US | North America | global | Japan | Europe | ...; null si no aplica",
  "entities": ["nombres propios a vigilar: la empresa, el gestor. [] si no hay certeza"]
}

Reglas:
- Solo descriptores estables y factuales. PROHIBIDO inventar holdings o cifras.
- Acción individual: entities = [nombre de la empresa]. Ej: AAPL → ["Apple"].
- Vehículo de un gestor conocido: incluye al gestor. Ej: PSH.L (Pershing Square Holdings) → issuer_or_manager: "Pershing Square / Bill Ackman", entities: ["Pershing Square", "Bill Ackman"].
- ETF/fondo temático amplio o pasivo: deja entities: [] y describe el tema en themes. NO pongas la
  gestora/emisor como entity (Vanguard, iShares, BlackRock, First Trust, SPDR, Invesco… son genéricas:
  administran cientos de productos y una noticia que las menciona no es sobre ESE ETF).
- Índice (S&P 500, Nasdaq): asset_type "index", entities: [].

Devuelve SOLO el array JSON (${batch.length} objetos), nada más.

ACTIVOS:
${list}`
}

interface EnrichedProfile extends RelevanceProfile {
  ticker: string
}

// Enriquece (una vez, cacheado) todos los activos del universo que aún no tienen
// relevance_profile. Resiliente: cualquier fallo se loguea y NO rompe el pipeline.
export async function enrichAssetProfiles(supabase: SupabaseClient): Promise<void> {
  try {
    // Unión de todos los tickers presentes en cualquier watchlist (multi-tenant).
    // source='user': excluye peers auto-materializados (no son holdings que el usuario eligió).
    const { data: waRows } = await supabase.from('watchlist_assets').select('asset_ticker').eq('source', 'user')
    const tickers = [...new Set((waRows ?? []).map((r) => r.asset_ticker as string))]
    if (!tickers.length) return

    const { data: assets } = await supabase
      .from('assets_metadata')
      .select('ticker,name,type,manager,relevance_profile')
      .in('ticker', tickers)

    const toEnrich = (assets ?? []).filter(
      (a) => a.relevance_profile == null
    ) as AssetRow[]
    if (!toEnrich.length) return

    // Solo para ETFs: la categoría Morningstar/global vive en price_cache (no en assets_metadata).
    const etfTickers = toEnrich.filter((a) => a.type === 'etf').map((a) => a.ticker)
    const catByTicker = new Map<string, { morningstar_category?: string | null; global_category?: string | null }>()
    if (etfTickers.length) {
      try {
        const { data: pc } = await supabase
          .from('price_cache')
          .select('ticker,morningstar_category,global_category')
          .in('ticker', etfTickers)
        for (const row of pc ?? []) catByTicker.set(row.ticker as string, row)
      } catch {
        // price_cache puede no tener esas columnas en un DB viejo — seguimos sin categoría.
      }
    }

    const inputs: EnrichInput[] = toEnrich.map((a) => ({
      ticker: a.ticker,
      name: a.name,
      type: a.type,
      manager: a.manager,
      ...(catByTicker.get(a.ticker) ?? {}),
    }))

    // Batch para no inflar el prompt; el enriquecimiento es metadata por-activo, costo trivial.
    const BATCH = 40
    let enriched = 0
    const empties: string[] = []

    for (let i = 0; i < inputs.length; i += BATCH) {
      const batch = inputs.slice(i, i + BATCH)
      let profiles: EnrichedProfile[]
      try {
        const raw = await callLLM({
          role: 'selection',
          prompt: buildEnrichPrompt(batch),
          system: ENRICH_SYSTEM,
          temperature: 0.1,
          maxTokens: 4000,
        })
        profiles = extractJson<EnrichedProfile[]>(raw)
      } catch (e) {
        console.error(`[enrich] batch ${i / BATCH} falló:`, String(e))
        continue
      }
      if (!Array.isArray(profiles)) continue

      const byTicker = new Map(
        profiles.filter((p) => p && p.ticker).map((p) => [String(p.ticker).toUpperCase(), p])
      )

      for (const asset of batch) {
        const p = byTicker.get(asset.ticker.toUpperCase())
        const profile: RelevanceProfile | null = p
          ? {
              asset_type: p.asset_type ?? asset.type,
              themes: Array.isArray(p.themes) ? p.themes.filter(Boolean) : [],
              issuer_or_manager: p.issuer_or_manager ?? null,
              geography: p.geography ?? null,
              entities: Array.isArray(p.entities) ? p.entities.filter(Boolean) : [],
            }
          : null

        // Perfil vacío → NO se cachea (queda null para reintentar), se loguea.
        if (isEmptyProfile(profile)) {
          empties.push(asset.ticker)
          continue
        }

        const { error } = await supabase
          .from('assets_metadata')
          .update({ relevance_profile: profile })
          .eq('ticker', asset.ticker)
        if (error) console.error(`[enrich] update ${asset.ticker} falló:`, error.message)
        else enriched++
      }
    }

    if (empties.length) {
      console.warn(`[enrich] ${empties.length} perfil(es) vacío(s) (reintentarán la próxima corrida): ${empties.join(', ')}`)
    }
    console.log(`[enrich] ${enriched}/${toEnrich.length} activos enriquecidos`)
  } catch (e) {
    console.error('[enrich] fallo general (se ignora, no rompe el pipeline):', String(e))
  }
}

// ── Fase B: matching determinista por noticia ─────────────────────────────────

export interface UniverseAsset {
  ticker: string
  name: string
  type: string
  manager: string | null
  relevance_profile: RelevanceProfile | null
}

// Carga el universo (unión de todos los activos en cualquier watchlist) con su perfil.
// Excluye índices: se tratan como contexto macro general, no generan badge de ticker.
export async function loadUniverseAssets(supabase: SupabaseClient): Promise<UniverseAsset[]> {
  const { data: waRows } = await supabase.from('watchlist_assets').select('asset_ticker').eq('source', 'user')
  const tickers = [...new Set((waRows ?? []).map((r) => r.asset_ticker as string))]
  if (!tickers.length) return []
  const { data } = await supabase
    .from('assets_metadata')
    .select('ticker,name,type,manager,relevance_profile')
    .in('ticker', tickers)
  return ((data ?? []) as UniverseAsset[]).filter((a) => a.type !== 'index')
}

// Marcas genéricas de gestoras/emisores que administran MUCHOS productos: una noticia que
// menciona "Vanguard" o "iShares" NO es sobre un ETF suyo en particular. Nunca disparan match
// por sí solas (evita el falso positivo VGK←"Vanguard", CIBR←"First Trust", etc.).
const GENERIC_ISSUERS = new Set([
  'vanguard', 'ishares', 'blackrock', 'spdr', 'state street', 'ssga', 'fidelity',
  'schwab', 'charles schwab', 'invesco', 'first trust', 'proshares', 'global x',
  'vaneck', 'wisdomtree', 'ark', 'ark invest', 'ark investment management', 'direxion',
  'xtrackers', 'jpmorgan', 'j.p. morgan', 'jp morgan', 'pimco', 'dimensional',
  'franklin templeton', 'franklin', 'templeton', 'nuveen', 'pacer', 'amundi', 'lyxor',
])

function isGenericIssuer(name: string): boolean {
  return GENERIC_ISSUERS.has(name.trim().toLowerCase())
}

// ¿Aparece `phrase` como frase completa en el texto? (límite de palabra, case-insensitive).
// Para nombres de entidad/empresa/gestor. Ignora frases demasiado cortas (ruido).
function containsPhrase(textLower: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase()
  if (p.length < 4) return false
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, 'i').test(textLower)
}

// Match de TICKER con guardas estrictas (riesgo #1 de bug: palabra común = ticker).
// - Tickers cortos puramente alfabéticos (≤4) son ambiguos (GRID, FEX, FAI, IJR): SOLO cashtag $TICKER.
// - Tickers no ambiguos (≥5 letras, o con punto/sufijo/no-alfabéticos como PSH.L, 0P0000NCAC):
//   coincidencia exacta CASE-SENSITIVE con límite alfanumérico, o cashtag.
// Nunca substring, nunca case-insensitive sobre el ticker crudo.
function matchesTicker(text: string, ticker: string): boolean {
  const esc = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Cashtag explícito ($GRID) siempre vale, para cualquier ticker.
  if (new RegExp(`\\$${esc}(?![A-Za-z0-9])`).test(text)) return true
  const isAmbiguous = /^[A-Za-z]{1,4}$/.test(ticker)
  if (isAmbiguous) return false // solo vía entity-name o cashtag
  // No ambiguo: exacto, case-sensitive, con límites alfanuméricos.
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`).test(text)
}

// Calcula los símbolos afectados por un artículo de forma determinista.
// `text` debe ser el material FUENTE del artículo (título + cuerpo extraído), no el resumen del LLM.
export function matchAffectedSymbols(text: string, universe: UniverseAsset[]): AffectedSymbol[] {
  if (!text) return []
  const textLower = text.toLowerCase()
  const out: AffectedSymbol[] = []

  for (const asset of universe) {
    const p = asset.relevance_profile
    // 1) Entities del perfil (empresa/gestor) → mecanismo preferido.
    //    - Para ETFs NO se usa el emisor (la marca del emisor no es señal de relevancia por noticia).
    //    - Se descartan marcas genéricas de gestoras (Vanguard, iShares, First Trust…) como disparador.
    const entities = [
      ...(p?.entities ?? []),
      ...(asset.type !== 'etf' && p?.issuer_or_manager ? [p.issuer_or_manager] : []),
    ].filter((e) => e && !isGenericIssuer(e))
    if (entities.some((e) => containsPhrase(textLower, e))) {
      out.push({ ticker: asset.ticker, source: 'entity' })
      continue
    }
    // 2) Ticker literal con guardas estrictas.
    if (matchesTicker(text, asset.ticker)) {
      out.push({ ticker: asset.ticker, source: 'ticker' })
      continue
    }
    // 3) Respaldo: el nombre del activo aparece literal en el texto.
    if (containsPhrase(textLower, asset.name)) {
      out.push({ ticker: asset.ticker, source: 'text_scan' })
      continue
    }
    // themes NUNCA disparan solos (evita "demanda de IA" → ETF de ciberseguridad).
  }

  return out
}
