// Upscale model precheck — a non-React helper usable inside plain async flows
// (hooks, callbacks) where the toast deep-link cannot be mounted inline.
//
// Returns "ready" | "missing" | "unknown":
//   ready   → active model downloaded, super-resolution can run
//   missing → model absent; caller should surface the toast + 去设置 deep-link
//   unknown → bridge unavailable or status read failed; fail-closed without
//             nagging the user (web mode).

import { getUpscaleRuntimeBridge } from "@/lib/bridge/upscale-runtime";

export type UpscaleModelReadiness = "ready" | "missing" | "unknown";

export async function checkUpscaleModelReady(): Promise<UpscaleModelReadiness> {
  const bridge = getUpscaleRuntimeBridge();
  if (!bridge) return "unknown";
  try {
    const status = await bridge.status();
    return status.modelDownloaded ? "ready" : "missing";
  } catch {
    return "unknown";
  }
}
