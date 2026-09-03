import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  // Run eslint:ignore patterns in flat config
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'xlsx.full.min.js',
      'src/app.original.js',
      'scripts/patch-*.js',
      'tests/edge-cases.js',
      'tests/store-audit.js',
      'tests/full-audit.js',
      'tests/security-audit.mjs',
      'tests/perf.mjs',
      'tests/audit-sheet.mjs',
      'tests/regr.js',
    ],
  },

  // JavaScript files — checked by TS via JSDoc
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        ResizeObserver: 'readonly',
        customElements: 'readonly',
        HTMLTemplateElement: 'readonly',
        NodeFilter: 'readonly',
        // ES globals
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // TypeScript files
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  prettier
);

