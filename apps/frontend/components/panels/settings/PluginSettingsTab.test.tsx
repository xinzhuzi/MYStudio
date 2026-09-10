// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  imageGenProbe: vi.fn(async () => undefined),
  videoQcRefresh: vi.fn(async () => undefined),
  comfyEngineRefresh: vi.fn(async () => undefined),
}));

vi.mock("./usePythonRuntimeSettings", () => ({
  usePythonRuntimeSettings: () => ({
    hasRuntime: true,
    setupRuntime: mocks.setupRuntime,
    isSetupActive: false,
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
// ---- 行级状态胶囊所需的六个运行时 hook mock(挂载期一次性探测) ----
vi.mock("./useImageGenRuntimeSettings", () => ({
  useImageGenRuntimeSettings: () => ({
    hasRuntime: true,
    hasLifecycleBridge: true,
    lifecycleStatus: { state: "ready" as const },
    status: null,
    isSettingUp: false,
    isProbing: false,
    probeRuntime: mocks.imageGenProbe,
  }),
}));
vi.mock("./useSfxGenRuntimeSettings", () => ({
  useSfxGenRuntimeSettings: () => ({
    hasRuntime: true,
    status: { setupStage: "ready" as const },
    isSettingUp: false,
  }),
}));
vi.mock("./useVideoQcRuntimeSettings", () => ({
  useVideoQcRuntimeSettings: () => ({
    hasBridge: true,
    status: { state: "ready" as const, modelReady: true },
    isProbing: false,
    isDownloading: false,
    refresh: mocks.videoQcRefresh,
  }),
}));
vi.mock("./PythonSettingsTab", () => ({
  PythonSettingsTab: ({ embedded }: { embedded?: boolean }) => <div data-testid="python-section">{String(embedded)}</div>,
}));
vi.mock("./comfy-engine/useComfyEngineSettings", () => ({
  useComfyEngineSettings: () => ({
    hasBridge: true,
    status: {
      installed: true,
      version: "0.34.0",
      latest: null,
      state: "ready" as const,
      port: 17599,
      modelsDir: "/tmp/comfyui/models",
      defaultModelsDir: "/tmp/comfyui/models",
      serviceRunning: true,
      pluginCount: 0,
      updateAvailable: false,
      message: null,
      installDir: "/tmp/comfyui",
    },
    activeJob: null,
    refreshStatus: mocks.comfyEngineRefresh,
  }),
}));
vi.mock("./comfy-engine/ComfyEngineSettingsSection", () => ({
  ComfyEngineSettingsSection: ({ embedded, initialActiveTab }: { embedded?: boolean; initialActiveTab?: string }) => (
    <div data-testid="comfy-engine-section">{String(embedded)}{initialActiveTab ? `:${initialActiveTab}` : ""}</div>
  ),
}));
vi.mock("./SfxGenSettingsSection", () => ({
  SfxGenSettingsSection: ({ embedded }: { embedded?: boolean }) => <div data-testid="sfx-gen-section">{String(embedded)}</div>,
}));
vi.mock("./HyperFramesRegistrySection", () => ({
  HyperFramesRegistrySection: () => <div data-testid="hy-registry-section">mock</div>,
}));
vi.mock("@/components/panels/tts/LocalTtsPanel", () => ({
  LocalTtsPanel: ({ embedded }: { embedded?: boolean }) => <div data-testid="tts-section">{String(embedded)}</div>,
}));
vi.mock("./RenderingSettingsTab", () => ({
  RenderingSettingsTab: ({ embedded }: { embedded?: boolean }) => <div data-testid="video-section">{String(embedded)}</div>,
}));

import { PluginSettingsTab } from "./PluginSettingsTab";
import { REVEAL_SETTINGS_SECTION_EVENT } from "./comfy-engine/comfy-engine-update-reminder";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.removeItem("mystudio.settings.plugins.collapsedSections");
  // Reset scenario back to the "all ready" default after each test.
  scenario.pythonReady = true;
  scenario.ttsReady = true;
  scenario.videoReady = true;
});

/** 08-28 布局重做后:分组标签是普通文本。09-09 起:音乐行随 music3 收敛 ComfyUI 撤
 * (09-09-music3-to-comfyui),生图行随模型页并入引擎卡撤(09-09-comfy-model-tab)。 */
const EXPECTED_ROW_HEADINGS = [
  "本地配置",
  "Python 运行环境",
  "ComfyUI 引擎",
  "视觉审核（VLM 一致性检查）",
  "视频评分模型",
  "TTS 运行时与模型",
  "本地音效生成",
  "视频工作流插件",
];

describe("PluginSettingsTab", () => {
  it("renders the capability rows in dependency order with status pills", async () => {
    // 本用例断言区块内容,种「显式全开」绕过默认折叠;默认折叠行为由下方专项用例覆盖。
    window.localStorage.setItem("mystudio.settings.plugins.collapsedSections", "[]");
    render(<PluginSettingsTab />);

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(EXPECTED_ROW_HEADINGS);
    // 行级状态胶囊:就绪能力亮绿;jsdom 无 VLM 桥 → 该行显示「不支持」。
    expect(screen.getAllByText("已就绪").length).toBeGreaterThan(0);
    expect(screen.getByText("不支持")).toBeTruthy();
    expect(screen.getByTestId("python-section").textContent).toBe("true");
    expect(screen.getByTestId("sfx-gen-section").textContent).toBe("true");
    expect(await screen.findByTestId("tts-section")).toBeTruthy();
    expect(screen.getByTestId("video-section").textContent).toBe("true");
  });

  it("defaults all sections to collapsed and remembers manual expansion", async () => {
    window.localStorage.removeItem("mystudio.settings.plugins.collapsedSections");
    const { unmount } = render(<PluginSettingsTab />);

    // 默认全折叠：11 行区块标题可见，内容全部不在 DOM
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(EXPECTED_ROW_HEADINGS);
    expect(screen.queryByTestId("python-section")).toBeNull();
    expect(screen.queryByTestId("comfy-engine-section")).toBeNull();
    expect(screen.queryByTestId("sfx-gen-section")).toBeNull();
    expect(screen.queryByTestId("video-section")).toBeNull();

    // 展开 Python 行：内容出现(锚定开头,避免匹配到描述里引用「Python 运行环境」的其他区块)
    fireEvent.click(screen.getByRole("button", { name: /^Python 运行环境/ }));
    expect(screen.getByTestId("python-section").textContent).toBe("true");

    // 展开记忆持久化——重挂载后仍展开（其余仍折叠）
    unmount();
    render(<PluginSettingsTab />);
    expect(screen.getByTestId("python-section").textContent).toBe("true");
    expect(screen.queryByTestId("video-section")).toBeNull();
  });

  it("ComfyUI 引擎卡每次进设置默认收起(点开才挂载才查更新),上次的展开记忆不生效(09-09)", () => {
    // 记忆=全部展开(引擎卡上会话点开过)
    window.localStorage.setItem("mystudio.settings.plugins.collapsedSections", JSON.stringify([]));
    render(<PluginSettingsTab />);

    // 引擎卡收起起步;其余分组照记忆展开
    expect(screen.queryByTestId("comfy-engine-section")).toBeNull();
    expect(screen.getByTestId("python-section").textContent).toBe("true");
  });

  it("migrates the legacy 声音 collapsed card to the three audio rows", () => {
    window.localStorage.setItem("mystudio.settings.plugins.collapsedSections", JSON.stringify(["audio"]));
    render(<PluginSettingsTab />);

    // 三行声音区块继承旧「声音」整卡的折叠态(内容不在 DOM),行本身仍可见。
    expect(screen.getByRole("button", { name: /^TTS 运行时与模型/ })).toBeTruthy();
    expect(screen.queryByTestId("tts-section")).toBeNull();
    expect(screen.queryByTestId("sfx-gen-section")).toBeNull();
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

  it("「去更新」深链:引擎行展开且携带 update 目标页;手动折叠再展开回默认页(09-09)", () => {
    window.localStorage.setItem("mystudio.settings.plugins.collapsedSections", JSON.stringify(["comfy-engine"]));
    render(<PluginSettingsTab />);
    expect(screen.queryByTestId("comfy-engine-section")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(REVEAL_SETTINGS_SECTION_EVENT, { detail: { sectionId: "comfy-engine", tab: "update" } }),
      );
    });
    expect(screen.getByTestId("comfy-engine-section").textContent).toBe("true:update");

    // 手动折叠 → 深链目标页过期;再展开回默认(无 :update 后缀)
    fireEvent.click(screen.getByRole("button", { name: /^ComfyUI 引擎/ }));
    expect(screen.queryByTestId("comfy-engine-section")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^ComfyUI 引擎/ }));
    expect(screen.getByTestId("comfy-engine-section").textContent).toBe("true");
  });

  it("only prepares the not-ready video layer when Python and TTS are already ready", async () => {
    // Python + TTS ready, only video not ready → skip Python/TTS, configure video only.
    scenario.pythonReady = true;
    scenario.ttsReady = true;
    scenario.videoReady = false;

    render(<PluginSettingsTab />);

    // 视频行聚合分级:三插件 update-available → 胶囊显示「可更新」而非笼统「需准备」。
    expect(screen.getByText("可更新")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "按优先级准备基础运行时" }));

    await waitFor(() => expect(mocks.prepareCurrentWorkflow).toHaveBeenCalledOnce());
    expect(mocks.setupRuntime).not.toHaveBeenCalled();
    expect(mocks.startTtsRuntime).not.toHaveBeenCalled();
  });
});
