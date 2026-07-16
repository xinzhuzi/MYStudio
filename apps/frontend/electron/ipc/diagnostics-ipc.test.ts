import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsLogService } from "../diagnostics-log";

const mocks = vi.hoisted(() => ({
  clear: vi.fn(async () => ({ success: true, removedFiles: 1 })),
  exportBundle: vi.fn(async () => ({ success: true, filePath: "/logs/diagnostics.zip" })),
  getDirectory: vi.fn(() => "/logs"),
  getInfo: vi.fn(async () => ({ directory: "/logs", totalBytes: 0, fileCount: 0, recentWarnCount: 0, recentErrorCount: 0, retentionDays: 30, files: [] })),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(async () => ""),
  query: vi.fn(async () => ({ entries: [], total: 0 })),
  write: vi.fn(async (entry: unknown) => entry),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

import { registerDiagnosticsIpcHandlers } from "./diagnostics-ipc";

function registerHandlers() {
  registerDiagnosticsIpcHandlers({
    service: {
      clear: mocks.clear,
      exportBundle: mocks.exportBundle,
      getDirectory: mocks.getDirectory,
      getInfo: mocks.getInfo,
      query: mocks.query,
      write: mocks.write,
    } as unknown as DiagnosticsLogService,
    openPath: mocks.openPath,
  });
}

describe("registerDiagnosticsIpcHandlers", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.openPath.mockResolvedValue("");
    registerHandlers();
  });

  it("registers the diagnostics bridge channels exactly once", () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      "diagnostics-log-clear",
      "diagnostics-log-export-bundle",
      "diagnostics-log-get-info",
      "diagnostics-log-open-folder",
      "diagnostics-log-query",
      "diagnostics-log-write",
    ]);
  });

  it("delegates log actions and preserves open-folder success and error results", async () => {
    const entry = { category: "ipc" as const, message: "registered" };
    const query = { level: "error" as const };

    await expect(mocks.handlers.get("diagnostics-log-write")?.({}, entry)).resolves.toEqual(entry);
    await expect(mocks.handlers.get("diagnostics-log-query")?.({}, query)).resolves.toEqual({ entries: [], total: 0 });
    await expect(mocks.handlers.get("diagnostics-log-open-folder")?.({})).resolves.toEqual({ success: true, directory: "/logs" });
    expect(mocks.write).toHaveBeenCalledWith(entry);
    expect(mocks.query).toHaveBeenCalledWith(query);
    expect(mocks.openPath).toHaveBeenCalledWith("/logs");

    mocks.openPath.mockResolvedValueOnce("permission denied");
    await expect(mocks.handlers.get("diagnostics-log-open-folder")?.({})).resolves.toEqual({
      success: false,
      directory: "/logs",
      error: "permission denied",
    });
  });
});
