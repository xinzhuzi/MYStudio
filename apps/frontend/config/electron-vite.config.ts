import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiCorsProxyPlugin } from './api-cors-proxy';
import { cspPlugin } from './csp-plugin';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(configDir, '..');
const projectRoot = path.resolve(configDir, '..', '..');
const electronViteOutDir = path.resolve(projectRoot, 'out');
const aitoearnCompatibility = path.resolve(
  frontendRoot,
  'electron/aitoearn/providers/aitoearn-local/compatibility',
);
const sharedAlias = {
  '@': frontendRoot,
  '@rendering': path.resolve(frontendRoot, 'electron/rendering'),
  '@@/utils.type': path.join(aitoearnCompatibility, 'utils-type.ts'),
  'image-size': path.join(aitoearnCompatibility, 'image-size.ts'),
  xml2js: path.join(aitoearnCompatibility, 'xml2js.ts'),
  crc32: path.join(aitoearnCompatibility, 'crc32.ts'),
  'crypto-js': path.join(aitoearnCompatibility, 'crypto-js.ts'),
  'fluent-ffmpeg': path.join(aitoearnCompatibility, 'fluent-ffmpeg.ts'),
  sharp: path.join(aitoearnCompatibility, 'sharp.ts'),
  'electron-log/main': path.join(aitoearnCompatibility, 'electron-log-main.ts'),
  '@aitoearn/xhs': path.resolve(frontendRoot, 'electron/aitoearn/vendor/aitoearn-core/electron/plat/xiaohongshu/index.ts'),
  '@aitoearn/douyin': path.resolve(frontendRoot, 'electron/aitoearn/vendor/aitoearn-core/electron/plat/douyin/index.ts'),
  '@aitoearn/wx': path.resolve(frontendRoot, 'electron/aitoearn/vendor/aitoearn-core/electron/plat/shipinhao/index.ts'),
  '@aitoearn/kwai': path.resolve(frontendRoot, 'electron/aitoearn/vendor/aitoearn-core/electron/plat/Kwai/index.ts'),
};

// 手册图片空桩别名(09-15 打包瘦身):manuals-images.ts 的 import.meta.glob(?url)
// 会让主进程构建重复发射 75 张 PNG 共 56MB 到 out/main/chunks。主进程只吃手册
// 文本(preset.images 主侧零消费),main/preload 构建换空桩;必须排在 sharedAlias
// 的 "@" 之前——rollup alias 是前缀匹配,"@" 会先吞掉 "@/lib/..." 全部路径。
const manualsImagesStubAlias = {
  '@/lib/studio/manuals-images': path.resolve(frontendRoot, 'lib/studio/manuals-images.main-stub.ts'),
};
const mainPreloadAlias = { ...manualsImagesStubAlias, ...sharedAlias };

export default defineConfig({
  main: {
    resolve: { alias: mainPreloadAlias },
    build: {
      outDir: path.resolve(electronViteOutDir, 'main'),
      rollupOptions: {
        input: {
          index: path.resolve(frontendRoot, 'electron/main/main.ts'),
          'remotion-browser-worker': path.resolve(
            projectRoot,
            'frontend/electron/rendering/plugins/remotion/browser/remotion-browser-worker.ts',
          ),
          'remotion-render-worker': path.resolve(
            projectRoot,
            'frontend/electron/rendering/plugins/remotion/renderer/remotion-render-worker-entry.ts',
          ),
          'hyperframes-worker': path.resolve(
            projectRoot,
            'frontend/electron/rendering/plugins/hyperframes/hyperframes-worker.ts',
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
    resolve: { alias: mainPreloadAlias },
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
      cspPlugin(),
    ],
  },
});
