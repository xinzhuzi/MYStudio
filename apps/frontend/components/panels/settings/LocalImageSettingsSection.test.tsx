// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageGenModelRow } from "@/types/image-gen";
import { LocalImageSettingsSection } from "./LocalImageSettingsSection";

// 场景可变状态:每个用例声明 models 行(bigFilesSource 两源/缺大件三态)
const scenario = vi.hoisted(() => ({
  models: [] as ImageGenModelRow[],
}));

vi.mock("./useImageGenRuntimeSettings", () => ({
  useImageGenRuntimeSettings: () => ({
    hasRuntime: true,
    hasLifecycleBridge: true,
    status: {
      running: false,
      setupStage: "idle",
      setupMessage: undefined,
      models: scenario.models,
      activeModel: "qwen-image-edit-2511",
      downloadStatus: {},
      downloadProgress: {},
      downloadError: {},
    },
    lifecycleStatus: null,
    lifecycleError: undefined,
    isSettingUp: false,
    isProbing: false,
    isRollingBack: false,
    setupRuntime: vi.fn(async () => undefined),
    probeRuntime: vi.fn(async () => undefined),
    rollbackRuntime: vi.fn(async () => undefined),
    startDownload: vi.fn(async () => ({ accepted: true, message: "" })),
    selectModel: vi.fn(async () => ({ accepted: true, message: "" })),
  }),
}));

function baseRow(overrides: Partial<ImageGenModelRow>): ImageGenModelRow {
  return {
    modelName: "qwen-image-edit-2511",
    label: "Qwen-Image-Edit 2511",
    downloaded: false,
    sizeMb: null,
    repoId: "ComfyUI 指向 / 完整下载 + 官方仓小件",
    pointed: true,
    bigFilesSource: null,
    smallPiecesReady: null,
    pointedFiles: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  scenario.models = [];
});

describe("LocalImageSettingsSection 大件两源文案", () => {
  it("缺大件:按钮变「下载完整模型」且未就绪文案引导自足", () => {
    scenario.models = [baseRow({})];
    render(<LocalImageSettingsSection />);
    expect(screen.getByText("下载完整模型(~37GB)")).toBeTruthy();
    expect(screen.getByText(/未下载（可完整下载自足）/)).toBeTruthy();
  });

  it("缺大件时下载按钮不受服务运行状态钳制(干净机器可自举)", () => {
    scenario.models = [baseRow({})];
    render(<LocalImageSettingsSection />);
    const button = screen.getByText("下载完整模型(~37GB)").closest("button");
    expect(button).not.toBeNull();
    expect(button?.hasAttribute("disabled")).toBe(false);
  });

  it("ComfyUI 指向就绪:沿用「已就绪（指向 ComfyUI 路径）」并展示实际路径", () => {
    scenario.models = [
      baseRow({
        downloaded: true,
        sizeMb: 36560,
        bigFilesSource: "comfyui",
        smallPiecesReady: true,
        pointedFiles: [
          "/Users/x/Project/ComfyUI/models/diffusion_models/qwen_image_edit_2511_Q8_0.gguf",
          "/Users/x/Project/ComfyUI/models/text_encoders/qwen_2.5_vl_7b.safetensors",
        ],
      }),
    ];
    render(<LocalImageSettingsSection />);
    expect(screen.getByText(/已就绪（指向 ComfyUI 路径）/)).toBeTruthy();
    expect(
      screen.getByText(
        "/Users/x/Project/ComfyUI/models/diffusion_models/qwen_image_edit_2511_Q8_0.gguf",
      ),
    ).toBeTruthy();
  });

  it("自足就绪:显示「已就绪（本地完整下载）」并展示应用缓存路径", () => {
    scenario.models = [
      baseRow({
        downloaded: true,
        sizeMb: 36560,
        bigFilesSource: "app-cache",
        smallPiecesReady: true,
        pointedFiles: [
          "/Users/x/Library/Application Support/漫影工作室/model/imagegen/models--unsloth--Qwen-Image-Edit-2511-GGUF/snapshots/main/qwen-image-edit-2511-Q8_0.gguf",
          "/Users/x/Library/Application Support/漫影工作室/model/imagegen/models--Comfy-Org--Qwen-Image_ComfyUI/snapshots/main/split_files/text_encoders/qwen_2.5_vl_7b.safetensors",
        ],
      }),
    ];
    render(<LocalImageSettingsSection />);
    expect(screen.getByText(/已就绪（本地完整下载）/)).toBeTruthy();
    expect(
      screen.getByText(/models--unsloth--Qwen-Image-Edit-2511-GGUF/),
    ).toBeTruthy();
  });

  it("FLUX.2 大件已就绪但小件缺失:按引擎显示 400MB", () => {
    scenario.models = [
      baseRow({
        modelName: "flux2-klein-9b",
        label: "FLUX.2 Klein 9B",
        downloaded: true,
        sizeMb: 35000,
        smallPiecesReady: false,
        pointedFiles: [
          "/Users/x/ComfyUI/models/diffusion_models/flux2_klein_9b.safetensors",
        ],
      }),
    ];
    render(<LocalImageSettingsSection />);
    expect(screen.getByText(/待补齐小件\(~400MB\)/)).toBeTruthy();
    expect(screen.getByText("补齐小件(~400MB)")).toBeTruthy();
  });

  it("Krea2 缺大件:显示 35GB 完整模型容量", () => {
    scenario.models = [
      baseRow({
        modelName: "krea2-turbo",
        label: "Krea2 Turbo",
        downloaded: false,
        pointed: false,
      }),
    ];
    render(<LocalImageSettingsSection />);
    expect(screen.getByText("下载完整模型(~35GB)")).toBeTruthy();
  });

  it("ComfyUI 桥不再在本区展示(移至「MCP 服务」tab 的服务连接分组)", () => {
    scenario.models = [
      baseRow({
        modelName: "comfyui-bridge",
        label: "ComfyUI 桥接（多参考编辑）",
        downloaded: true,
        pointed: false,
        bigFilesSource: "comfyui-service",
        comfyuiVersion: "0.34.0",
        pointedFiles: ["http://127.0.0.1:8000"],
      }),
    ];
    render(<LocalImageSettingsSection />);
    expect(screen.queryByText(/ComfyUI 桥接/)).toBeNull();
    expect(screen.queryByText(/已就绪（ComfyUI/)).toBeNull();
  });
});
