// Radix Slider（章节色调强度）在 jsdom 需要 ResizeObserver（仓库惯例：各测试文件自行 stub）
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";
import { warmExtendedManualFactionData } from "@/lib/studio/visual-manual-style-tokens";
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
  // 阵营配色缓存回空,避免跨用例污染(fail-empty 基线)
  void warmExtendedManualFactionData("");
});

describe("RenderingSettingsTab", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ renderingSettings: { renderer: "ffmpeg" } });
    installRuntime({ state: "not-installed", remotionVersion: "4.0.499" });
    // 其余用例关注卡片内容,种「显式全开」绕过默认折叠;折叠默认行为由专项用例(先清键)覆盖。
    window.localStorage.setItem("mystudio.settings.rendering.collapsedModules", "[]");
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
      "硬件加速渲染",
      "插件运行时",
      "FFmpeg / ffprobe",
      "Remotion",
      "全局渲染器",
      "字幕字体",
      "书法 · 仙侠武侠",
      "现代 · 正文",
      "自定义",
      "章节色调（导演定调）",
      "氛围层",
      "字幕音效",
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
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toContain("柳建毛草");

    fireEvent.click(screen.getByRole("radio", { name: /思源宋体/ }));
    expect(useStudioStore.getState().workflowConfig.subtitleFont).toBe("noto-serif-sc");
  });

  it("钉死调色卡与本章主导阵营温感反向时提示压色风险;同向/未钉死不提示(08-28 色彩衔接)", async () => {
    // 预热阵营配色缓存(人族盘=暖)——marker 块格式对齐 art_faction_palette.md
    void warmExtendedManualFactionData([
      "<!-- storyboard-faction-members:start -->",
      JSON.stringify({ 金水河码头: "人族", 赵四: "人族" }),
      "<!-- storyboard-faction-members:end -->",
      "<!-- storyboard-faction-palette:start -->",
      JSON.stringify({
        人族: {
          person: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛朱红",
          scene: "底色米白+墨线淡墨+主色赭石+辅色栗褐+点睛藤黄",
        },
      }),
      "<!-- storyboard-faction-palette:end -->",
    ].join("\n"));
    useStudioStore.setState((state) => ({
      workflowConfig: { ...state.workflowConfig, chapterGrade: { lutId: "cn-daiqing", blend: 0.5 } },
      storyboards: [
        { id: "s1", associateAssetsNames: ["金水河码头", "赵四"] },
        { id: "s2", associateAssetsNames: ["金水河码头"] },
      ] as StoryboardItem[],
    }));
    render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "章节色调（导演定调）" })).toBeTruthy());
    expect(screen.getByText(/本章画面主色偏暖/).textContent).toContain("黛青");
    expect(screen.getByText(/建议换暖调卡或调低强度/)).toBeTruthy();

    // 换同向暖卡 → 提示消失(非阻塞、可自愈)
    useStudioStore.setState((state) => ({
      workflowConfig: { ...state.workflowConfig, chapterGrade: { lutId: "cn-tenghuang", blend: 0.5 } },
    }));
    await waitFor(() => expect(screen.queryByText(/可能压色/)).toBeNull());
    // 恢复 AI 自动 → 同样不提示
    useStudioStore.setState((state) => ({
      workflowConfig: { ...state.workflowConfig, chapterGrade: undefined },
    }));
    expect(screen.queryByText(/可能压色/)).toBeNull();
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

    // 默认全折叠：正文隐藏，状态摘要仍可见
    const trigger = screen.getByRole("button", { name: /Remotion/ });
    expect(trigger.textContent).toContain("检查中");
    expect(screen.queryByRole("heading", { name: "字幕字体" })).toBeNull();

    // 点开 Remotion 卡：正文出现
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕字体" })).toBeTruthy());

    // 展开记忆持久化——重挂载后仍展开
    unmount();
    const { unmount: unmount2 } = render(<RenderingSettingsTab />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Remotion" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "字幕字体" })).toBeTruthy();

    // 再点折叠恢复
    fireEvent.click(screen.getByRole("button", { name: /Remotion/ }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "字幕字体" })).toBeNull());
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
