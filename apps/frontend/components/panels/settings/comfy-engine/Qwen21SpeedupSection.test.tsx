// @vitest-environment jsdom

// Qwen21SpeedupSection 组件测试(照 ComfyEngineSettingsSection.test.tsx 口径):
// 两行资产状态机(加速 LoRA 在位真值/TE-Speed 台账判据)、已装态如实显示
// (viggle r64 件真名+真字节)、未装态不放死按钮、禁假绿(无节点不亮绿)、
// 无桥态、纯函数推导(含下载中分支经注入 kind 验证——生产通道接入前的
// 状态机佐证)。组件吃 prop 控制器,直接传假控制器对象,不 mock hook。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComfyEngineJob,
  ComfyEngineJobKind,
  ComfyModelsReply,
  ComfyPluginInfo,
} from "./comfy-engine-contract";
import type { ComfyEngineSettingsController } from "./useComfyEngineSettings";
import {
  Qwen21SpeedupSection,
  deriveQwen21LoraStatus,
  deriveQwen21SectionPill,
  deriveQwen21TeSpeedState,
  formatQwen21DownloadingLabel,
  QWEN21_TE_SPEED_PLUGIN_ID,
} from "./Qwen21SpeedupSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 装机真值(research/02 + 09-24 引擎家实查):viggle r64 件名与字节。 */
const VIGGLE_R64_FILE = {
  name: "Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors",
  sizeBytes: 339_832_808,
};

function modelsReply(loraFiles: Array<{ name: string; sizeBytes: number }> = []): ComfyModelsReply {
  return {
    modelsDir: "/tmp/comfyui/models",
    groups: [
      { category: "diffusion_models", files: [{ name: "qwen21_main.safetensors", sizeBytes: 1 }] },
      { category: "loras", files: loraFiles },
    ],
    totalBytes: 1,
  };
}

function tePlugin(overrides: Partial<ComfyPluginInfo> = {}): ComfyPluginInfo {
  return {
    id: QWEN21_TE_SPEED_PLUGIN_ID,
    name: "TE-Speed-QwenImage21",
    description: "",
    license: "未标明",
    state: "installed",
    version: null,
    deps: [],
    author: null,
    downloads: null,
    category: null,
    nodeCount: 3,
    ...overrides,
  };
}

