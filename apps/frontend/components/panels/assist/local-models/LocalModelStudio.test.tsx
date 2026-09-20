// @vitest-environment jsdom
// 漫影专属文生图(本地模型模块)测试:表单渲染/模型下拉、生成请求形状
// (template=manying_t2i + checkpoint 注入)、出图入画廊。

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalModelStudio } from "./LocalModelStudio";
import { createMockComfyEngineClient } from "@/components/panels/settings/comfy-engine/mock-comfy-engine-client";
import type { ComfyEngineClient, ComfyModelsReply } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const persistMock = vi.hoisted(() => vi.fn(async (): Promise<{ url: string | null; mediaId?: string; persisted: boolean }> => ({
  url: "media://m1", mediaId: "m1", persisted: true,
})));
vi.mock("@/lib/assist/image-studio/comfy-execute", () => ({
  persistComfyImage: persistMock,
}));

const sidecarMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/ai/image-generation-engine", () => ({
  ensureLocalImageSidecarRunning: sidecarMock,
}));

// hook 整体 mock(历史模式):模型清单/引擎动作由用例注入
const scenario = vi.hoisted(() => ({
  models: null as ComfyModelsReply | null,
  loadModels: vi.fn(async () => undefined),
  startService: vi.fn(async () => undefined),
}));

vi.mock("@/components/panels/settings/comfy-engine/useComfyEngineSettings", () => ({
  useComfyEngineSettings: () => ({
    hasBridge: true,
    status: null,
    activeJob: null,
    plugins: [],
    catalog: [],
    categories: [],
    models: scenario.models,
    isLoadingModels: false,
    loadModels: scenario.loadModels,
    startService: scenario.startService,
    isStartingService: false,
    installEngine: vi.fn(),
    updateEngine: vi.fn(),
    resetEngine: vi.fn(),
    rollbackUpdate: vi.fn(),
    rollbackTo: vi.fn(),
    setLaunchConfig: vi.fn(),
    refreshSnapshots: vi.fn(),
    cleanOrphans: vi.fn(),
    checkUpdate: vi.fn(),
    setModelsDir: vi.fn(),
    runDoctor: vi.fn(),
    stopService: vi.fn(),
    searchCatalog: vi.fn(),
    installPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    getPluginUsage: vi.fn(),
    updateCheck: null,
    updateReport: null,
    pluginInstallReport: null,
    doctorReport: null,
    isCheckingUpdate: false,
    isSavingModelsDir: false,
    isRunningDoctor: false,
    isRollingBack: false,
    snapshots: [],
    pluginsLoaded: true,
    refreshStatus: vi.fn(),
    refreshPlugins: vi.fn(),
  }),
}));

const fetchMock = vi.fn();

type ProjectState = { activeProjectId: string | null };
const project = vi.hoisted(() => ({
  state: { activeProjectId: "project-a" } as ProjectState,
  listeners: new Set<(state: ProjectState, previous: ProjectState) => void>(),
}));
vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: {
    getState: () => project.state,
    subscribe: (listener: (state: ProjectState, previous: ProjectState) => void) => {
      project.listeners.add(listener);
      return () => project.listeners.delete(listener);
    },
  },
}));

function switchProject(activeProjectId: string) {
  const previous = project.state;
  project.state = { activeProjectId };
  project.listeners.forEach((listener) => listener(project.state, previous));
}

function modelsReply(files: string[]): ComfyModelsReply {
  return {
    modelsDir: "/tmp/comfyui/models",
    groups: [
      { category: "diffusion_models", files: files.map((name) => ({ name, sizeBytes: 1024 })) },
      { category: "loras", files: [{ name: "style.safetensors", sizeBytes: 512 }] },
    ],
    totalBytes: 4096,
  };
}

