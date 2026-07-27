import imageSize from "./image-size";

/**
 * Vendored AiToEarn 只用 `sharp(buffer).metadata()` 读取图片宽高，见
 * `vendor/aitoearn-core/electron/plat/utils/index.ts:38`（`getImageBaseInfo`
 * 只消费 `metadata.width` 和 `metadata.height`）。
 *
 * sharp 是原生模块：被打进 Electron main bundle 后 `.node` 无法动态 require，
 * 打包后的应用会在启动时抛 "Could not load the sharp module" 并直接崩溃；
 * 而且它只声明在 devDependencies，打包产物本就不会携带它。
 *
 * 这里复用同目录下的纯 JS 尺寸解析 shim，与 image-size / xml2js / crc32 /
 * crypto-js / fluent-ffmpeg 等 shim 保持一致，且不修改 vendor 快照。
 */

export interface SharpMetadata {
  width: number;
  height: number;
  format?: string;
}

export interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
}

export default function sharp(buffer: Buffer): SharpInstance {
  return {
    async metadata(): Promise<SharpMetadata> {
      const { width, height, type } = imageSize(buffer);
      return { width, height, format: type };
    },
  };
}
