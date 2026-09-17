import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    },
    define: {
      __APP_VERSION__: JSON.stringify("1.8.1"),
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
  };
});
