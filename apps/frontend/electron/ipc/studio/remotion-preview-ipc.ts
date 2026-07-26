import { ipcMain } from "electron";
import {
  REMOTION_PREVIEW_CREATE_CHANNEL,
  REMOTION_PREVIEW_RELEASE_CHANNEL,
  validateRemotionPreviewCreateRequest,
  validateRemotionPreviewReleaseRequest,
} from "@rendering/plugins/remotion/preview/remotion-preview-ipc";
import { RemotionPreviewService } from "@rendering/plugins/remotion/preview/remotion-preview-service";

interface RemotionPreviewServiceLike {
  create: RemotionPreviewService["create"];
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

  return {
    async dispose() {
      ipcMain.removeHandler(REMOTION_PREVIEW_CREATE_CHANNEL);
      ipcMain.removeHandler(REMOTION_PREVIEW_RELEASE_CHANNEL);
      await service.dispose();
    },
  };
}

function assertValid<T>(
  result: { success: true; value: T } | { success: false; issues: Array<{ path: string; message: string }> },
): T {
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return result.value;
}
