// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDevelopmentSettings } from "./useDevelopmentSettings";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "diagnosticsLog", { configurable: true, value: undefined });
});

describe("useDevelopmentSettings", () => {
  it("loads diagnostics information when the desktop bridge is present", async () => {
    const diagnosticsLog = {
      getInfo: vi.fn().mockResolvedValue({ directory: "/logs", fileCount: 2, totalBytes: 2048 }),
    };
    Object.defineProperty(window, "diagnosticsLog", { configurable: true, value: diagnosticsLog });

    const { result } = renderHook(() => useDevelopmentSettings());

    await waitFor(() => expect(result.current.diagnosticsInfo?.fileCount).toBe(2));
    expect(result.current.hasDiagnostics).toBe(true);
    expect(diagnosticsLog.getInfo).toHaveBeenCalledOnce();
  });

  it("stays available without desktop diagnostics bridges", () => {
    const { result } = renderHook(() => useDevelopmentSettings());
    expect(result.current.hasDiagnostics).toBe(false);
    expect(result.current.hasDevTools).toBe(false);
  });
});
