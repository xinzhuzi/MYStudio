// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterQcReportV1 } from "@rendering/plugins/videoqc/chapter-qc-types";

type IpcHandler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  removed: [] as string[],
  report: null as ChapterQcReportV1 | null,
  write: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => {
      state.removed.push(channel);
      state.handlers.delete(channel);
    }),
  },
}));

vi.mock("@rendering/plugins/videoqc/chapter-qc-orchestrator", () => ({
  readReport: vi.fn(async () => state.report),
}));

vi.mock("@rendering/plugins/videoqc/chapter-qc-report-store", () => ({
  writeChapterQcReport: state.write,
}));

import { registerChapterQcIpcHandlers } from "./chapter-qc-ipc";

function report(): ChapterQcReportV1 {
  return {
    schemaVersion: 1,
    projectId: "p1",
    chapterId: "c1",
    outputPath: "/tmp/current.mp4",
    outputSha256: "sha-current",
    createdAt: 100,
    layers: {
      structural: { status: "passed" },
      ffmpegScan: { status: "passed" },
      aesthetic: { status: "skipped" },
      semantic: { status: "passed" },
      vision: { status: "passed" },
    },
    findings: [
      { code: "chapter-qc.vision.transition-density", layer: "vision", severity: "warn", message: "密度", evidence: {} },
      { code: "chapter-qc.vision.preflight.old", layer: "vision", severity: "warn", message: "旧", evidence: { source: "vision-preflight" } },
    ],
    summary: { blockers: 0, warns: 2, infos: 0 },
    vision: {
      frameCount: 1,
      frames: [{ shotId: "s1", ordinal: 1, kind: "mid", tS: 1, frameUrl: "project-file://p1/f.jpg" }],
      decisions: [{ shotId: "s1", ordinal: 1, effects: [] }],
      densityChecked: 1,
      frameErrors: 0,
    },
  };
}

beforeEach(() => {
  state.handlers.clear();
  state.removed.length = 0;
  state.report = report();
  state.write.mockReset();
  state.send.mockReset();
});

describe("chapter QC vision preflight IPC", () => {
  it("独立回写预审 finding，保留确定性 vision finding 并拒绝陈旧报告", async () => {
    const registration = registerChapterQcIpcHandlers({
      deps: {
        remotionWorkspaceRootForProject: () => "/tmp/remotion",
        videoUseWorkspaceRootForProject: () => "/tmp/video-use",
        dataRoot: "/tmp/data",
      },
      runQc: vi.fn(),
      getWindow: () => ({ webContents: { send: state.send } }) as never,
    });
    const handler = state.handlers.get("chapter-qc-submit-vision-preflight");
    expect(handler).toBeTypeOf("function");

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      stats: { checked: 1, passed: 0, failed: 0, skipped: 0 },
      findings: [],
    })).resolves.toEqual({ success: false, message: "stats 计数不一致" });

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 99,
      stats: { checked: 1, passed: 0, failed: 1, skipped: 0 },
      findings: [],
    })).resolves.toEqual({ success: false, message: "QC 报告已更新,请重新预审" });
    expect(state.write).not.toHaveBeenCalled();

    await expect(handler!({}, {
      projectId: "p1",
      chapterId: "c1",
      expectedCreatedAt: 100,
      model: "provider/model",
      stats: { checked: 1, passed: 0, failed: 1, skipped: 0 },
      findings: [{
        code: "chapter-qc.vision.preflight.black-or-garbled",
        severity: "blocker",
        shotId: "s1",
        shotOrdinal: 1,
        message: "第 1 镜黑屏",
        evidence: { frameKind: "mid", tS: 1 },
      }],
    })).resolves.toEqual({ success: true });

    expect(state.report?.findings.map((finding) => finding.code)).toEqual([
      "chapter-qc.vision.transition-density",
      "chapter-qc.vision.preflight.black-or-garbled",
    ]);
    expect(state.report?.vision?.preflight).toMatchObject({
      checked: 1,
      failed: 1,
      model: "provider/model",
    });
    expect(state.report?.summary).toEqual({ blockers: 1, warns: 1, infos: 0 });
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.send).toHaveBeenCalledWith("chapter-qc-report-updated", { projectId: "p1", chapterId: "c1" });

    registration.dispose();
    expect(state.removed).toContain("chapter-qc-submit-vision-preflight");
  });
});
