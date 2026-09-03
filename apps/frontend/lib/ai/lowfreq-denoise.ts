// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 高频软阈值低频去噪纯函数(零依赖,主线程与 Worker 共用单源)。
 * 09-03 卡死根修背景:1024² 图=8400 万次 exp,主线程同步执行会冻结 UI
 * 约 1 分钟(图生图实弹实锤)——大图必须经 denoise-worker 在 Worker 跑。
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
