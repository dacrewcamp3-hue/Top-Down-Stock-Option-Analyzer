import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// ESLint covers the .js/.jsx components (where the React-hooks rules matter most).
// The .ts/.tsx files are type- and syntax-checked by `npm run typecheck` (tsc),
// so they're intentionally excluded here to avoid pulling in a second TS parser.
export default [
  { ignores: ['dist', 'node_modules', 'api', '**/*.ts', '**/*.tsx'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Loosened for an established codebase: surface problems as warnings, not hard errors.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // Empty catch blocks are intentional here — non-fatal fetches degrade gracefully.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
