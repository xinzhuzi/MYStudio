// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  controller: {
    status: vi.fn(() => ({})),
    setup: vi.fn(async () => ({})),
    scanModelInventory: vi.fn(async () => []),
    downloadModel: vi.fn(async () => ({ accepted: true })),
    installMlxServeBinary: vi.fn(async () => ({ installed: true })),
    installMlxServWeights: vi.fn(async () => ({ accepted: true })),
    configureMlxServ: vi.fn(() => ({})),
    stopServer: vi.fn(),
    generateMusic3: vi.fn(async () => ({ status: "accepted", outputPath: "/x.wav" })),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn(),
  },
}));

import { registerMusic3GenIpcHandlers } from "./music3-gen-ipc";

const EXPORT_DIR = "/app/exports";
const PROJECT_MUSIC_DIR = "/projects/ma/music";

function register() {
  return registerMusic3GenIpcHandlers({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller: state.controller as any,
    getExportDir: () => EXPORT_DIR,
    getProjectMusicDir: (projectId: string) => `/projects/${projectId}/music`,
  });
}

function call(channel: string, payload?: unknown) {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`no handler: ${channel}`);
  return handler({}, payload);
}

beforeEach(() => {
  state.handlers.clear();
  vi.clearAllMocks();
  register();
});

describe("music3-gen IPC · 项目音乐目录哨兵(08-19 工作台音乐生成)", () => {
  it("__PROJECT_MUSIC__ + projectId → 控制器收到 <项目根>/music 绝对路径", async () => {
    const result = await call("music3-gen-runtime-generate", {
      prompt: "仙侠交响",
      seed: 7,
      seconds: 30,
      engine: "mlxserv",
      outputDir: "__PROJECT_MUSIC__",
      projectId: "ma",
    });
    expect(result).toMatchObject({ status: "accepted" });
    expect(state.controller.generateMusic3).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: "/projects/ma/music", prompt: "仙侠交响", engine: "mlxserv" }),
    );
  });

  it("__PROJECT_MUSIC__ 缺 projectId → blocked invalid-request,不触控制器", async () => {
    const result = await call("music3-gen-runtime-generate", {
      prompt: "测试",
      outputDir: "__PROJECT_MUSIC__",
    });
    expect(result).toMatchObject({ status: "blocked", code: "invalid-request" });
    expect(state.controller.generateMusic3).not.toHaveBeenCalled();
  });

  it("__APP_EXPORTS__ 哨兵行为不回归(仍解析导出目录)", async () => {
    await call("music3-gen-runtime-generate", { prompt: "测试", outputDir: "__APP_EXPORTS__" });
    expect(state.controller.generateMusic3).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: EXPORT_DIR }),
    );
  });

  it("music3-gen-music-dir:有效 projectId 返回动态拼接目录;缺失报错", async () => {
    await expect(call("music3-gen-music-dir", { projectId: "ma" })).resolves.toEqual({ dir: PROJECT_MUSIC_DIR });
    await expect(call("music3-gen-music-dir", {})).resolves.toEqual({ error: "projectId 必填" });
  });
});
