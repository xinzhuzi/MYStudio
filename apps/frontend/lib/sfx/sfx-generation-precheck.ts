// Local sfx generation readiness precheck — mirrors lib/upscale/upscale-model-precheck.ts:
//   ready   → enabled model downloaded, generation can run
//   missing → model absent; caller should surface the toast + 去设置 deep-link
//   unknown → bridge unavailable or status read failed; fail-closed without
//             nagging the user (web mode).
// 显式下载铁律:生成前只探测,绝不触发下载。

import { toast } from "sonner";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import type { SfxGenRuntimeStatus } from "@/types/sfx-gen";

export type SfxModelReadiness = "ready" | "missing" | "unknown";

interface SfxGenStatusBridge {
  status: () => Promise<SfxGenRuntimeStatus>;
}

function getSfxGenStatusBridge(): SfxGenStatusBridge | undefined {
  return typeof window !== "undefined"
    ? (window as { sfxGenRuntime?: SfxGenStatusBridge }).sfxGenRuntime
    : undefined;
}

export async function checkSfxModelReady(): Promise<SfxModelReadiness> {
  const bridge = getSfxGenStatusBridge();
  if (!bridge) return "unknown";
  try {
    const status = await bridge.status();
    const enabled = status.models.find((row) => row.enabled !== false);
    if (!enabled) return "missing";
    return enabled.downloaded ? "ready" : "missing";
  } catch {
    return "unknown";
  }
}

/** surface the missing-model toast with the 去设置 deep-link(depth/upscale pattern)。 */
export function notifySfxModelMissing(): void {
  toast.error(
    "音效模型未下载,无法本地生成。请前往 设置 → 本地配置 → 本地音效生成 下载模型(与本地音乐生成共用缓存,已下载 MusicGen 则直接就绪)",
    {
      action: {
        label: "去设置",
        onClick: () => {
          const nav = useMediaPanelStore.getState();
          nav.requestSettingsTab("plugins");
          nav.setActiveTab("settings");
        },
      },
    },
  );
}
