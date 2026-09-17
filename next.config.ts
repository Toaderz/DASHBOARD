import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'

// ============================================================
// CABECERAS DE SEGURIDAD — EN FASES (PR7)
// ============================================================
// Una CSP completa activada de golpe es la forma más rápida de romper una SPA en
// producción sin poder medir qué rompió. Por eso esto va en tres fases y aquí solo
// está activada la A. Las fases B y C están escritas abajo, listas para copiar,
// con el criterio EXACTO que hay que verificar antes de promover cada una.
//
// ------------------------------------------------------------
// FASE A — ACTIVA. Cabeceras sin superficie de rotura.
// ------------------------------------------------------------
// Ninguna de estas cinco puede bloquear un recurso que la app ya cargaba: no
// declaran de dónde se puede cargar nada, solo endurecen transporte, sniffing,
// referrer, permisos de APIs del navegador y embebido en iframes.
//
// · Strict-Transport-Security
//     El navegador IGNORA esta cabecera cuando llega por HTTP plano (es el
//     comportamiento que manda el RFC 6797), así que `next dev` en localhost no se
//     ve afectado. Sin `preload`: entrar en la lista de precarga de los navegadores
//     es prácticamente irreversible y no se hace desde un PR de código.
//     ⚠️ `includeSubDomains` obliga a HTTPS en TODO subdominio del dominio que
//     sirve la respuesta. Si algún día cuelga un subdominio sin TLS, quitarlo.
//
// · X-Content-Type-Options: nosniff
//     Impide que el navegador reinterprete el Content-Type de una respuesta. Importa
//     en cualquier endpoint que devuelva contenido derivado de datos del usuario
//     (exports, JSON de las rutas de `/api/**`): sin `nosniff`, el navegador puede
//     decidir tratarlo como HTML y ejecutarlo en el origen de la app.
//
// · Referrer-Policy: strict-origin-when-cross-origin
//     Es el default de Next, pero se fija explícitamente para que no dependa de
//     una versión del framework. Evita filtrar rutas como `/watchlist/<uuid>` a
//     terceros. Nota: `NewsCard` ya pone `referrerPolicy="no-referrer"` en sus
//     <img> remotos, y esa política a nivel de elemento tiene prioridad — no se
//     toca, porque es lo que hace que los CDN de noticias no devuelvan 403.
//
// · Permissions-Policy
//     Lista de denegación de APIs que esta app no usa (cámara, micrófono,
//     geolocalización, pagos, USB, sensores…). Se omiten a propósito tokens
//     muertos como `interest-cohort` (FLoC ya no existe) para no generar avisos de
//     feature desconocida en consola.
//
// · Content-Security-Policy: frame-ancestors 'self'   ← anti-clickjacking
//     Se elige `frame-ancestors` sobre `X-Frame-Options` porque:
//       1. `X-Frame-Options` nunca fue un estándar; `frame-ancestors` lo sustituye
//          y tiene prioridad sobre él en todos los navegadores modernos.
//       2. Permite una allowlist real si algún día hace falta embeber.
//     Enviar una CSP que contiene SOLO esa directiva NO restringe nada más: en CSP
//     una directiva ausente es una directiva sin restricción. Por eso esta línea es
//     segura hoy aunque la CSP completa siga en fase B.
//     Se usa `'self'` y no `'none'` para no romper previews/herramientas del propio
//     origen que se embeban a sí mismas.
//
// ------------------------------------------------------------
// FASE B — DOCUMENTADA, NO ACTIVADA. Medir antes de aplicar.
// ------------------------------------------------------------
// Añadir `Content-Security-Policy-Report-Only` con la CSP completa y dejarla
// correr varios días recogiendo violaciones. Report-Only NO bloquea nada: es
// exactamente la fase de medición que falta.
//
//   const CSP_REPORT_ONLY = [
//     "default-src 'self'",
//     "base-uri 'self'",
//     "object-src 'none'",
//     "form-action 'self'",
//     "frame-ancestors 'self'",
//     // Next inyecta bootstrap inline + Framer Motion escribe estilos inline.
//     "script-src 'self' 'unsafe-inline'",
//     "style-src 'self' 'unsafe-inline'",
//     // next/font/google auto-hospeda las fuentes en el build → NO hace falta
//     // fonts.gstatic.com. Verificar en el bundle antes de restringir.
//     "font-src 'self' data:",
//     // <img> de react-markdown en NewsCard apunta a CDN de prensa arbitrarios.
//     "img-src 'self' data: blob: https:",
//     // Supabase: REST + Auth (https) y Realtime (wss). Sustituir por el host real.
//     "connect-src 'self' https://<PROJECT>.supabase.co wss://<PROJECT>.supabase.co",
//     "worker-src 'self'",
//     "manifest-src 'self'",
//     "upgrade-insecure-requests",
//   ].join('; ')
//
// QUÉ HAY QUE COMPROBAR EN LOS REPORTES ANTES DE PASAR A FASE C (uno por uno):
//   1. Framer Motion — anima vía atributo `style`; eso lo gobierna `style-src`
//      (`style-src-attr` si se separa). Confirmar que no aparecen violaciones de
//      `style-src` al abrir `AssetDetailModal`, `PageTransition` y `ValuePulse`.
//   2. Supabase — login, refresh de sesión y Realtime. El host del proyecto tiene
//      que estar en `connect-src` en AMBOS esquemas (https y wss) o el login cae.
//   3. ReactMarkdown / NewsCard — imágenes de Reuters/CNBC. Si se quiere cerrar
//      `img-src https:` a una allowlist, primero hay que inventariar los dominios
//      reales que devuelve el pipeline; hoy son arbitrarios.
//   4. Serwist — registro del service worker (`/sw.js`) y sus fetch: `worker-src`
//      y `script-src`. Comprobar que el SW se registra tras un hard-reload.
//   5. Google Fonts — `next/font/google` descarga y auto-hospeda en build, así que
//      NO debería haber peticiones a fonts.googleapis.com / fonts.gstatic.com.
//      Verificarlo en la pestaña Network antes de omitir esos hosts.
//   6. Optimizador de imágenes (`/_next/image`) — hoy no hay ningún `<Image>` en
//      el árbol; si se añade uno, sale por `img-src 'self'` + blob:.
//   7. Recharts — renderiza SVG inline, no necesita nada extra; confirmar igual.
//
// ------------------------------------------------------------
// FASE C — DOCUMENTADA, NO ACTIVADA. Enforcement.
// ------------------------------------------------------------
// Mover la CSP de `-Report-Only` a `Content-Security-Policy` SOLO cuando los siete
// puntos de arriba estén verificados y los reportes lleven varios días a cero.
//
// El paso siguiente real (y el que da el valor de verdad) es sustituir
// `script-src 'unsafe-inline'` por un nonce por petición. Eso tiene un coste que
// hay que decidir a conciencia, no de pasada: el nonce se genera en `proxy.ts` y
// obliga a que las páginas se rendericen por petición, lo que ELIMINA el
// prerender estático de `/login` — justo la página que hoy es estática y la razón
// por la que el build exige las dos NEXT_PUBLIC_SUPABASE_*. Es un PR propio.
// ============================================================

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ')

