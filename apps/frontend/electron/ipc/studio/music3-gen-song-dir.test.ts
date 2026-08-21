// 单曲文件夹(08-21 用户裁定:每首歌一个自己的文件夹,代码体现)——
// IPC 层 resolve/mkdir/sanitize 与 controller 命名的回归锁。
// 独立文件:不动 music3-gen-ipc.test.ts(并行会话工作区占用中)。
// @vitest-environment node

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { registerMusic3GenIpcHandlers, sanitizeSongName } from "./music3-gen-ipc";
import { buildWavName } from "@rendering/plugins/music3_gen/music3-gen-runtime-controller";

let musicRoot: string;

function register() {
  return registerMusic3GenIpcHandlers({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controller: state.controller as any,
    getExportDir: () => path.join(musicRoot, "exports"),
    getProjectMusicDir: () => musicRoot,
    isSourcePathAllowed: () => true,
  });
}

function call(channel: string, payload?: unknown) {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`no handler: ${channel}`);
  return handler({}, payload);
}

function lastGenerateArg(): { outputDir: string; songName?: string } {
  const callArgs = state.controller.generateMusic3.mock.calls.at(-1) as unknown as unknown[];
  return callArgs[0] as { outputDir: string; songName?: string };
}

beforeEach(async () => {
  state.handlers.clear();
  vi.clearAllMocks();
  musicRoot = await fs.mkdtemp(path.join(os.tmpdir(), "song-dir-"));
  register();
});

afterEach(async () => {
  await fs.rm(musicRoot, { recursive: true, force: true });
});

describe("sanitizeSongName", () => {
  it("去路径分隔符/非法字符/控制符,折叠空白,限长 60", () => {
    expect(sanitizeSongName("道劫-ED/山河无恙")).toBe("道劫-ED 山河无恙");
    expect(sanitizeSongName("a\\b:c*d?e\"f<g>h|i")).toBe("a b c d e f g h i");
    expect(sanitizeSongName("  多   空白\n\t压缩  ")).toBe("多 空白 压缩");
    expect(sanitizeSongName("x".repeat(80))).toHaveLength(60);
  });

  it("压掉「..」防目录穿越", () => {
    expect(sanitizeSongName("../../etc")).not.toContain("..");
    const resolved = path.resolve(musicRoot, sanitizeSongName("../../etc")!);
    expect(resolved.startsWith(musicRoot)).toBe(true);
  });

  it("非字符串/净化后为空 → undefined(回落旧行为)", () => {
    expect(sanitizeSongName(undefined)).toBeUndefined();
    expect(sanitizeSongName(42)).toBeUndefined();
    expect(sanitizeSongName("   ")).toBeUndefined();
    expect(sanitizeSongName("///")).toBeUndefined();
  });
});

describe("buildWavName", () => {
  it("带 songName 用曲名前缀+seed;无 songName 维持 bgm3 旧命名", () => {
    expect(buildWavName("bgm3-mlxserv", 5, "道劫-ED-山河无恙")).toMatch(/^道劫-ED-山河无恙-seed5-\d+\.wav$/);
    expect(buildWavName("bgm3", 7)).toMatch(/^bgm3-\d+-7\.wav$/);
  });
});

describe("music3-gen-music-dir 单曲文件夹", () => {
  it("带 songName 返回 <music>/<曲名>/ 并建目录", async () => {
    const reply = (await call("music3-gen-music-dir", { projectId: "p1", songName: "道劫-OP-劫火燃天" })) as { dir: string };
    expect(reply.dir).toBe(path.join(musicRoot, "道劫-OP-劫火燃天"));
    const stat = await fs.stat(reply.dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("无 songName 返回 music 根(旧行为,不建目录)", async () => {
    const reply = (await call("music3-gen-music-dir", { projectId: "p1" })) as { dir: string };
    expect(reply.dir).toBe(musicRoot);
  });
});

describe("music3-gen-runtime-generate 单曲文件夹", () => {
  it("__PROJECT_MUSIC__ + songName → outputDir 落曲名子目录并透传 songName", async () => {
    await call("music3-gen-runtime-generate", {
      prompt: "caption", seed: 5, outputDir: "__PROJECT_MUSIC__", projectId: "p1", songName: "道劫-ED-山河无恙",
    });
    const arg = lastGenerateArg();
    expect(arg.outputDir).toBe(path.join(musicRoot, "道劫-ED-山河无恙"));
    expect(arg.songName).toBe("道劫-ED-山河无恙");
    expect((await fs.stat(arg.outputDir)).isDirectory()).toBe(true);
  });

  it("恶意 songName(路径穿越)被净化,目录仍钉在音乐根内", async () => {
    await call("music3-gen-runtime-generate", {
      prompt: "caption", outputDir: "__PROJECT_MUSIC__", projectId: "p1", songName: "../../etc/passwd",
    });
    const arg = lastGenerateArg();
    expect(arg.outputDir.startsWith(musicRoot)).toBe(true);
    expect(arg.outputDir).not.toContain("..");
  });

  it("无 songName → 平铺 music 根、不透传字段(存量行为回归)", async () => {
    await call("music3-gen-runtime-generate", { prompt: "caption", outputDir: "__PROJECT_MUSIC__", projectId: "p1" });
    const arg = lastGenerateArg();
    expect(arg.outputDir).toBe(musicRoot);
    expect(arg.songName).toBeUndefined();
  });
});
