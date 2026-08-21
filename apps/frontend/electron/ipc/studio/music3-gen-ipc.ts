// MiniMax-Music3 runtime IPC — literal channels (contract test).

import { promises as fs } from "node:fs";
import * as nodePath from "node:path";

import { ipcMain } from "electron";

import type {
  Music3GenRuntimeController,
  Music3GenRuntimeStatus,
} from "@rendering/plugins/music3_gen/music3-gen-runtime-controller";

/** AI 参照曲解析可读的音频扩展名(与原生对话框过滤器同源,另加 aiff)。 */
const AUDIO_ANALYSIS_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
/** 解析用音频上限:再大的文件整读进内存再走 IPC 不划算。 */
const AUDIO_ANALYSIS_MAX_BYTES = 300 * 1024 * 1024;

/**
 * 曲名净化(单曲文件夹,08-21):去路径分隔符/文件系统非法字符/控制符,
 * 折叠空白,压掉「..」防穿越,限长 60。净化后为空(或非字符串)返回
 * undefined=回落旧行为(平铺 music/ + bgm3-时间戳名)。
 */
export function sanitizeSongName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/[\p{Cc}\\/:*?"<>|]/gu, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

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
  /** 受管路径守卫(managed-paths:受管根内或对话框祝福路径),防 renderer 把本通道当任意读原语。 */
  isSourcePathAllowed: (filePath: string) => boolean;
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
    const input = payload as { projectId?: unknown; songName?: unknown } | null;
    const projectId = typeof input?.projectId === "string" ? input.projectId.trim() : "";
    if (!projectId) {
      return { error: "projectId 必填" };
    }
    // 单曲文件夹(08-21 用户裁定:每首歌一个自己的文件夹):带 songName 时
    // 返回 <music>/<曲名>/ 并确保目录存在——歌词/caption/wav 全聚同一目录。
    const baseDir = options.getProjectMusicDir(projectId);
    const songName = sanitizeSongName(input?.songName);
    const dir = songName ? nodePath.join(baseDir, songName) : baseDir;
    if (songName) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // 目录建不了(只读卷等)时仍返回路径,写入侧自会报错——不挡查询。
      }
    }
    return { dir };
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
    const input = payload as { prompt?: unknown; lyrics?: unknown; seed?: unknown; seconds?: unknown; steps?: unknown; outputDir?: unknown; engine?: unknown; projectId?: unknown; songName?: unknown } | null;
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
    // 单曲文件夹:带 songName 时在已解析目录下建曲名子目录,wav 也改曲名
    // 前缀(替代 bgm3-时间戳);无 songName 维持旧行为(平铺+bgm3 名)。
    const songName = sanitizeSongName(input.songName);
    if (songName) {
      outputDir = nodePath.join(outputDir, songName);
      try {
        await fs.mkdir(outputDir, { recursive: true });
      } catch {
        return { status: "blocked" as const, code: "invalid-request", message: `无法创建歌曲目录:${songName}` };
      }
    }
    return controller.generateMusic3({
      prompt: input.prompt,
      ...(typeof input.lyrics === "string" && input.lyrics.trim() ? { lyrics: input.lyrics.slice(0, 8000) } : {}),
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
      ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
      ...(typeof input.steps === "number" ? { steps: input.steps } : {}),
      ...(input.engine === "mlxserv" || input.engine === "pocket" ? { engine: input.engine } : {}),
      ...(songName ? { songName } : {}),
      outputDir,
    });
  });

  ipcMain.handle("music3-gen-read-audio-file", async (_event, payload: unknown) => {
    const input = payload as { path?: unknown } | null;
    const filePath = typeof input?.path === "string" ? input.path.trim() : "";
    if (!filePath) {
      return { error: "path 必填" };
    }
    if (!options.isSourcePathAllowed(filePath)) {
      return { error: "路径不在应用管理范围内,请用「浏览」按钮选择文件" };
    }
    const ext = nodePath.extname(filePath).toLowerCase();
    if (!AUDIO_ANALYSIS_EXTENSIONS.has(ext)) {
      return { error: `不支持的音频格式:${ext || "(无扩展名)"}` };
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return { error: "路径不是常规文件" };
      if (stat.size > AUDIO_ANALYSIS_MAX_BYTES) {
        return { error: `文件过大(${Math.round(stat.size / 1048576)} MB,上限 300 MB)` };
      }
      const bytes = new Uint8Array(await fs.readFile(filePath));
      return { bytes, size: stat.size };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
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
      ipcMain.removeHandler("music3-gen-read-audio-file");
    },
  };
}
