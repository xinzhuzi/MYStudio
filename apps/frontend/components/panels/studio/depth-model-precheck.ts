// Depth model precheck — a non-React helper usable inside plain async flows
// (hooks, callbacks) where the AlertDialog cannot be mounted inline.
//
// Returns "ready" | "missing" | "unknown":
//   ready   → model downloaded, cinematic 3D can run
//   missing → model absent; caller should surface the warning dialog
//   unknown → bridge unavailable or status read failed; render falls back to
//             2D fail-closed without nagging the user.

import { getDepthRuntimeBridge } from "@/lib/bridge/depth-runtime";

export type DepthModelReadiness = "ready" | "missing" | "unknown";

export async function checkDepthModelReady(): Promise<DepthModelReadiness> {
  const bridge = getDepthRuntimeBridge();
  if (!bridge) return "unknown";
  try {
    const status = await bridge.status();
    return status.modelDownloaded ? "ready" : "missing";
  } catch {
    return "unknown";
  }
}
