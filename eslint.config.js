import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

// Adapted from upstream Advanced_Analysis eslint.config.js (React residue and
// LFEA-only paths removed). `catch {}` is allowed: it is used deliberately for
// optional work such as localStorage access.
const pageGlobals = {
  __BUILD_TIME__: 'readonly',
  XLSX: 'readonly',
  showToast: 'readonly',
  MASTER_FIELDS: 'readonly',
  AnalysisWorkspace: 'readonly',
  EventBus: 'readonly',
};
const rules = {
  'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

export default defineConfig([
  // benchmarks/browser holds console snippets pasted one step at a time (not a module).
  globalIgnores(['dist', 'node_modules', '_source', '**/*.test.js', 'benchmarks/browser/**']),
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...pageGlobals },
    },
    rules,
  },
]);