beforeEach(() => {
  project.state = { activeProjectId: "project-a" };
  project.listeners.clear();
  fetchMock.mockReset();
  persistMock.mockReset().mockResolvedValue({ url: "media://m1", mediaId: "m1", persisted: true });
  sidecarMock.mockReset().mockResolvedValue(true);
  (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = createMockComfyEngineClient();
  vi.stubGlobal("fetch", fetchMock);
  scenario.models = modelsReply(["krea2_turbo_bf16.safetensors", "qwen_image_8b.safetensors"]);
});

afterEach(() => {
  cleanup();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("LocalModelStudio(漫影专属生图)", () => {
  it.each(
    ["sidecar", "request", "body", "persist", "error-body"].flatMap((stage) =>
      [false, true].map((returnToOrigin) => ({ stage, returnToOrigin })),
    ),
  )("等待 $stage 时切换项目(returnToOrigin=$returnToOrigin)不会回写或显示旧结果", async ({ stage, returnToOrigin }) => {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    const reachedGate = vi.fn();
    const pause = async (point: string) => {
      if (point !== stage) return;
      reachedGate();
      await gate;
    };
    sidecarMock.mockImplementationOnce(async () => {
      await pause("sidecar");
      return true;
    });
    fetchMock.mockImplementationOnce(async () => {
      await pause("request");
      return {
        ok: stage !== "error-body",
        status: 500,
        json: async () => {
          await pause("body");
          return { data: [{ b64_json: "QUJD" }] };
        },
        text: async () => {
          await pause("error-body");
          return "旧项目生成失败";
        },
      };
    });
    persistMock.mockImplementationOnce(async () => {
      await pause("persist");
      return { url: "media://m1", mediaId: "m1", persisted: true };
    });
    render(<LocalModelStudio />);
    fireEvent.change(await screen.findByPlaceholderText("想画什么,写在这里"), { target: { value: "项目 A 的画面" } });
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);
    await waitFor(() => expect(reachedGate).toHaveBeenCalledOnce());

    await act(async () => {
      switchProject("project-b");
      if (returnToOrigin) switchProject("project-a");
      resolveGate();
    });

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("项目已切换")));
    expect(toasts.success).not.toHaveBeenCalled();
    expect(document.querySelector("[data-local-model-gallery] img")).toBeNull();
    expect((document.querySelector("[data-local-model-generate]") as HTMLButtonElement).disabled).toBe(false);
    expect(project.listeners.size).toBe(0);
    if (stage === "persist") {
      expect(persistMock).toHaveBeenCalledWith("QUJD", "项目 A 的画面", expect.objectContaining({
        projectId: "project-a",
        isProjectCurrent: expect.any(Function),
      }));
    } else {
      expect(persistMock).not.toHaveBeenCalled();
    }
    if (stage === "sidecar") expect(fetchMock).not.toHaveBeenCalled();
  });

  it("表单渲染 + 模型下拉只列主模型(diffusion_models)且默认 K2 主力", async () => {
    render(<LocalModelStudio />);
    expect(await screen.findByText("漫影生图")).toBeTruthy();
    const select = document.querySelector("[data-local-model-select]") as HTMLSelectElement;
    expect(select).toBeTruthy();
    const options = Array.from(select.options).map((option) => option.value);
    expect(options).toEqual(["krea2_turbo_bf16.safetensors", "qwen_image_8b.safetensors"]); // loras 不入列
    expect(select.value).toBe("krea2_turbo_bf16.safetensors"); // 默认 K2
  });

  it("生成:请求带 manying_t2i 模板与所选 checkpoint;出图入画廊+媒体库", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: "QUJD" }] }),
    });
    render(<LocalModelStudio />);
    const prompt = await screen.findByPlaceholderText("想画什么,写在这里");
    fireEvent.change(prompt, { target: { value: "水墨少年仗剑" } });
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("图片已生成并存入媒体库"));
    expect(sidecarMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/images/generations");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("comfyui-bridge");
    expect(body.template).toBe("manying_t2i");
    expect(body.checkpoint).toBe("krea2_turbo_bf16.safetensors");
    expect(body.prompt).toBe("水墨少年仗剑");
    expect(body.aspect_ratio).toBe("1:1");
    expect(persistMock).toHaveBeenCalledWith("QUJD", "水墨少年仗剑", expect.objectContaining({ source: "manying_t2i" }));
    expect(document.querySelector("[data-local-model-gallery] img")).toBeTruthy();
  });

  it("空提示词拦截:不发请求", async () => {
    render(<LocalModelStudio />);
    await screen.findByText("漫影生图");
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);
    expect(toasts.error).toHaveBeenCalledWith("先写提示词再生成");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("保存失败时保留内存预览并提示尚未存盘,不宣称已入媒体库", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: "QUJD" }] }),
    });
    persistMock.mockResolvedValueOnce({ url: null, persisted: false });
    render(<LocalModelStudio />);
    fireEvent.change(await screen.findByPlaceholderText("想画什么,写在这里"), { target: { value: "未存盘画面" } });
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);

    await waitFor(() => expect(toasts.warning).toHaveBeenCalledWith("图片已生成,但保存失败,当前仅有内存预览,尚未存盘"));
    expect(toasts.success).not.toHaveBeenCalled();
    expect(document.querySelector("[data-local-model-gallery] img")?.getAttribute("src")).toBe("data:image/png;base64,QUJD");
    expect(project.listeners.size).toBe(0);
  });

  it("加速档:模板换成 manying_t2i_fast、不注入 checkpoint、默认 4 步", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: "QUJD" }] }),
    });
    render(<LocalModelStudio />);
    await screen.findByText("漫影生图");
    fireEvent.click(document.querySelector("[data-local-model-mode-fast]")!);
    const prompt = screen.getByPlaceholderText("想画什么,写在这里");
    fireEvent.change(prompt, { target: { value: "雪夜孤城" } });
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("图片已生成并存入媒体库"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/images/generations");
    const body = JSON.parse(init.body);
    expect(body.template).toBe("manying_t2i_fast");
    expect(body.checkpoint).toBeUndefined(); // 加速档模型钉死在模板里
    expect(body.num_inference_steps).toBe(4);
    expect(persistMock).toHaveBeenCalledWith("QUJD", "雪夜孤城", expect.objectContaining({ source: "manying_t2i_fast" }));
  });

  it("加速档步数切 6:请求带 num_inference_steps=6;主模型行为只读展示", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: "QUJD" }] }),
    });
    render(<LocalModelStudio />);
    await screen.findByText("漫影生图");
    fireEvent.click(document.querySelector("[data-local-model-mode-fast]")!);
    expect(document.querySelector("[data-local-model-select]")).toBeNull(); // 不再渲染下拉
    expect(document.querySelector("[data-local-model-fixed-model]")).toBeTruthy();
    fireEvent.change(document.querySelector("[data-local-model-fast-steps]")!, { target: { value: "6" } });
    fireEvent.change(screen.getByPlaceholderText("想画什么,写在这里"), { target: { value: "大漠驼铃" } });
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);

    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.num_inference_steps).toBe(6);
  });

  it("切回标准档:恢复 checkpoint 注入与 manying_t2i 模板", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: "QUJD" }] }),
    });
    render(<LocalModelStudio />);
    await screen.findByText("漫影生图");
    fireEvent.click(document.querySelector("[data-local-model-mode-fast]")!);
    fireEvent.click(document.querySelector("[data-local-model-mode-standard]")!);
    fireEvent.change(screen.getByPlaceholderText("想画什么,写在这里"), { target: { value: "江南烟雨" } });
    fireEvent.click(document.querySelector("[data-local-model-generate]")!);

    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.template).toBe("manying_t2i");
    expect(body.checkpoint).toBe("krea2_turbo_bf16.safetensors");
    expect(body.num_inference_steps).toBe(8);
  });
});
