/// <reference types="vitest" />
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron/simple';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { apiCorsProxyPlugin } from './api-cors-proxy';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(configDir, '..', '..');

export default defineConfig({
  publicDir: false,
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'frontend'),
      '@opencut/ai-core/services/prompt-compiler': path.resolve(projectRoot, 'frontend/packages/ai-core/services/prompt-compiler.ts'),
      '@opencut/ai-core/api/task-poller': path.resolve(projectRoot, 'frontend/packages/ai-core/api/task-poller.ts'),
      '@opencut/ai-core/protocol': path.resolve(projectRoot, 'frontend/packages/ai-core/protocol/index.ts'),
      '@opencut/ai-core': path.resolve(projectRoot, 'frontend/packages/ai-core/index.ts'),
    },
  },
  plugins: [
    apiCorsProxyPlugin(),
    react(),
    electron({
      main: {
        entry: 'frontend/electron/main.ts',
      },
      preload: {
        input: path.join(projectRoot, 'frontend/electron/preload.ts'),
      },
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
  test: {
    setupFiles: [path.resolve(configDir, 'vitest.setup.ts')],
  },
});
