import { ipcMain } from "electron";
import {
  REMOTION_PREVIEW_CREATE_CHANNEL,
  REMOTION_PREVIEW_RELEASE_CHANNEL,
  REMOTION_SHOT_PREVIEW_CREATE_CHANNEL,
  validateRemotionPreviewCreateRequest,
  validateRemotionPreviewReleaseRequest,
  validateRemotionShotPreviewCreateRequest,
} from "@rendering/plugins/remotion/preview/remotion-preview-ipc";
import { RemotionPreviewService } from "@rendering/plugins/remotion/preview/remotion-preview-service";

interface RemotionPreviewServiceLike {
  create: RemotionPreviewService["create"];
  createShot?: RemotionPreviewService["createShot"];
  release: RemotionPreviewService["release"];
  dispose: RemotionPreviewService["dispose"];
}

export interface RegisterRemotionPreviewIpcOptions {
  resolveSourcePath: (sourcePath: string) => string;
  service?: RemotionPreviewServiceLike;
}

export function registerRemotionPreviewIpcHandlers(
  options: RegisterRemotionPreviewIpcOptions,
): { dispose: () => Promise<void> } {
  const service = options.service ?? new RemotionPreviewService({
    resolveSourcePath: options.resolveSourcePath,
  });

  ipcMain.handle(REMOTION_PREVIEW_CREATE_CHANNEL, async (_event, payload: unknown) => {
    const request = assertValid(validateRemotionPreviewCreateRequest(payload));
    return service.create(request.plan);
  });
  ipcMain.handle(REMOTION_PREVIEW_RELEASE_CHANNEL, async (_event, payload: unknown) => {
    const request = assertValid(validateRemotionPreviewReleaseRequest(payload));
    await service.release(request.sessionId);
    return { sessionId: request.sessionId, released: true as const };
  });
  ipcMain.handle(REMOTION_SHOT_PREVIEW_CREATE_CHANNEL, async (_event, payload: unknown) => {
    const request = await assertValidAsync(validateRemotionShotPreviewCreateRequest(payload));
    if (!service.createShot) throw new Error("Remotion shot preview service 未启用");
    return service.createShot(request.shotPlan);
  });

  return {
    async dispose() {
      ipcMain.removeHandler(REMOTION_PREVIEW_CREATE_CHANNEL);
      ipcMain.removeHandler(REMOTION_PREVIEW_RELEASE_CHANNEL);
      ipcMain.removeHandler(REMOTION_SHOT_PREVIEW_CREATE_CHANNEL);
      await service.dispose();
    },
  };
}

async function assertValidAsync<T>(
  result: Promise<{ success: true; value: T } | { success: false; issues: Array<{ path: string; message: string }> }>,
): Promise<T> {
  const resolved = await result;
  return assertValid(resolved);
}

function assertValid<T>(
  result: { success: true; value: T } | { success: false; issues: Array<{ path: string; message: string }> },
): T {
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return result.value;
}
