// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      probe.handlers.set(channel, handler);
    },
  },
}));
vi.mock("node:fs", () => ({
  default: { existsSync: probe.existsSync, readFileSync: probe.readFileSync },
}));

import { registerFileStorageIpcHandlers } from "@/electron/ipc/files/file-storage-ipc";
import { normalizeStoredJson } from "@/electron/storage/pretty-json";

describe("audit: read boundary and migration confirmation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    probe.handlers.clear();
    probe.existsSync.mockReset();
    probe.readFileSync.mockReset();
    registerFileStorageIpcHandlers({ getDataDir: () => "/isolated-audit-data" });
  });

  it("currently reports both a missing file and a failed read as null", async () => {
    const get = probe.handlers.get("file-storage-get")!;
    probe.existsSync.mockReturnValue(false);
    const missing = await get({}, "audit-read");
    expect(probe.readFileSync).not.toHaveBeenCalled();

    probe.existsSync.mockReturnValue(true);
    probe.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("isolated permission failure"), { code: "EACCES" });
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unreadable = await get({}, "audit-read");

    expect(missing).toBeNull();
    expect(unreadable).toBeNull();
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("normalization changes bytes while preserving the persisted JSON value", () => {
    const source = '{"state":{"items":[{"id":"retained"}]},"version":1}';
    const stored = normalizeStoredJson(source);
    expect(stored).not.toBe(source);
    expect(JSON.parse(stored)).toEqual(JSON.parse(source));
  });
});
