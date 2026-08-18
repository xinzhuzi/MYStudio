// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useStudioStore } from "@/stores/studio/studio-store";
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
  Reflect.deleteProperty(window, "videoWorkflowPlugins");
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

  it("keeps Remotion controls together before HyperFrames, video-use and Seedance Prompt Skill", async () => {
    const checkedAt = 1_700_000_000_000;
    const plugins = (["remotion", "hyperframes", "video-use", "seedance-prompt"] as const).map((pluginId) => ({
      schemaVersion: 1 as const,
      pluginId,
      displayName: pluginId,
      sourceUrl: `https://example.test/${pluginId}`,
      sourceCommit: "test",
      license: "MIT",
      appVersion: "test",
      pluginVersion: "test",
      runtimeState: "ready" as const,
      dependencies: {},
      checkedAt,
    }));
    Object.defineProperty(window, "videoWorkflowPlugins", {
      configurable: true,
      value: {
        status: vi.fn(async () => ({ schemaVersion: 1 as const, checkedAt, plugins })),
        prepare: vi.fn(),
        update: vi.fn(),
        repair: vi.fn(),
        rollback: vi.fn(),
      },
    });

    render(<RenderingSettingsTab />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Seedance Prompt Skill" })).toBeTruthy());
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "视频工作流插件",
      "视频工作流运行说明",
      "插件运行时",
      "FFmpeg / ffprobe",
      "Remotion",
      "全局渲染器",
      "字幕字体",
      "书法 · 仙侠武侠",
      "现代 · 正文",
      "自定义",
      "Remotion Headless Shell",
      "HyperFrames",
      "video-use",
      "Seedance Prompt Skill",
    ]);
  });

  it("defaults the subtitle font to brush kaishu and persists a different choice", async () => {
    useStudioStore.setState((state) => ({
      workflowConfig: { ...state.workflowConfig, subtitleFont: undefined },
    }));
    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕字体" })).toBeTruthy());

    const group = screen.getByRole("radiogroup", { name: "字幕字体：书法 · 仙侠武侠" });
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toContain("毛笔楷书");

    fireEvent.click(screen.getByRole("radio", { name: /思源宋体/ }));
    expect(useStudioStore.getState().workflowConfig.subtitleFont).toBe("noto-serif-sc");
  });

  it("renders every font option as a live specimen in its own output style", async () => {
    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕字体" })).toBeTruthy());

    const samples = screen.getAllByText("道劫风云，剑指苍穹。");
    expect(samples).toHaveLength(7);
    // 样张必须用该字体自身渲染——顺序=书法组(毛笔/行书/龙藏/文楷/毛草)+现代组(宋体/黑体)。
    const families = samples.map((node) => (node as HTMLElement).style.fontFamily);
    expect(families[0]).toContain("Ma Shan Zheng");
    expect(families[1]).toContain("Zhi Mang Xing");
    expect(families[2]).toContain("Long Cang");
    expect(families[3]).toContain("LXGW WenKai");
    expect(families[4]).toContain("Liu Jian Mao Cao");
    expect(families[5]).toContain("Noto Serif SC");
    expect(families[6]).toContain("Noto Sans SC");
    // 分组小标题可见（含自定义组）
    expect(screen.getByText("书法 · 仙侠武侠")).toBeTruthy();
    expect(screen.getByText("现代 · 正文")).toBeTruthy();
    expect(screen.getByText("自定义")).toBeTruthy();
    // 自定义字体导入入口可用（无字体时空态提示）
    expect((screen.getByRole("button", { name: /导入自定义字体/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("collapses plugin modules with status summary visible and remembers the choice", async () => {
    window.localStorage.removeItem("mystudio.settings.rendering.collapsedModules");
    const { unmount } = render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Remotion" })).toBeTruthy());

    // 折叠 Remotion 卡：正文隐藏，状态摘要仍可见
    const trigger = screen.getByRole("button", { name: /Remotion/ });
    expect(trigger.textContent).toContain("检查中");
    fireEvent.click(trigger);
    expect(screen.queryByRole("heading", { name: "字幕字体" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Remotion" }).textContent).toContain("Remotion");

    // 折叠记忆持久化——重挂载后仍折叠
    unmount();
    const { unmount: unmount2 } = render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Remotion" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "字幕字体" })).toBeNull();

    // 再点开恢复
    fireEvent.click(screen.getByRole("button", { name: /Remotion/ }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕字体" })).toBeTruthy());
    window.localStorage.removeItem("mystudio.settings.rendering.collapsedModules");
    unmount2();
  });

  it("enables only the plugin whose automatic check reports an update", async () => {
    const checkedAt = 1_700_000_000_000;
    const pluginStatus = (pluginId: "remotion" | "video-use" | "hyperframes" | "seedance-prompt", runtimeState: "ready" | "update-available" | "deferred") => ({
      schemaVersion: 1 as const,
      pluginId,
      displayName: pluginId,
      sourceUrl: `https://example.test/${pluginId}`,
      sourceCommit: "test",
      license: "MIT",
      appVersion: "test",
      pluginVersion: "test",
      runtimeState,
      dependencies: {},
      checkedAt,
    });
    const readyStatus = {
      schemaVersion: 1 as const,
      checkedAt,
      plugins: [
        pluginStatus("remotion", "ready"),
        pluginStatus("video-use", "update-available"),
        pluginStatus("hyperframes", "ready"),
        pluginStatus("seedance-prompt", "deferred"),
      ],
    };
    const update = vi.fn(async () => ({ ...readyStatus, success: true }));
    Object.defineProperty(window, "videoWorkflowPlugins", {
      configurable: true,
      value: {
        status: vi.fn(async () => readyStatus),
        prepare: vi.fn(),
        update,
        repair: vi.fn(),
        rollback: vi.fn(),
      },
    });

    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByText("有可用更新")).toBeTruthy());
    const updateButtons = screen.getAllByRole("button", { name: "更新" });
    const enabled = updateButtons.filter((button) => !button.hasAttribute("disabled"));
    expect(enabled).toHaveLength(1);
    fireEvent.click(enabled[0]!);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pluginId: "video-use" }));
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
