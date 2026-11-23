// ComfyUI 引擎渲染层桥入口(1123 自 panels/settings/comfy-engine/comfy-engine-contract.ts 归位)。
// 优先 preload 注入的 window.comfyEngine;preload 未注入时 Electron 渲染层回落 HTTP 直连 sidecar;
// SSR、网页与 jsdom 测试环境返回 undefined(测试注入 mock)。

import type { ComfyEngineClient } from "@/types/comfy-engine";
import {
  createHttpComfyEngineClient,
  isElectronRenderer,
} from "./comfy-sidecar-bridge";

export function getComfyEngineClient(): ComfyEngineClient | undefined {
  if (typeof window === "undefined") return undefined;
  const injected = (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  if (injected) return injected;
  return isElectronRenderer() ? createHttpComfyEngineClient() : undefined;
}
