// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { lowfreqDenoiseRgba } from "./lowfreq-denoise";

/** 降噪 Worker:大图(≥512²)双边滤波在此执行,主线程零阻塞。
 * 协议:postMessage({rgba: ArrayBuffer, width, height}) → {rgba} (transferable) */
addEventListener("message", (event: MessageEvent) => {
  const { rgba, width, height } = event.data as {
    rgba: ArrayBuffer;
    width: number;
    height: number;
  };
  const data = new Uint8ClampedArray(rgba);
  lowfreqDenoiseRgba(data, width, height);
  (self as unknown as Worker).postMessage({ rgba: data.buffer }, [data.buffer as ArrayBuffer]);
});
