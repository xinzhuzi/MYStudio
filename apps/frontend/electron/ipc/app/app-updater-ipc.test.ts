import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { registerAppUpdaterIpcHandlers } from "./app-updater-ipc";

describe("registerAppUpdaterIpcHandlers", () => {
  const getVersion = vi.fn(() => "1.2.3");
  const resolveAvailableUpdate = vi.fn();
  const sanitizeExternalUrl = vi.fn((url: string) => url.startsWith("https://") ? url : null);
  const openExternal = vi.fn(async () => undefined);

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerAppUpdaterIpcHandlers({
      getVersion,
      resolveAvailableUpdate,
      sanitizeExternalUrl,
      openExternal,
    });
  });

  it("registers the updater channels and reports an available update", async () => {
    resolveAvailableUpdate.mockResolvedValueOnce({ version: "1.3.0" });

    await expect(handlers.get("app-updater-get-current-version")?.()).resolves.toBe("1.2.3");
    await expect(handlers.get("app-updater-check")?.({}, undefined)).resolves.toEqual({
      success: true,
      currentVersion: "1.2.3",
      hasUpdate: true,
      update: { version: "1.3.0" },
    });
  });

  it("keeps silent update failures quiet while returning the original error contract", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveAvailableUpdate.mockRejectedValueOnce(new Error("offline"));

    await expect(handlers.get("app-updater-check")?.({}, { silent: true })).resolves.toEqual({
      success: false,
      currentVersion: "1.2.3",
      error: "offline",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rejects unsafe download links and opens sanitized links", async () => {
    await expect(handlers.get("app-updater-open-link")?.({}, "file:///tmp/update")).resolves.toEqual({
      success: false,
      error: "无效下载链接",
    });

    await expect(handlers.get("app-updater-open-link")?.({}, "https://example.com/update")).resolves.toEqual({
      success: true,
    });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/update");
  });
});
