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
  // vitest 专用兜底(本 config 仅 test/test:related 消费,打包走 electron-vite.config.ts):
  // vitest 1.6.1 `related` 的模块图分析会把 `.md?raw` import 解析成裸 .md 路径(query 剥失),
  // vite-node web 分支随后对模块内容无条件 ssrTransform——裸 .md 无插件兜底时 markdown 原文
  // 被 rollup 当 JS parse → PARSE_ERROR(09-28 任务 AC13,92fe0eb 记档 → 2026-09-29 根修)。
  // assetsInclude 让 .md 以 asset 身份走 vite 管线,`?raw` 语义不受影响(raw 分支优先)。
  // 删除此行 = test:related 回到恒崩;build-scripts.test.ts 有字面量锁。
  assetsInclude: ['**/*.md'],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'frontend'),
      '@rendering': path.resolve(projectRoot, 'frontend/electron/rendering'),
    },
  },
  plugins: [
    apiCorsProxyPlugin(),
    react(),
    // vite-plugin-electron 1.x(1003 B2:0.29→1.1)在无渲染入口时会自动在项目根生成
    // index.html 占位(0.29 无此行为,每次 vitest run 都会冒出 apps/index.html)。
    // 本 config 仅 test/test:related 消费(打包走 electron-vite.config.ts),electron
    // 插件的 main/preload 构建 hooks 在 vitest 下本就不触发,故测试态整体不挂载。
    ...(process.env.NODE_ENV === 'test'
      ? []
      : [
          electron({
            main: {
              entry: 'frontend/electron/main/main.ts',
            },
            preload: {
              input: path.join(projectRoot, 'frontend/electron/preload/preload.ts'),
            },
            renderer: {},
          }),
        ]),
  ],
  test: {
    setupFiles: [path.resolve(configDir, 'vitest.setup.ts')],
  },
});
