import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Build timestamp for SW cache busting
const BUILD_TIMESTAMP = Date.now();

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";
  const repoName = process.env.GITHUB_REPOSITORY || "telikuy070-collab/pendrops";
  const [, repoOnly] = repoName.split("/");

  return {
    base: isProd ? `/${repoOnly}/` : "/",
    root: ".",
    publicDir: "public",
    server: {
      port: 8080,
      open: true,
    },
    build: {
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: !isProd,
      // Copy 404.html for SPA fallback on GitHub Pages
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
      // Generate build info for version tracking
      manifest: true,
    },
    define: {
      __APP_VERSION__: JSON.stringify("1.8.1"),
      __BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    },
    resolve: {
      alias: {
        "@core": resolve(__dirname, "src/core"),
        "@infrastructure": resolve(__dirname, "src/infrastructure"),
        "@infrastructure/github": resolve(__dirname, "src/infrastructure/github"),
        "@presentation": resolve(__dirname, "src/presentation"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    plugins: [
      {
        name: "copy-404-and-sw-version",
        closeBundle() {
          // Copy 404.html for SPA fallback
          const src404 = resolve(__dirname, "public/404.html");
          const dest404 = resolve(__dirname, "dist/404.html");
          if (existsSync(src404)) {
            copyFileSync(src404, dest404);
            console.log("[vite] Copied 404.html for SPA fallback");
          }

          // Update SW cache version in sw.js
          const swPath = resolve(__dirname, "dist/sw.js");
          if (existsSync(swPath)) {
            let swContent = readFileSync(swPath, "utf-8");
            swContent = swContent.replace(
              /const CACHE_VERSION = 'schedule-pwa-\d+';/,
              `const CACHE_VERSION = 'schedule-pwa-${BUILD_TIMESTAMP}';`
            );
            writeFileSync(swPath, swContent);
            console.log(`[vite] Updated SW cache version to ${BUILD_TIMESTAMP}`);
          }
        },
      },
    ],
  };
});

// Node.js fs imports for plugin
import { readFileSync, writeFileSync } from "node:fs";