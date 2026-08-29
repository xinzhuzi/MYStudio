/**
 * 生图落库自动轻度去噪(噪点治理 08-29 方案 3)。
 *
 * 与 apps/build/scripts/image_lowfreq_denoise.py / upscale adapter 同源算法:
 * 双边滤波(表面模糊)取低频 + 高频软阈值保线稿。纯 canvas/TypedArray,
 * 无 Python 依赖;任何失败一律返回原图(fail-open,绝不断生图链)。
 */
import { useAppSettingsStore } from "@/stores/app/app-settings-store";

const DENOISE_MAX_LONG_SIDE = 2048;

export function isAutoDenoiseEnabled(): boolean {
  try {
    return useAppSettingsStore.getState().imageGenerationSettings.autoDenoiseEnabled === true;
  } catch {
    return false;
  }
}

/**
 * 高频软阈值核心(纯函数,可单测):就地修改 RGBA 数据。
 * strength=细颗粒判定阈值(幅值低于它视为噪点),keep=噪点残留比例。
 */
export function lowfreqDenoiseRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 12,
  keep = 0.3,
  radius = 4,
): void {
  const n = width * height;
  const src = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    src[i * 3] = data[j];
    src[i * 3 + 1] = data[j + 1];
    src[i * 3 + 2] = data[j + 2];
  }

  // 双边滤波(移位窗口):out = Σ w·邻像素 / Σ w
  const low = new Float32Array(n * 3);
  const sigmaS = 4.0;
  const sigmaR2 = 2 * 25.0 * 25.0;
  const spatial = new Float32Array(radius * 2 + 1);
  for (let d = -radius; d <= radius; d++) {
    spatial[d + radius] = Math.exp(-(d * d) / (2 * sigmaS * sigmaS));
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * 3;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const idx = (yy * width + xx) * 3;
          const dr = src[idx] - src[base];
          const dg = src[idx + 1] - src[base + 1];
          const db = src[idx + 2] - src[base + 2];
          const w =
            spatial[dy + radius] *
            spatial[dx + radius] *
            Math.exp(-(dr * dr + dg * dg + db * db) / sigmaR2);
          sr += w * src[idx];
          sg += w * src[idx + 1];
          sb += w * src[idx + 2];
          wr += w;
          wg += w;
          wb += w;
        }
      }
      low[base] = sr / wr;
      low[base + 1] = sg / wg;
      low[base + 2] = sb / wb;
    }
  }

  // 高频软阈值:幅值大的线稿保留,细颗粒衰减到 keep
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    for (let c = 0; c < 3; c++) {
      const idx = i * 3 + c;
      const high = src[idx] - low[idx];
      const mag = Math.max(
        Math.abs(src[i * 3] - low[i * 3]),
        Math.abs(src[i * 3 + 1] - low[i * 3 + 1]),
        Math.abs(src[i * 3 + 2] - low[i * 3 + 2]),
      );
      const soft = Math.min(1, mag / strength);
      const gain = keep + (1 - keep) * soft;
      data[j + c] = low[idx] + high * gain;
    }
  }
}

async function loadToCanvas(url: string): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
  if (!loaded || img.width === 0 || img.height === 0) return null;
  let { width, height } = img;
  if (Math.max(width, height) > DENOISE_MAX_LONG_SIDE) {
    const scale = DENOISE_MAX_LONG_SIDE / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/** 落库前自动去噪入口(读设置开关):项目内落图消费方共用。 */
export async function maybeAutoDenoiseUrl(url: string): Promise<string> {
  return applyAutoDenoise(url, isAutoDenoiseEnabled());
}

/** 落库前自动去噪入口:失败/未启用/非图一律原样返回。 */
export async function applyAutoDenoise(url: string, enabled: boolean): Promise<string> {
  if (!enabled || !url || !(url.startsWith("data:image") || url.startsWith("http"))) return url;
  try {
    const canvas = await loadToCanvas(url);
    if (!canvas) return url;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    lowfreqDenoiseRgba(image.data, canvas.width, canvas.height);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    // CORS(tainted canvas)/解码失败等:原图落库,绝不断链
    return url;
  }
}
