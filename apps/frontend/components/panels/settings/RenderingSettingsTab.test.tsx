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
    await waitFor(() => expect(screen.getByText("未下载")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: /Remotion/ }));
    expect(useAppSettingsStore.getState().renderingSettings.renderer).toBe("remotion");
  });

  it("exposes an explicit manual download action", async () => {
    const download = window.remotionRuntime?.download;
    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByText("未下载")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
  });

  it("shows a successful install and prevents a second download", async () => {
    const runtime = installRuntime({
      state: "ready",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: "4.0.499",
    });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("下载成功")).toBeTruthy());
    expect(screen.getByRole("button", { name: "已下载" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/Remotion 版本|缓存准备版本|验证通过|无需重新下载/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "已下载" }));
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it("enables download after a missing-browser verification", async () => {
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("未下载")).toBeTruthy());
    const downloadButton = screen.getByRole("button", { name: "下载" });
    expect(downloadButton).toHaveProperty("disabled", false);
    expect(runtime.download).not.toHaveBeenCalled();
  });

  it("treats a version update as a download-needed state", async () => {
    const runtime = installRuntime({
      state: "update-required",
      remotionVersion: "4.0.499",
      preparedForRemotionVersion: "4.0.498",
    });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("未下载")).toBeTruthy());
    expect(screen.queryByText(/4\.0\.498/)).toBeNull();
    const updateButton = screen.getByRole("button", { name: "下载" });
    expect(updateButton).toHaveProperty("disabled", false);
    fireEvent.click(updateButton);
    await waitFor(() => expect(runtime.download).toHaveBeenCalledOnce());
  });

  it("shows status errors and permits a safe download retry", async () => {
    const runtime = installRuntime({
      state: "error",
      remotionVersion: "4.0.499",
      message: "缓存校验失败",
    });
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("下载失败")).toBeTruthy());
    expect(screen.queryByText("缓存校验失败")).toBeNull();
    const retryButton = screen.getByRole("button", { name: "重新下载" });
    expect(retryButton).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "重新下载" }));
    await waitFor(() => expect(runtime.download).toHaveBeenCalledOnce());
  });

  it("shows a rejected status probe and keeps download retryable", async () => {
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" });
    runtime.status.mockRejectedValueOnce(new Error("状态桥接不可用"));
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("下载失败")).toBeTruthy());
    expect(screen.getByRole("button", { name: "重新下载" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "重新下载" }));
    await waitFor(() => expect(runtime.download).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("下载成功")).toBeTruthy());
  });

  it("renders bounded progress through completion without probing again", async () => {
    let resolveDownload: (status: RemotionBrowserStatus) => void = () => undefined;
    const download = vi.fn(() => new Promise<RemotionBrowserStatus>((resolve) => {
      resolveDownload = resolve;
    }));
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" }, download);
    const phases: RemotionBrowserDownloadProgress["phase"][] = [];
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("未下载")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
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

    await waitFor(() => expect(screen.getByText("下载成功")).toBeTruthy());
    expect(screen.getByRole("button", { name: "已下载" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "已下载" }));
    expect(phases).toEqual(["starting", "downloading", "completed"]);
    expect(runtime.status).toHaveBeenCalledOnce();
    expect(runtime.download).toHaveBeenCalledOnce();
  });

  it("shows a failed progress terminal state and leaves download retryable", async () => {
    let rejectDownload: (reason?: unknown) => void = () => undefined;
    const download = vi.fn(() => new Promise<RemotionBrowserStatus>((_resolve, reject) => {
      rejectDownload = reject;
    }));
    const runtime = installRuntime({ state: "not-installed", remotionVersion: "4.0.499" }, download);
    const phases: RemotionBrowserDownloadProgress["phase"][] = [];
    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByText("未下载")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下载" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());

    const emit = (progress: RemotionBrowserDownloadProgress) => {
      phases.push(progress.phase);
      runtime.emitProgress(progress);
    };
    emit({ phase: "starting", ratio: 0, remotionVersion: "4.0.499" });
    emit({ phase: "downloading", ratio: 0.25, remotionVersion: "4.0.499" });
    emit({ phase: "failed", ratio: 0.25, remotionVersion: "4.0.499", message: "网络连接失败" });
    rejectDownload(new Error("网络连接失败"));

    await waitFor(() => expect(screen.getByText("下载失败")).toBeTruthy());
    expect(phases).toEqual(["starting", "downloading", "failed"]);
    expect(screen.getByRole("button", { name: "重新下载" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "重新下载" }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  });
});
