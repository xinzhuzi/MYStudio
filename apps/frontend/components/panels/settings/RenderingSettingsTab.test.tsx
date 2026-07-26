// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { RenderingSettingsTab } from "./RenderingSettingsTab";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "remotionRuntime");
  vi.restoreAllMocks();
});

describe("RenderingSettingsTab", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ renderingSettings: { renderer: "ffmpeg" } });
    Object.defineProperty(window, "remotionRuntime", {
      value: {
        status: vi.fn(async () => ({ state: "not-installed", remotionVersion: "4.0.499" })),
        download: vi.fn(async () => ({ state: "ready", remotionVersion: "4.0.499", preparedForRemotionVersion: "4.0.499" })),
        onDownloadProgress: vi.fn(() => () => undefined),
      },
      configurable: true,
    });
  });

  it("persists the global renderer choice", async () => {
    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByText("尚未安装")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: /Remotion/ }));
    expect(useAppSettingsStore.getState().renderingSettings.renderer).toBe("remotion");
  });

  it("exposes an explicit manual download action", async () => {
    const download = window.remotionRuntime?.download;
    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByText("尚未安装")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下载 Headless Shell" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
  });
});
