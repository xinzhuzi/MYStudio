import { ipcMain } from "electron";
import {
  REMOTION_SHOT_RENDER_CANCEL_CHANNEL,
  REMOTION_SHOT_RENDER_CHANNEL,
  validateRemotionShotRenderRequest,
} from "@rendering/plugins/remotion/renderer/remotion-shot-ipc";
import type { RemotionShotRenderer } from "@rendering/plugins/remotion/renderer/remotion-shot-renderer";

interface RemotionShotServiceLike {
  render: RemotionShotRenderer["render"];
  cancel: RemotionShotRenderer["cancel"];
  dispose: RemotionShotRenderer["dispose"];
}

export function registerRemotionShotIpcHandlers(service: RemotionShotServiceLike): { dispose: () => Promise<void> } {
  ipcMain.handle(REMOTION_SHOT_RENDER_CHANNEL, async (_event, payload: unknown) => {
    const request = await assertValid(validateRemotionShotRenderRequest(payload));
    return service.render(request.plan);
  });
  ipcMain.handle(REMOTION_SHOT_RENDER_CANCEL_CHANNEL, async (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.jobId !== "string" || !payload.jobId.trim()) {
      throw new Error("shot render cancel jobId 必须是非空字符串");
    }
    return service.cancel(payload.jobId);
  });
  return {
    async dispose() {
      ipcMain.removeHandler(REMOTION_SHOT_RENDER_CHANNEL);
      ipcMain.removeHandler(REMOTION_SHOT_RENDER_CANCEL_CHANNEL);
      await service.dispose();
    },
  };
}

async function assertValid<T>(
  result: Promise<{ success: true; value: T } | { success: false; issues: Array<{ path: string; message: string }> }>,
): Promise<T> {
  const resolved = await result;
  if (!resolved.success) throw new Error(resolved.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return resolved.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
