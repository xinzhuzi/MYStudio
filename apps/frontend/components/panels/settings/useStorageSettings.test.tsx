// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStorageSettings } from "./useStorageSettings";

const cacheUtils = vi.hoisted(() => ({ clearPersistedRendererCaches: vi.fn() }));

vi.mock("./storage-cache-utils", () => cacheUtils);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  Object.defineProperty(window, "storageManager", { configurable: true, value: undefined });
  Object.defineProperty(window, "appUpdater", { configurable: true, value: undefined });
});

describe("useStorageSettings", () => {
  it("delegates export to the selected desktop directory", async () => {
    const storageManager = {
      getPaths: vi.fn().mockResolvedValue({ basePath: "/data" }),
      getCacheSize: vi.fn().mockResolvedValue({ total: 1024 }),
      updateConfig: vi.fn().mockResolvedValue({ success: true }),
      selectDirectory: vi.fn().mockResolvedValue("/backup"),
      exportData: vi.fn().mockResolvedValue({ success: true }),
    };
    Object.defineProperty(window, "storageManager", { configurable: true, value: storageManager });

    const { result } = renderHook(() => useStorageSettings());
    await waitFor(() => expect(storageManager.getCacheSize).toHaveBeenCalled());
    await act(async () => result.current.exportData());

    expect(storageManager.exportData).toHaveBeenCalledWith("/backup");
  });

  it("clears persisted renderer caches after a confirmed import", async () => {
    vi.useFakeTimers();
    const storageManager = {
      getPaths: vi.fn().mockResolvedValue({ basePath: "/data" }),
      getCacheSize: vi.fn().mockResolvedValue({ total: 0 }),
      updateConfig: vi.fn().mockResolvedValue({ success: true }),
      selectDirectory: vi.fn().mockResolvedValue("/backup"),
      importData: vi.fn().mockResolvedValue({ success: true }),
    };
    Object.defineProperty(window, "storageManager", { configurable: true, value: storageManager });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useStorageSettings());
    await act(async () => result.current.importData());

    expect(storageManager.importData).toHaveBeenCalledWith("/backup");
    expect(cacheUtils.clearPersistedRendererCaches).toHaveBeenCalledOnce();
  });
});
