import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiCorsProxyPlugin } from './api-cors-proxy';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(configDir, '..');
const projectRoot = path.resolve(configDir, '..', '..');
const electronViteOutDir = path.resolve(projectRoot, 'out');

export default defineConfig({
  main: {
    build: {
      outDir: path.resolve(electronViteOutDir, 'main'),
      rollupOptions: {
        input: {
          index: path.resolve(frontendRoot, 'electron/main.ts'),
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
          index: path.resolve(frontendRoot, 'electron/preload.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: frontendRoot,
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
          index: path.resolve(frontendRoot, 'renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': frontendRoot,
        '@opencut/ai-core/services/prompt-compiler': path.resolve(frontendRoot, 'packages/ai-core/services/prompt-compiler.ts'),
        '@opencut/ai-core/api/task-poller': path.resolve(frontendRoot, 'packages/ai-core/api/task-poller.ts'),
        '@opencut/ai-core/protocol': path.resolve(frontendRoot, 'packages/ai-core/protocol/index.ts'),
        '@opencut/ai-core': path.resolve(frontendRoot, 'packages/ai-core/index.ts'),
      },
    },
    plugins: [
      apiCorsProxyPlugin(),
      react(),
    ],
  },
});
