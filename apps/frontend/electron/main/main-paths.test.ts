import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1015 补刀:resolveReferenceAudioSourcePath 的 asset-file:// 分支行为锁。
 * 背景:08-24 路径裁定后 tts profile.referenceAudioPath 持久化虚拟
 * asset-file://(role-audio-auto-assign.ts:29-31);分镜固定音色链经
 * tts-reference-audio-resolve → 本函数解析,缺 asset-file:// 分支时虚拟 URL
 * 原样漏回 → tts-ipc isAbsolute=false → null → 「固定音色文件不可读」假错,
 * 文件明明健康。本锁:虚拟引用按当前资产根(状态机)解析成受管绝对路径。
 */

// electron mock 工厂在 main-paths(消费方)import 求值前执行:临时 userData
// 须在此建好——main-paths 模块作用域按值捕获 app.getPath 结果,晚了就固化空串。
const electronMockState = vi.hoisted(() => ({ userDataPath: "" }));
vi.mock("electron", async () => {
  const fsModule = await import("node:fs");
  const osModule = await import("node:os");
  const pathModule = await import("node:path");
  electronMockState.userDataPath = fsModule.mkdtempSync(
    pathModule.join(osModule.tmpdir(), "mystudio-main-paths-"),
  );
  return {
    app: { getPath: () => electronMockState.userDataPath },
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: { handle: vi.fn() },
  };
});

// main-paths 模块装配依赖 electron mock 就位后才能 import(vi.mock 提升保证序)。
import { resolveReferenceAudioSourcePath } from "./main-paths";

// 1016 资产二段归位:fallback 形态改 join(base,'store','assets')(M-A 等价改述)。
const fallbackAssetsFiles = path.join(electronMockState.userDataPath, "store", "assets", "files");

describe("resolveReferenceAudioSourcePath asset-file:// 分支(1015 链A消费端闭环)", () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(fallbackAssetsFiles, "audio"), { recursive: true });
    fs.writeFileSync(path.join(fallbackAssetsFiles, "audio", "r1.wav"), "riff");
  });

  beforeEach(() => {
    // 隔离:不残留 project-locations.json(用例自建自清);不残留 flat 旧库
    const table = path.join(electronMockState.userDataPath, "project-locations.json");
    if (fs.existsSync(table)) fs.rmSync(table);
    const flatRoot = path.join(electronMockState.userDataPath, "assets");
    if (fs.existsSync(flatRoot)) fs.rmSync(flatRoot, { recursive: true, force: true });
  });

  it("asset-file://audio/… → 按当前资产根解析成受管绝对路径(不再原样漏虚拟 URL)", () => {
    const resolved = resolveReferenceAudioSourcePath("asset-file://audio/r1.wav");
    expect(resolved).toBe(path.join(fallbackAssetsFiles, "audio", "r1.wav"));
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it("1016 补刀·flat 回退接线:旧统一存储 flat 形库在场(未绑项目)→asset-file:// 按 flat 根解析(注入链生效,非仅单元层)", () => {
    // base(getStorageBasePath 默认=userData)下造 flat 形旧库(仅 db 触发探针;音频文件
    // 落 flat files——getAssetsRoot 回退 flat 后由消费式拼合)
    const flatFiles = path.join(electronMockState.userDataPath, "assets", "files");
    fs.mkdirSync(path.join(flatFiles, "audio"), { recursive: true });
    fs.writeFileSync(path.join(electronMockState.userDataPath, "assets", "assets.db"), "db");
    fs.writeFileSync(path.join(flatFiles, "audio", "flat.wav"), "riff");

    const resolved = resolveReferenceAudioSourcePath("asset-file://audio/flat.wav");
    expect(resolved).toBe(path.join(flatFiles, "audio", "flat.wav"));
    expect(fs.existsSync(resolved)).toBe(true);
    // 同会话新根 store/assets 形引用不串扰(fallback 形件仍在,只走 flat)
    expect(fs.existsSync(path.join(fallbackAssetsFiles, "audio", "r1.wav"))).toBe(true);
  });

  it("其余输入形态逐字节不变(绝对路径/未知 scheme 原样返回)", () => {
    expect(resolveReferenceAudioSourcePath("/abs/keep.wav")).toBe("/abs/keep.wav");
    expect(resolveReferenceAudioSourcePath("weird://x")).toBe("weird://x");
  });

  it("断链(asset-file:// 指向缺席文件) → 仍返回解析后绝对路径,缺席判定留给 tts-ipc 的 stat 闸(职责不变)", () => {
    const resolved = resolveReferenceAudioSourcePath("asset-file://audio/gone.wav");
    expect(resolved).toBe(path.join(fallbackAssetsFiles, "audio", "gone.wav"));
    expect(fs.existsSync(resolved)).toBe(false);
  });
});
