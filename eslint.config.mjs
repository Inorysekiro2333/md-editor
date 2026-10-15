import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', 'out/**', 'release/**', 'coverage/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['electron/**/*.ts', 'packages/**/*.{ts,tsx}', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