/** 假控制器:只给组件会读的面(models/plugins/activeJob/hasBridge+两个拉取函数)。 */
function makeController(
  overrides: Partial<Pick<ComfyEngineSettingsController, "hasBridge" | "models" | "plugins" | "activeJob" | "loadModels" | "refreshPlugins">> = {},
): ComfyEngineSettingsController {
  return {
    hasBridge: true,
    models: null,
    plugins: [],
    activeJob: null,
    loadModels: vi.fn(async () => undefined),
    refreshPlugins: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ComfyEngineSettingsController;
}

function el(name: string, value?: string): HTMLElement {
  const selector = value ? `[data-qwen21-${name}="${value}"]` : `[data-qwen21-${name}]`;
  const found = document.querySelector(selector);
  if (!found) throw new Error(`${selector} 未找到`);
  return found as HTMLElement;
}

describe("Qwen21SpeedupSection(渲染)", () => {
  it("viggle r64 已装态如实显示:真文件名+真字节换算大小,零统计提示行", () => {
    render(
      <Qwen21SpeedupSection
        engine={makeController({
          models: modelsReply([VIGGLE_R64_FILE]),
          plugins: [tePlugin({ id: "comfyui-kjnodes", name: "kjnodes", nodeCount: 120 })],
        })}
      />,
    );

    expect(el("lora-pill", "installed").textContent).toBe("已装");
    // 文件级证据照引擎家实查字节:339,832,808 B = 324 MB(taxonomy 换算口径)
    expect(screen.getByText(/Qwen-Image-2\.1-viggle-turbo-4step-lora-r64\.safetensors/).textContent).toContain(
      "324 MB",
    );
    // 成功态零统计提示行:未装指引文案不应出现
    expect(document.querySelector("[data-qwen21-lora-hint]")).toBeNull();
  });

  it("TE-Speed 未装(台账无此插件)= 未装态,不冒充已装;给出大白话指引", () => {
    render(
      <Qwen21SpeedupSection
        engine={makeController({
          models: modelsReply([VIGGLE_R64_FILE]),
          plugins: [tePlugin({ id: "comfyui-kjnodes", name: "kjnodes", nodeCount: 120 })],
        })}
      />,
    );

    expect(el("te-pill", "missing").textContent).toBe("未装");
    expect(el("te-hint").textContent).toContain("装好且本机验证通过后才显示已装");
  });

  it("清单未取到 = 检查中,不误报未装", () => {
    render(<Qwen21SpeedupSection engine={makeController()} />);

    expect(el("lora-pill", "checking").textContent).toBe("检查中");
    expect(el("te-pill", "checking").textContent).toBe("检查中");
  });

  it("loras 目录在而 viggle 件缺 = 未装;未装态无下载按钮(后端无通道,禁死按钮)", () => {
    render(
      <Qwen21SpeedupSection
        engine={makeController({
          models: modelsReply([{ name: "别的lora.safetensors", sizeBytes: 100 }]),
          plugins: [tePlugin({ id: "comfyui-kjnodes", name: "kjnodes", nodeCount: 120 })],
        })}
      />,
    );

    expect(el("lora-pill", "missing").textContent).toBe("未装");
    expect(el("lora-hint").textContent).toContain("loras");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("TE-Speed 台账在册但节点未注册 = 不可用(MPS),禁假绿", () => {
    render(
      <Qwen21SpeedupSection
        engine={makeController({
          models: modelsReply([VIGGLE_R64_FILE]),
          plugins: [tePlugin({ nodeCount: null })],
        })}
      />,
    );

    expect(el("te-pill", "unavailable").textContent).toBe("不可用(MPS)");
    expect(el("te-unavailable").textContent).toContain("Mac 芯片");
    // 不亮绿:已装 pill 不应存在
    expect(document.querySelector('[data-qwen21-te-pill="installed"]')).toBeNull();
  });

  it("TE-Speed 装时差分注册过节点(nodeCount>0)= 已装;已装态零提示行", () => {
    render(
      <Qwen21SpeedupSection
        engine={makeController({
          models: modelsReply([VIGGLE_R64_FILE]),
          plugins: [tePlugin()],
        })}
      />,
    );

    expect(el("te-pill", "installed").textContent).toBe("已装");
    expect(document.querySelector("[data-qwen21-te-hint]")).toBeNull();
    expect(document.querySelector("[data-qwen21-te-unavailable]")).toBeNull();
  });

  it("TE-Speed 目录缺失(install-failed)= 安装失败", () => {
    render(
      <Qwen21SpeedupSection
        engine={makeController({
          models: modelsReply([VIGGLE_R64_FILE]),
          plugins: [tePlugin({ state: "install-failed" })],
        })}
      />,
    );

    expect(el("te-pill", "failed").textContent).toBe("安装失败");
    expect(el("te-failed").textContent).toContain("重装");
  });

  it("无桥(非桌面环境)= 仅桌面可用说明,不渲染资产行", () => {
    render(<Qwen21SpeedupSection engine={makeController({ hasBridge: false })} />);

    expect(el("speedup-bridge-missing").textContent).toContain("仅在桌面应用中可用");
    expect(document.querySelector("[data-qwen21-lora-row]")).toBeNull();
  });

  it("挂载即拉模型清单与插件台账各一次(展开重探纪律)", () => {
    const loadModels = vi.fn(async () => undefined);
    const refreshPlugins = vi.fn(async () => undefined);
    render(<Qwen21SpeedupSection engine={makeController({ loadModels, refreshPlugins })} />);

    expect(loadModels).toHaveBeenCalledTimes(1);
    expect(refreshPlugins).toHaveBeenCalledTimes(1);
  });
});

describe("Qwen21SpeedupSection(纯函数状态机)", () => {
  it("LoRA:models null → checking;有 viggle 件 → installed(带文件真值)", () => {
    expect(deriveQwen21LoraStatus(null, null)).toEqual({ state: "checking", file: null, progress: null });
    const installed = deriveQwen21LoraStatus(modelsReply([VIGGLE_R64_FILE]), null);
    expect(installed.state).toBe("installed");
    expect(installed.file?.name).toBe(VIGGLE_R64_FILE.name);
    expect(installed.file?.sizeBytes).toBe(VIGGLE_R64_FILE.sizeBytes);
  });

  it("LoRA:清单在而件缺 → missing;识别大小写不敏感且不锁 r64(社区变体同判在位)", () => {
    expect(deriveQwen21LoraStatus(modelsReply([]), null).state).toBe("missing");
    const variant = deriveQwen21LoraStatus(
      modelsReply([{ name: "qwen-viggle-turbo-4step-lora-r32.safetensors", sizeBytes: 1 }]),
      null,
    );
    expect(variant.state).toBe("installed");
  });

  it("LoRA 下载中分支:匹配 kind 的运行中 job → downloading+进度透传(生产 kind 集现为空,通道接入后加 kind 即点亮)", () => {
    const job = (kind: ComfyEngineJobKind, state: ComfyEngineJob["state"] = "running"): ComfyEngineJob => ({
      jobId: "job-1",
      kind,
      state,
      progress: 42.4,
      stage: null,
      message: null,
      report: null,
    });
    // 默认空集:任何 job 都不冒充 LoRA 下载(引擎安装/插件克隆不点亮本行)
    expect(deriveQwen21LoraStatus(modelsReply([]), job("install")).state).toBe("missing");
    expect(deriveQwen21LoraStatus(modelsReply([]), job("plugin-install")).state).toBe("missing");
    // 注入未来资产下载 kind:状态机如实给出下载中+百分比
    const fetchKinds = new Set<ComfyEngineJobKind>(["plugin-install"]);
    expect(deriveQwen21LoraStatus(modelsReply([]), job("plugin-install"), fetchKinds)).toEqual({
      state: "downloading",
      file: null,
      progress: 42.4,
    });
    // job 终态(非 running)不点亮;已装优先于下载中
    expect(deriveQwen21LoraStatus(modelsReply([]), job("plugin-install", "succeeded"), fetchKinds).state).toBe("missing");
    expect(deriveQwen21LoraStatus(modelsReply([VIGGLE_R64_FILE]), job("plugin-install"), fetchKinds).state).toBe("installed");
    expect(formatQwen21DownloadingLabel(42.4)).toBe("下载中 42%");
    expect(formatQwen21DownloadingLabel(null)).toBe("下载中");
  });

  it("TE:空台账=checking;无此件=missing;id 大小写不敏感", () => {
    expect(deriveQwen21TeSpeedState(null)).toBe("checking");
    expect(deriveQwen21TeSpeedState([])).toBe("checking");
    expect(deriveQwen21TeSpeedState([tePlugin({ id: "comfyui-kjnodes", name: "kjnodes" })])).toBe("missing");
    expect(deriveQwen21TeSpeedState([tePlugin({ id: "te-speed-qwenimage21" })])).toBe("installed");
  });

  it("行胶囊聚合:检查中>下载中>已就绪>未装齐>未安装", () => {
    const installed = deriveQwen21LoraStatus(modelsReply([VIGGLE_R64_FILE]), null);
    const missing = deriveQwen21LoraStatus(modelsReply([]), null);
    const checking = deriveQwen21LoraStatus(null, null);
    expect(deriveQwen21SectionPill(installed, "installed")).toBe("ready");
    expect(deriveQwen21SectionPill(installed, "missing")).toBe("partial");
    expect(deriveQwen21SectionPill(missing, "missing")).toBe("none");
    expect(deriveQwen21SectionPill(missing, "unavailable")).toBe("none");
    expect(deriveQwen21SectionPill(checking, "installed")).toBe("checking");
    expect(deriveQwen21SectionPill(installed, "checking")).toBe("checking");
  });
});
