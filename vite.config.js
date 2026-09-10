import { defineConfig } from 'vite';
import { copyFileSync, existsSync } from 'fs';

/**
 * Vite config for PenDrops PWA.
 *
 * This app is a vanilla ES module PWA with no framework. Vite provides:
 * - Dev server with HMR
 * - TypeScript transpilation (no type-checking at runtime — that's what
 *   `tsc --noEmit` is for)
 * - Build with Rollup
 * - Environment variable injection via `import.meta.env`
 *
 * The app is deploy-target-agnostic: it builds static files to `dist/`.
 * For GitHub Pages, we set `base` to the repo path.
 */
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  const repoName = process.env.GITHUB_REPOSITORY || 'telikuy070-collab/pendrops';
  const [, repoOnly] = repoName.split('/');

  return {
    // GitHub Pages serves from /<repo-name>/ subdirectory
    base: isProd ? `/${repoOnly}/` : '/',
    root: '.',
    publicDir: 'public',
    server: {
      port: 8080,
      open: true,
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: !isProd,
      rollupOptions: {
        input: {
          main: new URL('./index.html', import.meta.url).pathname,
        },
        output: {
          // Code-split vendor libs separately for better caching
          // Rolldown (Vite 8 default) requires manualChunks as a function
          manualChunks: (id) => {
            if (id.includes('node_modules/xlsx')) return 'xlsx';
            if (id.includes('node_modules/zod')) return 'zod';
            if (id.includes('node_modules/@supabase')) return 'supabase';
          },
          // Hash-based filenames for cache busting
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
        },
      },
    },
    // Environment variables — prefix VITE_ to expose to client
    define: {
      __APP_VERSION__: JSON.stringify('1.8.0'),
    },
    resolve: {
      alias: {
        // Allow cleaner imports in future
      },
    },
    plugins: [
      {
        name: 'copy-xlsx',
        closeBundle() {
          // Copy xlsx.full.min.js to dist root for dynamic loading
          if (existsSync('xlsx.full.min.js')) {
            copyFileSync('xlsx.full.min.js', 'dist/xlsx.full.min.js');
          }
          // Copy data files if they exist (optional, for legacy fallback)
          try {
            if (existsSync('data/schedule.xls')) {
              copyFileSync('data/schedule.xls', 'dist/data/schedule.xls');
            }
            if (existsSync('data/version.json')) {
              copyFileSync('data/version.json', 'dist/data/version.json');
            }
            if (existsSync('data/admin.json')) {
              copyFileSync('data/admin.json', 'dist/data/admin.json');
            }
          } catch {
            // Data files are optional - loaded from Supabase in production
          }
        }
      }
    ]
  };
});
