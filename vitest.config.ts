import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Alias `@` → repo root, mirroring `compilerOptions.paths` in tsconfig.json
// (`"@/*": ["./*"]`) so tests import `@/lib/...` exactly like app code does.
// `__dirname` (not `import.meta.url`): package.json has no `"type": "module"`,
// so Vite loads this config as CommonJS.
const root = path.resolve(__dirname)

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
  },
})
