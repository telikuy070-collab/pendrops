import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * 
 * All static assets (sw.js, manifest.json, xlsx.full.min.js, icons) 
 * are in public/ and automatically copied to dist/ by Vite.
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
          // Hash-based filenames for cache busting
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
        },
      },
    },
    // Environment variables — prefix VITE_ to expose to client
    define: {
      __APP_VERSION__: JSON.stringify('1.8.1'),
    },
    resolve: {
      alias: {
        '@core': resolve(__dirname, 'src/core'),
        '@infrastructure': resolve(__dirname, 'src/infrastructure'),
        '@presentation': resolve(__dirname, 'src/presentation'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  };
});