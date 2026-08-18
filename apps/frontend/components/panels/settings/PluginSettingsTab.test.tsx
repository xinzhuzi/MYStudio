// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A mutable scenario flag so each test can declare whether all layers are
// "ready" (smart-skip path) or "not ready" (full-prepare path).
const scenario = vi.hoisted(() => ({
  // Default: everything ready (smart-skip scenario).
  pythonReady: true as boolean,
  ttsReady: true as boolean,
  videoReady: true as boolean,
}));

const mocks = vi.hoisted(() => ({
  setupRuntime: vi.fn(async () => undefined),
  refreshPlugins: vi.fn(async () => undefined),
  prepareCurrentWorkflow: vi.fn(async () => ({ success: true })),
  startTtsRuntime: vi.fn(async () => ({ success: true })),
}));

vi.mock("./usePythonRuntimeSettings", () => ({
  usePythonRuntimeSettings: () => ({
    hasRuntime: true,
    setupRuntime: mocks.setupRuntime,
    // installedItems drives pythonReady: non-empty + no "failed" item = ready.
    installedItems: scenario.pythonReady
      ? [{ label: "Python 运行环境", detail: "/python/bin/python3", status: "installed" as const }]
      : [],
  }),
}));
vi.mock("./useVideoWorkflowPlugins", () => {
  const pluginStatus = (
    pluginId: "video-use" | "remotion" | "hyperframes",
    runtimeState: "ready" | "update-available",
  ) => ({
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
    checkedAt: 1_700_000_000_000,
  });

  return {
    useVideoWorkflowPlugins: () => ({
      error: undefined,
      refresh: mocks.refreshPlugins,
      prepareCurrentWorkflow: mocks.prepareCurrentWorkflow,
      getPlugin: (id: string) =>
        pluginStatus(id as "video-use" | "remotion" | "hyperframes", scenario.videoReady ? "ready" : "update-available"),
      plugins: [
        pluginStatus("video-use", scenario.videoReady ? "ready" : "update-available"),
        pluginStatus("remotion", scenario.videoReady ? "ready" : "update-available"),
        pluginStatus("hyperframes", scenario.videoReady ? "ready" : "update-available"),
      ],
    }),
  };
});
vi.mock("@/lib/tts/client", () => ({
  getTtsRuntimeStatus: () =>
    Promise.resolve(
      scenario.ttsReady
        ? { running: true, setupStage: "ready" as const }
        : { running: false, setupStage: "idle" as const },
    ),
  startTtsRuntime: mocks.startTtsRuntime,
}));
vi.mock("./PythonSettingsTab", () => ({
  PythonSettingsTab: ({ embedded }: { embedded?: boolean }) => <div data-testid="python-section">{String(embedded)}</div>,
}));
vi.mock("./DepthSettingsSection", () => ({
  DepthSettingsSection: ({ embedded }: { embedded?: boolean }) => <div data-testid="depth-section">{String(embedded)}</div>,
}));
vi.mock("./LocalImageSettingsSection", () => ({
  LocalImageSettingsSection: ({ embedded }: { embedded?: boolean }) => <div data-testid="image-gen-section">{String(embedded)}</div>,
}));
vi.mock("./UpscaleSettingsSection", () => ({
  UpscaleSettingsSection: ({ embedded }: { embedded?: boolean }) => <div data-testid="upscale-section">{String(embedded)}</div>,
}));
vi.mock("./LocalAudioSettingsSection", () => ({
  LocalAudioSettingsSection: ({ embedded }: { embedded?: boolean }) => <div data-testid="audio-gen-section">{String(embedded)}</div>,
}));
vi.mock("./SfxGenSettingsSection", () => ({
  SfxGenSettingsSection: ({ embedded }: { embedded?: boolean }) => <div data-testid="sfx-gen-section">{String(embedded)}</div>,
}));
vi.mock("@/components/panels/tts/LocalTtsPanel", () => ({
  LocalTtsPanel: ({ embedded }: { embedded?: boolean }) => <div data-testid="tts-section">{String(embedded)}</div>,
}));
vi.mock("./RenderingSettingsTab", () => ({
  RenderingSettingsTab: ({ embedded }: { embedded?: boolean }) => <div data-testid="video-section">{String(embedded)}</div>,
}));

import { PluginSettingsTab } from "./PluginSettingsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.removeItem("mystudio.settings.plugins.collapsedSections");
  // Reset scenario back to the "all ready" default after each test.
  scenario.pythonReady = true;
  scenario.ttsReady = true;
  scenario.videoReady = true;
});

