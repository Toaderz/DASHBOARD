// ============================================================
// ESLint — flat config (ESLint 9) · PR7
// ============================================================
// Antes de este archivo el repo tenía CERO análisis estático: no existía ningún
// `eslint.config.*` ni `.eslintrc*`, y el script `"lint": "next lint"` apuntaba a
// un comando que Next 16 ya no incluye. Es decir: el lint "pasaba" porque nunca
// llegaba a ejecutarse.
//
// ------------------------------------------------------------
// CRITERIO DE SEVERIDAD
// ------------------------------------------------------------
// Esta es la PRIMERA pasada de lint sobre un código que nunca se analizó. Un lint
// que nadie puede poner en verde es un lint que alguien desactiva a la semana, así
// que el objetivo de este PR es dejarlo en **0 errores hoy** sin reescribir código
// ajeno, y marcar en `warn` la deuda real para que sea visible y se pueda ir
// bajando fichero a fichero.
//
// Lo que se conserva en `error` (lo que rompe de verdad):
//   · react-hooks/rules-of-hooks   — un hook condicional es un bug garantizado
//   · @next/next/**                — reglas de correctitud del framework
//   · jsx-a11y/**                  — accesibilidad
//   · no-eval / no-implied-eval / no-new-func / no-script-url  (añadidas aquí)
//
// Lo que se baja a `warn` (deuda inventariada, NO silenciada) — ver bloque final.
// ============================================================
import next from 'eslint-config-next'

const config = [
  {
    // `public/` y `.next/` contienen build output (incluido `sw.js`, generado por
    // Serwist): lintear artefactos no aporta señal y sí mucho ruido.
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'public/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },

  ...next,

  {
    // ----------------------------------------------------------------
    // Endurecimiento: inyección de código. Coste cero hoy (0 apariciones de
    // `eval`, `new Function` o `dangerouslySetInnerHTML` en el árbol), así que se
    // ponen en `error` para que NO entren en el futuro sin revisión explícita.
    // ----------------------------------------------------------------
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // ----------------------------------------------------------------
      // DEUDA CONOCIDA — `warn`, no `off`. Se sigue reportando en cada `npm run
      // lint`; simplemente no bloquea el CI mientras se salda.
      //
      // Las tres son reglas del React Compiler que `eslint-plugin-react-hooks` v6
      // estrenó en `error`. Ninguna es un fallo de seguridad: marcan patrones que
      // impiden que el compilador memoice el componente (re-render extra), no
      // agujeros. Son 23 avisos repartidos por `hooks/**`, `components/**` y
      // `lib/chart-theme.ts` — código que en esta remediación es propiedad de
      // OTROS PRs. Arreglarlos aquí significaría reescribir efectos ajenos en
      // paralelo, que es exactamente cómo se pierde la trazabilidad de un PR.
      //
      // Criterio de promoción a `error`: cuando el fichero correspondiente se
      // toque por otro motivo, se arregla y se sube la regla. `set-state-in-effect`
      // es la primera candidata (concentra 21 de los 23 avisos y casi todos son el
      // mismo patrón: `useEffect` que sincroniza estado derivado, sustituible por
      // cálculo en render o por `useSyncExternalStore`).
      // ----------------------------------------------------------------
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },

  {
    // Los scripts de `scripts/**` corren en Node (no en el bundle del navegador) y
    // son herramienta de operación, no producto: no aplican las reglas de Next.
    files: ['scripts/**'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]

// Export nombrado antes del default: `import/no-anonymous-default-export` avisa si
// se exporta el array literal directamente.
export default config
