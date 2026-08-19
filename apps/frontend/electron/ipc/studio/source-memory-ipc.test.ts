// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  service: {
    build: vi.fn(async () => ({ success: true, buildId: "a".repeat(12) })),
    search: vi.fn(() => ({ success: true, hits: [] })),
    status: vi.fn(() => ({ success: true, status: "idle" })),
    stageRecords: vi.fn(async () => ({ success: true, accepted: 0, rejected: 0 })),
    commitBuild: vi.fn(async () => ({ success: true, status: "ready" })),
    rebuildIndex: vi.fn(async () => ({ success: true, indexHealth: "healthy" })),
  },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn((channel: string, handler: Handler) => state.handlers.set(channel, handler)) },
}));
vi.mock("../../storage/source-memory-service", () => ({
  createSourceMemoryService: vi.fn(() => state.service),
}));
vi.mock("../../storage/storage-paths", () => ({
  resolveProjectRootPath: vi.fn((_dataRoot: string, projectId: string) => `/projects/${projectId}`),
}));

import { registerSourceMemoryIpcHandlers } from "./source-memory-ipc";

beforeEach(() => {
  state.handlers.clear();
  for (const method of Object.values(state.service)) method.mockClear();
  registerSourceMemoryIpcHandlers({ getDataDir: () => "/data" });
});

describe("source-memory IPC boundary", () => {
  it("从 unknown 拒绝非法 project/query/limit 且不调用 service", async () => {
    const build = state.handlers.get("source-memory-build")!;
    const search = state.handlers.get("source-memory-search")!;
    await expect(build({}, "../escape")).resolves.toMatchObject({ success: false, code: "invalid-input" });
    await expect(search({}, "p1", 123, 6)).resolves.toMatchObject({ success: false, code: "invalid-input" });
    await expect(search({}, "p1", "x", 0)).resolves.toMatchObject({ success: false, code: "invalid-input" });
    await expect(search({}, "p1", "x".repeat(201), 6)).resolves.toMatchObject({ success: false, code: "invalid-input" });
    expect(state.service.build).not.toHaveBeenCalled();
    expect(state.service.search).not.toHaveBeenCalled();
  });

  it("拒绝越量/非法 staged records 与 coverage", async () => {
    const stage = state.handlers.get("source-memory-stage-records")!;
    const commit = state.handlers.get("source-memory-commit-build")!;
    const record = {
      kind: "character",
      title: "晏燎",
      body: "剑主",
      sourcePath: "novel/chapters/chapter-001.md",
      sourceSha256: "a".repeat(64),
      chapterId: "chapter-001",
      anchor: "chunk-1:第一章",
    };
    await expect(stage({}, "p1", "a".repeat(12), Array.from({ length: 201 }, () => record))).resolves.toMatchObject({
      success: false,
      code: "invalid-input",
    });
    await expect(stage({}, "p1", "a".repeat(12), [{ ...record, confidence: 2 }])).resolves.toMatchObject({
      success: false,
      code: "invalid-input",
    });
    await expect(commit({}, "p1", {
      buildId: "a".repeat(12),
      coverage: Array.from({ length: 1001 }, () => ({ sourcePath: record.sourcePath, anchor: record.anchor, ok: true })),
    })).resolves.toMatchObject({ success: false, code: "invalid-input" });
    expect(state.service.stageRecords).not.toHaveBeenCalled();
    expect(state.service.commitBuild).not.toHaveBeenCalled();
  });

  it("合法 payload 单次转发且 service throw 归一为 failure reply", async () => {
    const search = state.handlers.get("source-memory-search")!;
    await expect(search({}, "project-1", "晏燎", 4)).resolves.toMatchObject({ success: true, hits: [] });
    expect(state.service.search).toHaveBeenCalledWith("project-1", "晏燎", 4);

    state.service.rebuildIndex.mockRejectedValueOnce(new Error("broken"));
    const rebuild = state.handlers.get("source-memory-rebuild-index")!;
    await expect(rebuild({}, "project-1")).resolves.toMatchObject({ success: false, error: "broken" });
  });
});
