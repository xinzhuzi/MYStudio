// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 生图落库自动轻度去噪(噪点治理 08-29 方案 3)。
 *
 * 与 apps/build/scripts/image_lowfreq_denoise.py / upscale adapter 同源算法:
 * 双边滤波(表面模糊)取低频 + 高频软阈值保线稿。任何失败一律返回原图
 * (fail-open,绝不断生图链)。滤波本体在 lowfreq-denoise.ts(纯函数单源),
 * 大图经 denoise-worker.ts 在 Worker 执行(09-03 主线程冻结根修)。
 */
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { lowfreqDenoiseRgba } from "./lowfreq-denoise";

export { lowfreqDenoiseRgba } from "./lowfreq-denoise";

const DENOISE_MAX_LONG_SIDE = 2048;

export function isAutoDenoiseEnabled(): boolean {
  try {
    return useAppSettingsStore.getState().imageGenerationSettings.autoDenoiseEnabled === true;
  } catch {
    return false;
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

/** 小图阈值:≤512² 主线程同步滤波(<1s);更大图一律 Worker,无 Worker
 * 环境直接跳过——绝不重演 1024² 主线程同步冻结(09-03 图生图卡死实弹)。 */
const SMALL_IMAGE_PIXELS = 512 * 512;

/** Worker 内执行滤波;失败/超时返回 null(fail-open 原图落库)。 */
function denoiseInWorker(image: ImageData): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./denoise-worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, 30_000);
    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      try {
        resolve(new Uint8ClampedArray((event.data as { rgba: ArrayBuffer }).rgba));
      } catch {
        resolve(null);
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };
    // transferable:零拷贝移交(主线程 image.data 随之 detach,失败走原图)
    const buffer = image.data.buffer as ArrayBuffer;
    worker.postMessage({ rgba: buffer, width: image.width, height: image.height }, [buffer]);
  });
}

/** 落库前自动去噪入口:失败/未启用/非图一律原样返回。
 * 09-03 根修:大图(生图产物基本都 ≥1024²)双边滤波搬进 Web Worker——
 * 主线程同步跑 8400 万次 exp 会把 UI 冻结约 1 分钟(图生图卡死实弹),
 * 用户三次重启连试三次、每次生成即卡。 */
export async function applyAutoDenoise(url: string, enabled: boolean): Promise<string> {
  if (!enabled || !url || !(url.startsWith("data:image") || url.startsWith("http"))) return url;
  try {
    const canvas = await loadToCanvas(url);
    if (!canvas) return url;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = canvas.width * canvas.height;
    if (pixels > SMALL_IMAGE_PIXELS) {
      if (typeof Worker === "undefined") return url; // 无 Worker 环境:大图跳过
      const denoised = await denoiseInWorker(image);
      if (!denoised) return url;
      const out = new ImageData(new Uint8ClampedArray(denoised), canvas.width, canvas.height);
      ctx.putImageData(out, 0, 0);
    } else {
      lowfreqDenoiseRgba(image.data, canvas.width, canvas.height);
      ctx.putImageData(image, 0, 0);
    }
    return canvas.toDataURL("image/png");
  } catch {
    // CORS(tainted canvas)/解码失败等:原图落库,绝不断链
    return url;
  }
}
