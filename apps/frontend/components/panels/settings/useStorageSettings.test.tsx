// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStorageSettings } from "./useStorageSettings";

const cacheUtils = vi.hoisted(() => ({ clearPersistedRendererCaches: vi.fn() }));
const bridgeMocks = vi.hoisted(() => ({ getStorageManagerBridge: vi.fn() }));
const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("./storage-cache-utils", () => cacheUtils);
vi.mock("@/lib/bridge/storage-manager", () => bridgeMocks);
vi.mock("sonner", () => ({ toast: toastMocks }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  bridgeMocks.getStorageManagerBridge.mockReset();
  vi.useRealTimers();
  Object.defineProperty(window, "storageManager", { configurable: true, value: undefined });
  Object.defineProperty(window, "appUpdater", { configurable: true, value: undefined });
});

describe("useStorageSettings", () => {
  it("delegates export to the selected desktop directory", async () => {
    const storageManager = {
      getPaths: vi.fn().mockResolvedValue({ basePath: "/data" }),
      getCacheSize: vi.fn().mockResolvedValue({ total: 1024 }),
      updateConfig: vi.fn().mockResolvedValue(true),
      selectDirectory: vi.fn().mockResolvedValue("/backup"),
      exportData: vi.fn().mockResolvedValue({ success: true }),
    };
    bridgeMocks.getStorageManagerBridge.mockReturnValue(storageManager);

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
      updateConfig: vi.fn().mockResolvedValue(true),
      selectDirectory: vi.fn().mockResolvedValue("/backup"),
      importData: vi.fn().mockResolvedValue({ success: true }),
    };
    bridgeMocks.getStorageManagerBridge.mockReturnValue(storageManager);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useStorageSettings());
    await act(async () => result.current.importData());

    expect(storageManager.importData).toHaveBeenCalledWith("/backup");
    expect(cacheUtils.clearPersistedRendererCaches).toHaveBeenCalledOnce();
  });

  it("keeps the desktop-only guard when the storage bridge is unavailable", async () => {
    bridgeMocks.getStorageManagerBridge.mockReturnValue(undefined);

    const { result } = renderHook(() => useStorageSettings());
    await act(async () => result.current.selectStoragePath());

    expect(toastMocks.error).toHaveBeenCalledWith("请在桌面应用中使用此功能");
  });
});
