// Copyright (c) 2025 hotflow2024
/** VLM Review IPC — 注册全部 channel(沿 upscale-ipc.ts 完整模式). */

import { ipcMain } from "electron";
import type { VlmReviewRunPayload } from "../../../types/contracts/vlm-review-workflow";
import type { VlmReviewRuntimeController } from "../../rendering/plugins/vlm_review/vlm-review-runtime-controller";

export function registerVlmReviewIpc(controller: VlmReviewRuntimeController): void {
  ipcMain.handle("vlm-review-runtime-probe", async () => controller.probeReadiness());

  ipcMain.handle("vlm-review-run", async (_event, payload: unknown) => {
    const validated = validateVlmReviewRunPayload(payload);
    if (!validated.success) {
      return { schemaVersion: 1, projectId: "", shotId: "", status: "blocked",
        model: "", checks: {}, reasons: [], inferenceMs: 0, inputSha256: "",
        code: "invalid-request", message: validated.error, generatedAt: Date.now() };
    }
    return controller.runReview(validated.value);
  });

  // 模型下载(显式触发):spawn Python download_model + 进度文件
  ipcMain.handle("vlm-review-model-download", async () => {
    return controller.downloadModel();
  });

  // 下载进度(读进度文件)
  ipcMain.handle("vlm-review-model-progress", async () => {
    return controller.readDownloadProgress();
  });

  // 删除模型
  ipcMain.handle("vlm-review-model-delete", async () => {
    return controller.deleteModel();
  });

  // 准备运行时(pip install 等,预留)
  ipcMain.handle("vlm-review-runtime-setup", async () => {
    return { success: true };
  });
}

function validateVlmReviewRunPayload(
  payload: unknown,
): { success: true; value: VlmReviewRunPayload } | { success: false; error: string } {
  if (!payload || typeof payload !== "object") return { success: false, error: "payload 必须是对象" };
  const p = payload as Partial<VlmReviewRunPayload>;
  if (typeof p.generatedImagePath !== "string" || !p.generatedImagePath) {
    return { success: false, error: "generatedImagePath 必须提供" };
  }
  if (!Array.isArray(p.referenceImages)) {
    return { success: false, error: "referenceImages 必须是数组" };
  }
  return { success: true, value: payload as VlmReviewRunPayload };
}
