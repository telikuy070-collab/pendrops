/**
 * Vite config for PenDrops Мугалим (Teacher PWA).
 *
 * Builds on the same patterns as the student PWA but configures a separate
 * build output and dev server target. Inherits all shared tooling from package.json.
 */
import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vite plugin to inject Supabase configuration into the teacher service worker.
 *
 * The service worker template lives at teacher-app/config/sw.template.js with
 * __SUPABASE_URL__, __SUPABASE_ANON_KEY__, and __TEACHER_BUCKET__ placeholders.
 * During build, this plugin reads the template, injects real env values, and
 * writes the final sw.js to teacher-app/public/sw.js (for dev) and to the build
 * output directory (for production).
 */
function teacherSwConfigInjector(mode, cwd) {
  return {
    name: 'teacher-sw-config-injector',
    apply: 'build',
    closeBundle() {
      const swTemplatePath = resolve(cwd, 'teacher-app/config/sw.template.js');
      if (!existsSync(swTemplatePath)) return;

      let content = readFileSync(swTemplatePath, 'utf-8');
      const env = loadEnv(mode, cwd);

      const supabaseUrl = env.VITE_SUPABASE_URL || '';
      const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

      content = content
        .replace(/__SUPABASE_URL__/g, supabaseUrl)
        .replace(/__SUPABASE_ANON_KEY__/g, supabaseAnonKey)
        .replace(/__TEACHER_BUCKET__/g, env.VITE_TEACHER_BUCKET || 'teacher_homework');

      // Write to public dir for dev server
      const publicSwPath = resolve(cwd, 'teacher-app/public/sw.js');
      writeFileSync(publicSwPath, content, 'utf-8');

      // Also write to build output dir for production
      // Vite root is teacher-app/, outDir is ../dist-teacher, so output is at cwd/dist-teacher
      const outputDir = resolve(cwd, 'dist-teacher');
      mkdirSync(outputDir, { recursive: true });

      writeFileSync(resolve(outputDir, 'sw.js'), content, 'utf-8');

      // Write manifest to root of output (Vite puts a hashed copy in assets/, this is the canonical one)
      const manifestSrc = resolve(cwd, 'teacher-app/manifest.teacher.json');
      if (existsSync(manifestSrc)) {
        writeFileSync(resolve(outputDir, 'manifest.teacher.json'), readFileSync(manifestSrc, 'utf-8'), 'utf-8');
      }

      // Write .nojekyll to output root (prevents GitHub Pages from using Jekyll)
      writeFileSync(resolve(outputDir, '.nojekyll'), '', 'utf-8');
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    root: 'teacher-app',
    base: isProd ? 'https://telikuy070-collab.github.io/pendrops-Teacher/' : '/',
    server: {
      port: 8081,
      open: true,
    },
    plugins: [teacherSwConfigInjector(mode, process.cwd())],
    build: {
      outDir: '../dist-teacher',
      emptyOutDir: true,
      assetsDir: 'assets',
      sourcemap: !isProd,
      rollupOptions: {
        input: {
          main: './index.html',
        },
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules/@supabase')) return 'supabase';
            if (id.includes('node_modules/zod')) return 'zod';
          },
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify('1.0.0'),
      __APP_TYPE__: JSON.stringify('teacher'),
    },
    resolve: {
      alias: {
        '@teacher': '/src',
      },
    },
  };
});
