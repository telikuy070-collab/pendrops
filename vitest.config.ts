import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readPackageVersion } from './scripts/build-core.mjs';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Same source of truth as the build: package.json.
  define: {
    __APP_VERSION__: JSON.stringify(readPackageVersion(rootDir)),
    __BUILD_TIMESTAMP__: JSON.stringify(0),
    __BUILD_DATE__: JSON.stringify(''),
  },
  // Mirrors vite.config.js so tests can import modules that use path aliases
  // (e.g. src/infrastructure/supabase/repository.ts imports @core and @shared).
  resolve: {
    alias: {
      '@core': resolve(rootDir, 'src/core'),
      '@infrastructure': resolve(rootDir, 'src/infrastructure'),
      '@infrastructure/github': resolve(rootDir, 'src/infrastructure/github'),
      '@presentation': resolve(rootDir, 'src/presentation'),
      '@shared': resolve(rootDir, 'src/shared'),
    },
  },
  test: {
    root: '.',
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // Root-only discovery: Teacher lives in a separate repository and agent
    // worktrees under .kilo/ must never contribute tests to the root suite.
    exclude: [
      '**/node_modules/**',
      '.kilo/**',
      '**/.kilo/**',
      '**/worktrees/**',
      'teacher-app/**',
      '**/teacher-app/**',
      'pendrops-Teacher/**',
      '**/pendrops-Teacher/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/parser',
      include: [
        'src/parser/engine.ts',
        'src/parser/cellReader.ts',
        'src/parser/fieldExtractor.ts',
        'src/parser/classifier.ts',
        'src/parser/confidenceScorer.ts',
        'src/parser/registry.ts',
        'src/parser/types.ts',
        'src/types/lesson.js',
        'src/day.js',
        'src/sheet.js',
        'src/infrastructure/github/parser.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 90,
        statements: 90,
      },
    },
  },
});
