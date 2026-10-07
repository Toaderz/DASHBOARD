import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// REL-01: `next lint` ya no existe en Next 16; se usa el CLI de ESLint con config plana.
const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      '.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts',
      'public/sw.js', 'public/workbox-*.js',
      'scripts/**',            // herramientas locales .mjs/.ts fuera del bundle
      'evolve_design_temp/**', // material de diseno (ya en .gitignore)
    ],
  },
  {
    // Reglas nuevas del compilador de React: marcan patrones que ya existian y funcionan
    // (setState dentro de useEffect, etc.). Se dejan como aviso para no reescribir componentes
    // sin necesidad; cualquier otro error SI rompe el lint y el CI.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
  },
]

export default config
