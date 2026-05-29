import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiCorsProxyPlugin } from './api-cors-proxy';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(configDir, '..', '..');
const electronViteOutDir = path.resolve(projectRoot, 'release', '.electron-vite');

export default defineConfig({
  main: {
    build: {
      outDir: path.resolve(electronViteOutDir, 'main'),
      rollupOptions: {
        input: {
          index: path.resolve(projectRoot, 'src/electron/main.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
  },
  preload: {
    build: {
      outDir: path.resolve(electronViteOutDir, 'preload'),
      rollupOptions: {
        input: {
          index: path.resolve(projectRoot, 'src/electron/preload.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: projectRoot,
    publicDir: false,
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },
    build: {
      outDir: path.resolve(electronViteOutDir, 'renderer'),
      rollupOptions: {
        input: {
          index: path.resolve(projectRoot, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(projectRoot, 'src'),
        '@opencut/ai-core/services/prompt-compiler': path.resolve(projectRoot, 'src/packages/ai-core/services/prompt-compiler.ts'),
        '@opencut/ai-core/api/task-poller': path.resolve(projectRoot, 'src/packages/ai-core/api/task-poller.ts'),
        '@opencut/ai-core/protocol': path.resolve(projectRoot, 'src/packages/ai-core/protocol/index.ts'),
        '@opencut/ai-core': path.resolve(projectRoot, 'src/packages/ai-core/index.ts'),
      },
    },
    plugins: [
      apiCorsProxyPlugin(),
      react(),
    ],
  },
});
