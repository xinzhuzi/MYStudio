export const IMAGE_TRANSFER_MAX_BYTES = 1_000_000;
export const IMAGE_TRANSFER_TARGET_MAX_EDGE = 768;

const TRANSFER_MAX_EDGES = [768, 672, 576, 512, 448, 384, 320, 256] as const;
const TRANSFER_JPEG_QUALITIES = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.4] as const;

export type ReferenceImageRaster = {
  width: number;
  height: number;
  renderJpeg: (maxEdge: number, quality: number) => {
    dataUrl: string;
    width: number;
    height: number;
  };
};

export type ReferenceImageRasterLoader = (source: string) => Promise<ReferenceImageRaster>;

function isRemoteHttpImage(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function parseDataImagePayload(dataUrl: string): string {
  const match = /^data:image\/[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('参考图 data URI 格式无效');
  }
  return match[1].replace(/\s+/g, '');
}

export function imageTransferPayloadBytes(dataUrl: string): number {
  const encoded = parseDataImagePayload(dataUrl);
  try {
    return atob(encoded).length;
  } catch {
    throw new Error('参考图 data URI base64 解码失败');
  }
}

export function assertImageTransferPayloadSize(dataUrl: string): number {
  const byteCount = imageTransferPayloadBytes(dataUrl);
  if (byteCount >= IMAGE_TRANSFER_MAX_BYTES) {
    throw new Error(
      `参考图缩略图必须严格小于 ${IMAGE_TRANSFER_MAX_BYTES} bytes，实际 ${byteCount} bytes`,
    );
  }
  return byteCount;
}

// 1010:自定义本机协议图(asset-file:// 等)直载进 <img> 再画 canvas 会污染画布,
// toDataURL 抛 SecurityError(角色资产再生成带参考图链全灭实锤)。先 fetch→blob→
// objectURL(同源,画布干净);fetch 不通(协议未注册/离线)回落旧行为直载。
const UNTAINTED_FETCH_SCHEMES = /^(asset-file|local-image|project-file|toonflow-asset):/i;

async function toUntaintedImageSrc(source: string): Promise<string> {
  if (!UNTAINTED_FETCH_SCHEMES.test(source)) return source;
  // ①file:// 源下 fetch 自定义协议被 CORS 拦(装机实弹「Failed to fetch」)——
  //   走 studioAssets 桥:URL→本地路径→主进程读字节→data:(data: 永不染画布)
  const studioAssets = (globalThis as { studioAssets?: {
    readUrlDataUrl?: (url: string) => Promise<string | null>;
  } }).studioAssets;
  try {
    if (studioAssets?.readUrlDataUrl) {
      const dataUrl = await studioAssets.readUrlDataUrl(source);
      if (dataUrl) return dataUrl;
    }
  } catch {
    // 落到 ②
  }
  // ②fetch→blob(同源化;协议带 ACAO 且非 file:// 源时可用)
  if (typeof fetch !== 'undefined') {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error(`非图片响应:${blob.type}`);
      return URL.createObjectURL(blob);
    } catch {
      // 落到 ③
    }
  }
  // ③回落直载(旧行为:画布可能被污染,toDataURL 抛错即本轮修复前形态)
  return source;
}

export const loadBrowserReferenceImageRaster: ReferenceImageRasterLoader = (source) => (
  (async () => new Promise<ReferenceImageRaster>((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      reject(new Error('当前运行时不支持参考图缩略处理'));
      return;
    }
    const image = new Image();
    image.onload = () => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) {
        reject(new Error('参考图尺寸无效'));
        return;
      }
      resolve({
        width: sourceWidth,
        height: sourceHeight,
        renderJpeg: (maxEdge: number, quality: number) => {
          const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
          const width = Math.max(1, Math.round(sourceWidth * scale));
          const height = Math.max(1, Math.round(sourceHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('无法创建参考图缩略画布');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          return {
            dataUrl: canvas.toDataURL('image/jpeg', quality),
            width,
            height,
          };
        },
      });
    };
    image.onerror = () => reject(new Error('参考图无法解码'));
    void toUntaintedImageSrc(source).then((src) => {
      try {
        image.src = src;
      } catch {
        reject(new Error('参考图无法解码'));
      }
    });
  }))()
);

export async function prepareReferenceImageForTransfer(
  source: string,
  loadRaster: ReferenceImageRasterLoader = loadBrowserReferenceImageRaster,
): Promise<string> {
  if (isRemoteHttpImage(source)) return source;
  if (source.startsWith('data:')) {
    imageTransferPayloadBytes(source);
  }

  let raster: ReferenceImageRaster;
  try {
    raster = await loadRaster(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`参考图发送前缩略失败：${message}`);
  }

  for (const maxEdge of TRANSFER_MAX_EDGES) {
    for (const quality of TRANSFER_JPEG_QUALITIES) {
      let rendered: ReturnType<ReferenceImageRaster['renderJpeg']>;
      try {
        rendered = raster.renderJpeg(maxEdge, quality);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`参考图发送前缩略失败：${message}`);
      }
      if (Math.max(rendered.width, rendered.height) > IMAGE_TRANSFER_TARGET_MAX_EDGE) {
        throw new Error('参考图缩略尺寸超过 768px 硬门');
      }
      const byteCount = imageTransferPayloadBytes(rendered.dataUrl);
      if (byteCount < IMAGE_TRANSFER_MAX_BYTES) return rendered.dataUrl;
    }
  }

  throw new Error(
    `参考图发送前缩略失败：无法生成严格小于 ${IMAGE_TRANSFER_MAX_BYTES} bytes 的缩略图`,
  );
}

export async function prepareReferenceImagesForTransfer(
  sources?: string[],
  loadRaster: ReferenceImageRasterLoader = loadBrowserReferenceImageRaster,
): Promise<string[] | undefined> {
  if (!sources?.length) return undefined;
  const prepared: string[] = [];
  for (const source of sources) {
    prepared.push(await prepareReferenceImageForTransfer(source, loadRaster));
  }
  return prepared;
}
