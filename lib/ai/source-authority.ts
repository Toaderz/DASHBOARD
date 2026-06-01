// Autoridad/neutralidad de fuente (0..1) como señal de PRE-RANKING determinista.
// Prioriza agencias de cable y prensa profesional neutral; penaliza agregadores y opinión.
// No es censura: solo ordena candidatos antes del LLM para que vea el mejor material primero.

const AUTHORITY: Record<string, number> = {
  // Agencias de cable / máxima neutralidad
  'reuters.com': 1.0,
  'apnews.com': 1.0,
  'afp.com': 0.95,
  // Prensa financiera/profesional de referencia
  'bloomberg.com': 0.95,
  'wsj.com': 0.9,
  'ft.com': 0.9,
  'economist.com': 0.9,
  'barrons.com': 0.85,
  'cnbc.com': 0.8,
  'marketwatch.com': 0.72,
  // Prensa general de calidad
  'bbc.com': 0.85,
  'bbc.co.uk': 0.85,
  'nytimes.com': 0.82,
  'washingtonpost.com': 0.8,
  'theguardian.com': 0.75,
  'npr.org': 0.78,
  'axios.com': 0.75,
  'politico.com': 0.75,
  'thehill.com': 0.65,
  'aljazeera.com': 0.7,
  'semafor.com': 0.68,
  // Fuentes oficiales (por si aparecen): bancos centrales / multilaterales
  'federalreserve.gov': 1.0,
  'ecb.europa.eu': 1.0,
  'bankofengland.co.uk': 0.95,
  'imf.org': 0.95,
  'bis.org': 0.95,
  // Agregadores / opinión / menor neutralidad
  'forbes.com': 0.5,
  'businessinsider.com': 0.5,
  'fortune.com': 0.55,
  'yahoo.com': 0.4,
  'finance.yahoo.com': 0.4,
  'seekingalpha.com': 0.4,
  'fool.com': 0.35,
  'benzinga.com': 0.35,
  'investing.com': 0.45,
}

const DEFAULT_AUTHORITY = 0.5

function hostOf(urlOrHost: string): string {
  try {
    const h = urlOrHost.includes('://') ? new URL(urlOrHost).hostname : urlOrHost
    return h.replace(/^www\./, '').toLowerCase()
  } catch {
    return urlOrHost.replace(/^www\./, '').toLowerCase()
  }
}

// Autoridad 0..1 de una fuente (URL o hostname). Match por sufijo de dominio.
export function sourceAuthority(urlOrHost: string): number {
  if (!urlOrHost) return DEFAULT_AUTHORITY
  const host = hostOf(urlOrHost)
  if (AUTHORITY[host] != null) return AUTHORITY[host]
  for (const domain in AUTHORITY) {
    if (host === domain || host.endsWith(`.${domain}`)) return AUTHORITY[domain]
  }
  return DEFAULT_AUTHORITY
}
