// MiniMax-Music3 runtime IPC — literal channels (contract test).

import { ipcMain } from "electron";

import type {
  Music3GenRuntimeController,
  Music3GenRuntimeStatus,
} from "@rendering/plugins/music3_gen/music3-gen-runtime-controller";

export interface RegisterMusic3GenIpcOptions {
  controller: Music3GenRuntimeController;
  /** Export directory for generated BGM files. */
  getExportDir: () => string;
  /**
   * 项目音乐目录解析(<项目根>/music/,经项目位置注册表动态拼接;08-19 工作台音乐生成)。
   * 渲染层传 "__PROJECT_MUSIC__" 哨兵 + projectId,由主进程在此解析为绝对路径——
   * 渲染层永远不持有绝对项目路径。
   */
  getProjectMusicDir: (projectId: string) => string;
}

export interface Music3GenIpc {
  dispose: () => void;
}

export function registerMusic3GenIpcHandlers(options: RegisterMusic3GenIpcOptions): Music3GenIpc {
  const { controller } = options;

  ipcMain.handle("music3-gen-runtime-status", (): Music3GenRuntimeStatus => controller.status());
  ipcMain.handle("music3-gen-runtime-setup", async (): Promise<Music3GenRuntimeStatus> => controller.setup());
  ipcMain.handle("music3-gen-runtime-scan-model", async () => {
    const models = await controller.scanModelInventory();
    return { models };
  });
  ipcMain.handle("music3-gen-runtime-download-model", async (_event, payload: unknown) => {
    const input = payload as { model?: unknown } | null;
    const model = typeof input?.model === "string" && input.model.trim() ? input.model.trim() : "minimax-music3-mlx";
    return controller.downloadModel(model);
  });
  ipcMain.handle("music3-gen-install-mlxserve", async () => {
    return controller.installMlxServeBinary();
  });
  ipcMain.handle("music3-gen-install-weights", async () => {
    return controller.installMlxServWeights();
  });
  ipcMain.handle("music3-gen-music-dir", async (_event, payload: unknown) => {
    const input = payload as { projectId?: unknown } | null;
    const projectId = typeof input?.projectId === "string" ? input.projectId.trim() : "";
    if (!projectId) {
      return { error: "projectId 必填" };
    }
    return { dir: options.getProjectMusicDir(projectId) };
  });
  ipcMain.handle("music3-gen-runtime-configure", async (_event, payload: unknown) => {
    const input = payload as Partial<{ weightsDir: unknown; binaryPath: unknown; port: unknown; preferredEngine: unknown }> | null;
    return controller.configureMlxServ({
      ...(typeof input?.weightsDir === "string" ? { weightsDir: input.weightsDir } : {}),
      ...(typeof input?.binaryPath === "string" ? { binaryPath: input.binaryPath } : {}),
      ...(typeof input?.port === "number" ? { port: input.port } : {}),
      ...(input?.preferredEngine === "mlxserv" || input?.preferredEngine === "pocket"
        ? { preferredEngine: input.preferredEngine }
        : {}),
    });
  });
  ipcMain.handle("music3-gen-runtime-generate", async (_event, payload: unknown) => {
    const input = payload as { prompt?: unknown; seed?: unknown; seconds?: unknown; steps?: unknown; outputDir?: unknown; engine?: unknown; projectId?: unknown } | null;
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
      return { status: "blocked" as const, code: "invalid-request", message: "prompt 必填" };
    }
    // The renderer may pass the sentinels "__APP_EXPORTS__"(应用导出目录)or
    // "__PROJECT_MUSIC__"(<项目根>/music/,需 projectId);the main process
    // resolves them so no absolute paths cross the bridge.
    const requestedDir = typeof input.outputDir === "string" ? input.outputDir : "";
    let outputDir: string;
    if (requestedDir === "__PROJECT_MUSIC__") {
      const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
      if (!projectId) {
        return { status: "blocked" as const, code: "invalid-request", message: "项目音乐目录需要有效的 projectId" };
      }
      outputDir = options.getProjectMusicDir(projectId);
    } else if (requestedDir === "__APP_EXPORTS__" || !requestedDir.startsWith("/")) {
      outputDir = options.getExportDir();
    } else {
      outputDir = requestedDir;
    }
    return controller.generateMusic3({
      prompt: input.prompt,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
      ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
      ...(typeof input.steps === "number" ? { steps: input.steps } : {}),
      ...(input.engine === "mlxserv" || input.engine === "pocket" ? { engine: input.engine } : {}),
      outputDir,
    });
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("music3-gen-runtime-status");
      ipcMain.removeHandler("music3-gen-runtime-setup");
      ipcMain.removeHandler("music3-gen-runtime-scan-model");
      ipcMain.removeHandler("music3-gen-runtime-download-model");
      ipcMain.removeHandler("music3-gen-runtime-configure");
    ipcMain.removeHandler("music3-gen-install-mlxserve");
    ipcMain.removeHandler("music3-gen-install-weights");
    ipcMain.removeHandler("music3-gen-music-dir");
      ipcMain.removeHandler("music3-gen-runtime-generate");
    },
  };
}