const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  // Fase A: CSP con UNA sola directiva (anti-clickjacking). Ver nota arriba.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['yahoo-finance2', '@tavily/core', 'firecrawl'],

  images: {
    // ------------------------------------------------------------
    // `hostname: '**'` ELIMINADO.
    // ------------------------------------------------------------
    // Un comodín aquí convierte `/_next/image` en un proxy de fetch abierto: el
    // optimizador descarga CUALQUIER URL https que se le pase. Combinado con los
    // dos RCE del optimizador de imágenes que PR1 cerró subiendo Next a 16.3.5
    // (GHSA-p293-qw3h-jr36 / GHSA-2xp9-vwfh-vxw4), era una cadena de explotación
    // real, no teórica.
    //
    // Verificado antes de vaciarlo: el repo NO usa `next/image` en ningún sitio
    //   grep -rn "next/image" --include=*.ts --include=*.tsx .   → 0 resultados
    //   grep -rn "<Image"     --include=*.tsx .                  → 0 resultados
    // La única imagen remota del producto es el `<img>` crudo de `NewsCard.tsx`
    // (override de react-markdown), que va directo al navegador y NO pasa por el
    // optimizador — `remotePatterns` no lo gobierna y por tanto vaciarlo no puede
    // romper ese render.
    //
    // La lista queda VACÍA a propósito: es la configuración mínima correcta cuando
    // no hay ninguna imagen remota optimizada. Si mañana se añade un `<Image>` con
    // `src` remoto, hay que añadir AQUÍ ese host concreto (protocol + hostname +
    // pathname), nunca un comodín.
    remotePatterns: [],
    // SVG remoto sigue prohibido (default de Next): un SVG puede llevar <script>.
    dangerouslyAllowSVG: false,
    // Si algo llegara a servirse por el optimizador, que el navegador lo descargue
    // en vez de renderizarlo en el origen de la app.
    contentDispositionType: 'attachment',
  },

  async headers() {
    return [
      {
        // Todas las rutas, incluidas `/api/**` y los assets estáticos.
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  register: true,
  disable: process.env.NODE_ENV === 'development',
})

export default withSerwist(nextConfig)
