// Limpieza determinista del markdown del artículo extraído (full_text_md).
// Se aplica SIEMPRE, tanto a la extracción AI de Firecrawl como al fallback de markdown plano,
// así que la basura de page-chrome (nav, ads, botones sociales, newsletter, bio del autor,
// listas de "Read Next"/relacionados) se elimina sin depender de que el LLM la haya filtrado.

export interface ExtractedJson {
  body_markdown?: string
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)/g

// Deterministic backstop: drop logo / icon / avatar / agency-credit / tracking images.
// Keeps content photos and charts/graphs (what the user wants).
function isJunkImage(alt: string, url: string): boolean {
  const a = alt.trim().toLowerCase()
  const u = url.replace(/^<|>$/g, '').trim().toLowerCase()
  if (!u || u.startsWith('data:')) return true
  // Alt is exactly a news-agency wordmark → it's a credit logo, not a content photo.
  if (/^(reuters|getty|getty images|associated press|ap|ap photo|bloomberg|afp|epa|shutterstock|istock|alamy|nurphoto|via getty images)$/.test(a)) return true
  if (/\b(logo|icon|favicon|avatar|sprite|spacer|pixel|placeholder|watermark|wordmark|badge|headshot)\b/.test(a)) return true
  if (/logo|favicon|sprite|\/icons?\/|avatar|placeholder|spacer|1x1|tracking|beacon|\.svg(\?|$)/.test(u)) return true
  // La URL debe PARECER un archivo de imagen. Muchas "imágenes" extraídas son en realidad
  // enlaces a páginas/PDF (bea.gov, dol.gov/...pdf, /quotes/, /kevin-warsh/) que el extractor
  // envolvió como ![]() → romperían el <img> con ícono roto. Conservar solo extensión de imagen,
  // subdominio de CDN de imágenes, o ruta típica de imagen (p.ej. Reuters /resizer/).
  const looksLikeImage =
    /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(u) ||
    /\/\/(?:image|images|img|media|cdn|i)\d*\.[^/]+\//i.test(u) ||
    /\/(?:resizer|image|images|img|photo|media)\//i.test(u)
  if (!looksLikeImage) return true
  return false
}

// Remove junk images from the markdown but keep content photos/charts in place.
function filterImages(md: string): string {
  return md.replace(MD_IMAGE_RE, (full, alt: string, url: string) => (isJunkImage(alt, url) ? '' : full))
}

// Drop a leading H1 (the article title is shown separately in the modal header).
function stripLeadingH1(md: string): string {
  const lines = md.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i < lines.length && /^#\s+\S/.test(lines[i].trim())) lines.splice(i, 1)
  return lines.join('\n')
}

// Normaliza una línea para clasificarla: quita marcadores markdown de inicio, negritas y
// colapsa enlaces [texto](url) a su texto, para comparar contra patrones de basura.
function normalizeLine(line: string): string {
  return line
    .replace(/^[#>\-*\s]+/, '')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}

// La PRIMERA línea que sea un marcador de "cola" (legal/bio/recirculación) corta el artículo:
// todo lo que sigue (bio del autor, botones sociales, "Read Next", relacionados) se descarta.
function isTailMarker(line: string): boolean {
  const t = normalizeLine(line)
  if (!t) return false
  // Línea legal de Reuters → tras ella vienen bio del autor, social y recirculación.
  if (/^our standards:\s*the thomson reuters trust principles/i.test(t)) return true
  // Encabezados de contenido relacionado/recirculación — deben ser cortos (tipo título).
  if (
    t.length <= 40 &&
    /^(read next|more from|related (coverage|news|articles|stories)|most read|most popular|recommended( for you)?|what to read next|trending( stories)?|sponsored content|sign up for)\b/i.test(t)
  ) {
    return true
  }
  return false
}

// Línea de boilerplate suelta a eliminar: nav, ads, botones sociales, newsletter, licensing,
// timestamps de recirculación ("37 mins ago"), promos de cabecera.
function isBoilerplateLine(line: string): boolean {
  const t = normalizeLine(line)
  if (!t) return false
  const low = t.toLowerCase()
  // Botones sociales / utilidades en línea propia.
  if (/^(x|facebook|linkedin|reddit|whatsapp|email|link|share|print|copy link|flipboard|telegram|bluesky|threads|comments?|save)$/i.test(t)) return true
  if (/^advertisement\b/.test(low) || /scroll to continue/.test(low)) return true
  if (/^skip to (main )?content$/.test(low)) return true
  if (/purchase licensing rights/.test(low)) return true
  if (/, opens new tab$/.test(low)) return true
  if (/^(sign up|subscribe)\b/.test(low) && low.length < 80) return true
  if (/get a daily digest|\bnewsletter\b/.test(low)) return true
  if (/^learn more about/.test(low)) return true
  if (/exclusive news, data and analytics/.test(low)) return true
  if (/^\d+\s+(min|mins|minute|minutes|hour|hours|day|days)\s+ago$/.test(low)) return true
  if (/category$/.test(low) && low.length < 40) return true // "Businesscategory", "Legalcategory"
  return false
}

// Trunca en el primer marcador de cola y elimina líneas de boilerplate del resto.
function stripBoilerplate(md: string): string {
  const out: string[] = []
  for (const line of md.split('\n')) {
    if (isTailMarker(line)) break
    if (isBoilerplateLine(line)) continue
    out.push(line)
  }
  return out.join('\n')
}

// Construye el markdown limpio final que se guarda en `full_text_md`.
export function buildCleanMarkdown(json: ExtractedJson): string | null {
  let md = (json.body_markdown ?? '').trim()
  if (!md) return null
  md = stripLeadingH1(md)
  md = stripBoilerplate(md)
  md = filterImages(md)
  md = md.replace(/\n{3,}/g, '\n\n').trim()
  // Require some actual prose, not just leftover image/whitespace.
  const textOnly = md.replace(MD_IMAGE_RE, '').replace(/[#>*_`-]/g, '').trim()
  return textOnly.length >= 80 ? md : null
}
