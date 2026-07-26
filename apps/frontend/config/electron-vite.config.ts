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
const sharedAlias = {
  '@': frontendRoot,
  '@rendering': path.resolve(projectRoot, 'rendering'),
};

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: path.resolve(electronViteOutDir, 'main'),
      rollupOptions: {
        input: {
          index: path.resolve(frontendRoot, 'electron/main/main.ts'),
          'remotion-browser-worker': path.resolve(
            projectRoot,
            'rendering/plugins/remotion/browser/remotion-browser-worker.ts',
          ),
          'remotion-render-worker': path.resolve(
            projectRoot,
            'rendering/plugins/remotion/renderer/remotion-render-worker-entry.ts',
          ),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: path.resolve(electronViteOutDir, 'preload'),
      rollupOptions: {
        input: {
          index: path.resolve(frontendRoot, 'electron/preload/preload.ts'),
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
      alias: sharedAlias,
    },
    plugins: [
      apiCorsProxyPlugin(),
      react(),
    ],
  },
});
