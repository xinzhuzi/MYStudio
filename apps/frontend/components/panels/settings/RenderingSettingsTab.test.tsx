// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import type { RemotionBrowserDownloadProgress, RemotionBrowserStatus } from "@rendering/contracts/remotion-browser-status";
import { RenderingSettingsTab } from "./RenderingSettingsTab";

type RuntimeBridge = NonNullable<Window["remotionRuntime"]>;
type ProgressListener = Parameters<RuntimeBridge["onDownloadProgress"]>[0];

function installRuntime(
  initialStatus: RemotionBrowserStatus,
  download: RuntimeBridge["download"] = vi.fn(async () => ({
    state: "ready",
    remotionVersion: "4.0.499",
    preparedForRemotionVersion: "4.0.499",
  } satisfies RemotionBrowserStatus)),
) {
  const status = vi.fn(async (): Promise<RemotionBrowserStatus> => initialStatus);
  const listeners: ProgressListener[] = [];
  const onDownloadProgress = vi.fn((listener: ProgressListener) => {
    listeners.push(listener);
    return () => undefined;
  });
  const bridge: RuntimeBridge = { status, download, onDownloadProgress };
  Object.defineProperty(window, "remotionRuntime", {
    value: bridge,
    configurable: true,
  });

  return {
    status,
    download,
    emitProgress(progress: RemotionBrowserDownloadProgress) {
      listeners.forEach((listener) => listener(progress));
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "remotionRuntime");
  vi.restoreAllMocks();
});

describe("RenderingSettingsTab", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ renderingSettings: { renderer: "ffmpeg" } });
    installRuntime({ state: "not-installed", remotionVersion: "4.0.499" });
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

  it("keeps a matching ready runtime installed and only revalidates it", async () => {
    const runtime = installRuntime({
      state: "ready",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: "4.0.499",
    });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("已就绪")).toBeTruthy());
    expect(screen.getByText(/无需重新下载/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载 Headless Shell" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "重新验证\/修复" }));
    await waitFor(() => expect(runtime.status).toHaveBeenCalledTimes(2));
    expect(runtime.download).not.toHaveBeenCalled();
    expect(screen.getByText(/验证通过/)).toBeTruthy();
  });

  it("enables download after a missing-browser verification", async () => {
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("尚未安装")).toBeTruthy());
    const downloadButton = screen.getByRole("button", { name: "下载 Headless Shell" });
    expect(downloadButton).toHaveProperty("disabled", false);
    expect(screen.getByText(/可以下载/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新验证\/修复" }));
    await waitFor(() => expect(runtime.status).toHaveBeenCalledTimes(2));
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it("shows update-required diagnostics and keeps the manual update action retryable", async () => {
    const runtime = installRuntime({
      state: "update-required",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: "4.0.498",
    });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("需要手动更新")).toBeTruthy());
    expect(screen.getAllByText(/4\.0\.498/).length).toBeGreaterThan(0);
    const updateButton = screen.getByRole("button", { name: "手动更新" });
    expect(updateButton).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "重新验证\/修复" }));
    await waitFor(() => expect(runtime.status).toHaveBeenCalledTimes(2));
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it("shows status errors and permits a safe download retry", async () => {
    const runtime = installRuntime({
      state: "error",
      remotionVersion: "4.0.499",
      message: "缓存校验失败",
    });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("检查失败")).toBeTruthy());
    expect(screen.getByText("缓存校验失败")).toBeTruthy();
    const retryButton = screen.getByRole("button", { name: "重试下载" });
    expect(retryButton).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "重新验证\/修复" }));
    await waitFor(() => expect(runtime.status).toHaveBeenCalledTimes(2));
    expect(runtime.download).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重试下载" }));
    await waitFor(() => expect(runtime.download).toHaveBeenCalledOnce());
  });

  it("shows a rejected status probe and keeps repair retryable", async () => {
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" });
    runtime.status.mockRejectedValueOnce(new Error("状态桥接不可用"));
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("检查失败")).toBeTruthy());
    expect(screen.getByText("状态桥接不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试下载" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "重新验证\/修复" }));
    await waitFor(() => expect(runtime.status).toHaveBeenCalledTimes(2));
    expect(screen.getByText("尚未安装")).toBeTruthy();
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it("renders bounded progress through completion without probing again", async () => {
    let resolveDownload: (status: RemotionBrowserStatus) => void = () => undefined;
    const download = vi.fn(() => new Promise<RemotionBrowserStatus>((resolve) => {
      resolveDownload = resolve;
    }));
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" }, download);
    const phases: RemotionBrowserDownloadProgress["phase"][] = [];
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("尚未安装")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下载 Headless Shell" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());

    const emit = (progress: RemotionBrowserDownloadProgress) => {
      phases.push(progress.phase);
      runtime.emitProgress(progress);
    };
    emit({ phase: "starting", ratio: 0, remotionVersion: "4.0.499" });
    emit({ phase: "downloading", ratio: 0.5, remotionVersion: "4.0.499" });
    emit({ phase: "completed", ratio: 1, remotionVersion: "4.0.499" });
    resolveDownload({
      state: "ready",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: "4.0.499",
    });

    await waitFor(() => expect(screen.getByText("已就绪")).toBeTruthy());
    expect(phases).toEqual(["starting", "downloading", "completed"]);
    expect(runtime.status).toHaveBeenCalledOnce();
  });

  it("shows a failed progress terminal state and leaves download retryable", async () => {
    let rejectDownload: (reason?: unknown) => void = () => undefined;
    const download = vi.fn(() => new Promise<RemotionBrowserStatus>((_resolve, reject) => {
      rejectDownload = reject;
    }));
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" }, download);
    const phases: RemotionBrowserDownloadProgress["phase"][] = [];
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("尚未安装")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下载 Headless Shell" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());

    const emit = (progress: RemotionBrowserDownloadProgress) => {
      phases.push(progress.phase);
      runtime.emitProgress(progress);
    };
    emit({ phase: "starting", ratio: 0, remotionVersion: "4.0.499" });
    emit({ phase: "downloading", ratio: 0.25, remotionVersion: "4.0.499" });
    emit({ phase: "failed", ratio: 0.25, remotionVersion: "4.0.499", message: "网络连接失败" });
    rejectDownload(new Error("网络连接失败"));

    await waitFor(() => expect(screen.getByText("网络连接失败")).toBeTruthy());
    expect(phases).toEqual(["starting", "downloading", "failed"]);
    expect(screen.getByRole("button", { name: "重试下载" })).toHaveProperty("disabled", false);
  });
});