describe("PluginSettingsTab", () => {
  it("renders the three configuration sections in dependency order", async () => {
    // 本用例断言区块内容,种「显式全开」绕过默认折叠;默认折叠行为由下方专项用例覆盖。
    window.localStorage.setItem("mystudio.settings.plugins.collapsedSections", "[]");
    render(<PluginSettingsTab />);

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual([
      "本地配置",
      "Python 运行环境",
      "深度估计（电影级 3D）",
      "本地图片生成（免费）",
      "图片超分（1K → 4K）",
      "成片观感评分",
      "本地音乐生成",
      "本地音效生成",
      "TTS 运行时与模型",
      "视频工作流插件",
    ]);
    expect(screen.getByTestId("python-section").textContent).toBe("true");
    expect(screen.getByTestId("image-gen-section").textContent).toBe("true");
    expect(screen.getByTestId("upscale-section").textContent).toBe("true");
    expect(screen.getByTestId("sfx-gen-section").textContent).toBe("true");
    expect(await screen.findByTestId("tts-section")).toBeTruthy();
    expect(screen.getByTestId("video-section").textContent).toBe("true");
  });

  it("defaults all sections to collapsed and remembers manual expansion", async () => {
    window.localStorage.removeItem("mystudio.settings.plugins.collapsedSections");
    const { unmount } = render(<PluginSettingsTab />);

    // 默认全折叠：9 个区块标题可见，内容全部不在 DOM
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual([
      "本地配置",
      "Python 运行环境",
      "深度估计（电影级 3D）",
      "本地图片生成（免费）",
      "图片超分（1K → 4K）",
      "成片观感评分",
      "本地音乐生成",
      "本地音效生成",
      "TTS 运行时与模型",
      "视频工作流插件",
    ]);
    expect(screen.queryByTestId("python-section")).toBeNull();
    expect(screen.queryByTestId("depth-section")).toBeNull();
    expect(screen.queryByTestId("sfx-gen-section")).toBeNull();
    expect(screen.queryByTestId("video-section")).toBeNull();

    // 展开 Python 区：内容出现(锚定开头,避免匹配到描述里引用「Python 运行环境」的其他区块)
    fireEvent.click(screen.getByRole("button", { name: /^Python 运行环境/ }));
    expect(screen.getByTestId("python-section").textContent).toBe("true");

    // 展开记忆持久化——重挂载后仍展开（其余仍折叠）
    unmount();
    render(<PluginSettingsTab />);
    expect(screen.getByTestId("python-section").textContent).toBe("true");
    expect(screen.queryByTestId("video-section")).toBeNull();
  });

  it("prepares Python, TTS and video plugins in priority order when layers are NOT ready", async () => {
    // Nothing is ready → full prepare path: every layer gets configured.
    scenario.pythonReady = false;
    scenario.ttsReady = false;
    scenario.videoReady = false;

    render(<PluginSettingsTab />);

    fireEvent.click(screen.getByRole("button", { name: "按优先级准备基础运行时" }));

    await waitFor(() => expect(mocks.prepareCurrentWorkflow).toHaveBeenCalledOnce());
    expect(mocks.setupRuntime).toHaveBeenCalledOnce();
    expect(mocks.startTtsRuntime).toHaveBeenCalledOnce();
    expect(mocks.refreshPlugins).toHaveBeenCalledOnce();
    // Order: refreshPlugins first (fresh status before deciding), then layer ops.
    // refreshPlugins < setupRuntime < startTtsRuntime < prepareCurrentWorkflow.
    expect(mocks.refreshPlugins.mock.invocationCallOrder[0]).toBeLessThan(mocks.setupRuntime.mock.invocationCallOrder[0]!);
    expect(mocks.setupRuntime.mock.invocationCallOrder[0]).toBeLessThan(mocks.startTtsRuntime.mock.invocationCallOrder[0]!);
    expect(mocks.startTtsRuntime.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepareCurrentWorkflow.mock.invocationCallOrder[0]!);
  });

  it("skips all configuration when all layers are ready (smart skip)", async () => {
    // Default scenario: everything ready → nothing should be configured.
    render(<PluginSettingsTab />);

    fireEvent.click(screen.getByRole("button", { name: "按优先级准备基础运行时" }));

    // refresh still runs (to get fresh plugin status before deciding), but no layer op fires.
    await waitFor(() => expect(mocks.refreshPlugins).toHaveBeenCalledOnce());
    expect(mocks.setupRuntime).not.toHaveBeenCalled();
    expect(mocks.prepareCurrentWorkflow).not.toHaveBeenCalled();
    expect(mocks.startTtsRuntime).not.toHaveBeenCalled();
  });

  it("only prepares the not-ready video layer when Python and TTS are already ready", async () => {
    // Python + TTS ready, only video not ready → skip Python/TTS, configure video only.
    scenario.pythonReady = true;
    scenario.ttsReady = true;
    scenario.videoReady = false;

    render(<PluginSettingsTab />);

    fireEvent.click(screen.getByRole("button", { name: "按优先级准备基础运行时" }));

    await waitFor(() => expect(mocks.prepareCurrentWorkflow).toHaveBeenCalledOnce());
    expect(mocks.setupRuntime).not.toHaveBeenCalled();
    expect(mocks.startTtsRuntime).not.toHaveBeenCalled();
  });
});
