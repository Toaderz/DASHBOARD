/**
 * N-04: solo http y https. Cualquier otro protocolo (javascript:, data:, vbscript:, file:…) o una URL
 * que no se pueda leer devuelve undefined, de modo que el enlace o la imagen simplemente no se pinta.
 * Las URL relativas se rechazan: las fuentes de noticias siempre son absolutas.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const u = new URL(trimmed)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}
