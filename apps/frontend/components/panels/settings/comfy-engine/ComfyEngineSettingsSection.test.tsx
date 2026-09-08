// @vitest-environment jsdom

// ComfyEngineSettingsSection 组件测试:未安装/下载中/需准备/就绪/可更新状态机、
// 端口与模型目录行、更新链报告/失败回滚、插件子区块(搜索/展开/卸载引用警告)、
// 核弹复位二次确认、依赖体检报告。hook 整体 mock(照 LocalImageSettingsSection 模式)。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComfyEngineStatus } from "./comfy-engine-contract";

const scenario = vi.hoisted(() => ({
  status: null as ComfyEngineStatus | null,
  activeJob: null as import("./comfy-engine-contract").ComfyEngineJob | null,
  updateReport: null as import("./comfy-engine-contract").ComfyEngineUpdateReport | null,
  doctorReport: null as import("./comfy-engine-contract").ComfyDoctorReport | null,
  plugins: [] as import("./comfy-engine-contract").ComfyPluginInfo[],
  catalog: [] as import("./comfy-engine-contract").ComfyCatalogEntry[],
  pluginUsage: { workflows: [] as Array<{ id: string; name: string }> },
  snapshots: [] as import("./comfy-engine-contract").ComfySnapshotEntry[],
}));

const actions = vi.hoisted(() => ({
  installEngine: vi.fn(async () => undefined),
  updateEngine: vi.fn(async () => undefined),
  resetEngine: vi.fn(async () => undefined),
  rollbackUpdate: vi.fn(async () => undefined),
  rollbackTo: vi.fn(async () => undefined),
  setLaunchArgs: vi.fn(async () => undefined),
  refreshSnapshots: vi.fn(async () => undefined),
  cleanOrphans: vi.fn(async () => ({ removed: [] })),
  checkUpdate: vi.fn(async () => undefined),
  setModelsDir: vi.fn(async () => true),
  runDoctor: vi.fn(async () => undefined),
  startService: vi.fn(async () => undefined),
  stopService: vi.fn(async () => undefined),
  searchCatalog: vi.fn(async () => undefined),
  installPlugin: vi.fn(async () => undefined),
  updatePlugin: vi.fn(async () => undefined),
  uninstallPlugin: vi.fn(async () => true),
  getPluginUsage: vi.fn(async () => scenario.pluginUsage),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("./useComfyEngineSettings", () => ({
  useComfyEngineSettings: () => ({
    hasBridge: true,
    status: scenario.status,
    activeJob: scenario.activeJob,
    updateCheck: null,
    updateReport: scenario.updateReport,
    pluginInstallReport: null,
    plugins: scenario.plugins,
    catalog: scenario.catalog,
    categories: [...new Set(scenario.catalog.map((entry) => entry.category).filter(Boolean))] as string[],
    doctorReport: scenario.doctorReport,
    isCheckingUpdate: false,
    isSavingModelsDir: false,
    isRunningDoctor: false,
    isStartingService: false,
    isRollingBack: false,
    snapshots: scenario.snapshots,
    ...actions,
  }),
}));

import { ComfyEngineSettingsSection } from "./ComfyEngineSettingsSection";

function readyStatus(overrides: Partial<ComfyEngineStatus> = {}): ComfyEngineStatus {
  return {
    installed: true,
    version: "0.34.0",
    latest: null,
    state: "ready",
    port: 17599,
    modelsDir: "/tmp/comfyui/models",
    defaultModelsDir: "/tmp/comfyui/models",
    serviceRunning: false,
    pluginCount: 2,
    updateAvailable: false,
    lastCheckAt: null,
    message: null,
    installDir: "/tmp/comfyui",
    torch: null,
    launchArgs: null,
    ...overrides,
  };
}

/** 组件暴露语义化 data-comfy-* 钩子(照 data-capability-pill 惯例),按属性取元素。 */
function comfyEl(name: string, value?: string): HTMLElement {
  const selector = value ? `[data-comfy-${name}="${value}"]` : `[data-comfy-${name}]`;
  const el = document.querySelector(selector);
  if (!el) throw new Error(`${selector} 未找到`);
  return el as HTMLElement;
}

function comfyQuery(name: string): HTMLElement | null {
  return document.querySelector(`[data-comfy-${name}]`) as HTMLElement | null;
}

afterEach(() => {
  cleanup();
  scenario.status = null;
  scenario.activeJob = null;
  scenario.updateReport = null;
  scenario.doctorReport = null;
  scenario.plugins = [];
  scenario.catalog = [];
  scenario.pluginUsage = { workflows: [] };
  vi.clearAllMocks();
});

describe("ComfyEngineSettingsSection 状态机", () => {
  it("未安装:展示体积提示 + 安装按钮,点击触发安装任务", () => {
    scenario.status = readyStatus({ installed: false, state: "not-installed", version: null, port: null, modelsDir: null });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText(/引擎尚未安装/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /安装引擎/ }));
    expect(actions.installEngine).toHaveBeenCalledOnce();
    // 未安装时不出服务行/版本行
    expect(screen.queryByText("当前版本")).toBeNull();
  });

  it("下载中:进度卡显示阶段大白话与百分比", () => {
    scenario.status = readyStatus({ installed: false, state: "not-installed" });
    scenario.activeJob = {
      jobId: "j1",
      kind: "install",
      state: "running",
      progress: 42,
      stage: "dependencies",
      message: null,
      report: null,
    };
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("安装依赖…")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("需准备(装了一半):大白话原因 + 继续安装按钮", () => {
    scenario.status = readyStatus({
      state: "needs-setup",
      message: "下载中断了,已装的部分保留;点「继续安装」会从断点续上。",
    });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText(/下载中断了/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /继续安装/ }));
    expect(actions.installEngine).toHaveBeenCalledOnce();
  });

  it("状态未知(sidecar未起):检查中,不误导成未安装/不出现安装按钮;标签栏结构照常出现", () => {
    scenario.status = null;
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getAllByText(/正在确认引擎状态/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/安装引擎/)).toBeNull();
    expect(screen.queryByText(/首次安装约需数 GB/)).toBeNull();
    // 09-08 实弹根修:冷启动真空窗里展开卡不能空无一物——四个标签页先挂载,
    // 页体用占位文案,状态确认后自动填充(否则用户以为没做逻辑)。
    expect(document.querySelectorAll("[data-comfy-tab]")).toHaveLength(4);
    expect(screen.getByText(/确认后这里会展示版本与更新信息/)).toBeTruthy();
    expect(screen.queryByText(/当前版本/)).toBeNull();
  });

  it("已就绪但服务未跑:副标「准备运行时」+ 启动服务按钮,端口只读展示(启动参数页)", () => {
    scenario.status = readyStatus({ serviceRunning: false });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("服务未启动")).toBeTruthy();
    fireEvent.click(comfyEl("tab", "launch"));
    expect(screen.getByDisplayValue("17599")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /启动服务/ }));
    expect(actions.startService).toHaveBeenCalledOnce();
  });

  it("服务运行中:显示运行中与端口", () => {
    scenario.status = readyStatus({ serviceRunning: true });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("引擎服务运行中(127.0.0.1:17599)")).toBeTruthy();
  });
});

describe("ComfyEngineSettingsSection 版本与更新链", () => {
  it("版本行 + 自动静默检查 + 手动检查;发现新版出「更新到最新」按钮", async () => {
    scenario.status = readyStatus({ updateAvailable: true, latest: "0.34.5" });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText(/当前版本/)).toBeTruthy();
    expect(screen.getByText("0.34.0")).toBeTruthy();
    expect(screen.getByText("可更新到 0.34.5")).toBeTruthy();

    // 更新页默认激活:挂载即自动静默检查一次(照 Comfy Desktop)
    await waitFor(() => expect(actions.checkUpdate).toHaveBeenCalledOnce());
    expect(actions.checkUpdate).toHaveBeenCalledWith({ silent: true });

    fireEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    expect(actions.checkUpdate).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /更新到最新/ }));
    expect(actions.updateEngine).toHaveBeenCalledOnce();
  });

  it("更新页(照 Comfy Desktop):已是最新徽章 + 上次检查时间 + 更新通道下拉", () => {
    scenario.status = readyStatus({
      latest: "0.34.0",
      updateAvailable: false,
      lastCheckAt: new Date(2026, 8, 8, 10, 30).getTime(),
    });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("已是最新")).toBeTruthy();
    expect(comfyQuery("last-check")?.textContent).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/);
    const channel = document.querySelector("[data-comfy-channel-select]") as HTMLSelectElement | null;
    expect(channel?.value).toBe("github-latest");
  });

  it("没查过:上次检查显示「还没检查过」,不出已是最新徽章", () => {
    scenario.status = readyStatus({}); // latest=null:从没查过
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("还没检查过")).toBeTruthy();
    expect(screen.queryByText("已是最新")).toBeNull();
  });

  it("切走再切回更新页不重复自动检查(ref 防重)", async () => {
    scenario.status = readyStatus({});
    render(<ComfyEngineSettingsSection embedded />);

    await waitFor(() => expect(actions.checkUpdate).toHaveBeenCalledOnce());
    fireEvent.click(comfyEl("tab", "launch"));
    fireEvent.click(comfyEl("tab", "update"));
    expect(actions.checkUpdate).toHaveBeenCalledOnce();
  });

  it("未安装:不自动检查更新", () => {
    scenario.status = readyStatus({ installed: false, state: "not-installed", version: null, port: null, modelsDir: null });
    render(<ComfyEngineSettingsSection embedded />);

    expect(actions.checkUpdate).not.toHaveBeenCalled();
  });

  it("更新链成功报告:版本/节点数变化 + 不兼容插件点名 + 回滚按钮", () => {
    scenario.status = readyStatus({ version: "0.34.5" });
    scenario.updateReport = {
      kind: "update",
      previousVersion: "0.34.0",
      newVersion: "0.34.5",
      nodeCountBefore: 2196,
      nodeCountAfter: 2210,
      incompatiblePlugins: ["图层样式"],
      compatiblePlugins: 3,
    };
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("已更新:0.34.0 → 0.34.5")).toBeTruthy();
    expect(screen.getByText(/节点总数 2196 → 2210/)).toBeTruthy();
    expect(screen.getByText(/以下插件与新版本不兼容/)).toBeTruthy();
    expect(screen.getByText(/图层样式/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /回滚到 0.34.0/ }));
    expect(actions.rollbackUpdate).toHaveBeenCalledOnce();
  });

  it("更新失败:大白话 + 一键回滚", () => {
    scenario.status = readyStatus({ state: "error", message: "新版校验没通过" });
    scenario.activeJob = {
      jobId: "j2",
      kind: "update",
      state: "failed",
      progress: 100,
      stage: "verify",
      message: "新版校验没通过:节点清单应答异常",
      report: null,
    };
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("新版校验没通过:节点清单应答异常")).toBeTruthy();
    expect(screen.getByText(/更新没成功,引擎当前不可用/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /一键回滚/ }));
    expect(actions.rollbackUpdate).toHaveBeenCalledOnce();
  });
});

describe("ComfyEngineSettingsSection 模型目录/体检/复位", () => {
  it("模型目录行:输入自定义路径保存", async () => {
    scenario.status = readyStatus();
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "storage"));

    const input = comfyEl("models-dir-input") as HTMLInputElement;
    expect(input.value).toBe("/tmp/comfyui/models");
    fireEvent.change(input, { target: { value: "/现有模型库/sd-models" } });
    fireEvent.click(comfyEl("models-dir-save"));
    await waitFor(() => expect(actions.setModelsDir).toHaveBeenCalledWith("/现有模型库/sd-models"));
  });

  it("依赖体检:点击出报告(漂移大白话)", async () => {
    scenario.status = readyStatus();
    scenario.doctorReport = { missing: [], drifted: ["numpy(被外部顶到 2.1.0)"], orphan: [] };
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "snapshots"));

    fireEvent.click(screen.getByRole("button", { name: /开始体检/ }));
    expect(actions.runDoctor).toHaveBeenCalledOnce();
    expect(screen.getByText(/漂移 1 项/)).toBeTruthy();
    expect(screen.getByText(/numpy/)).toBeTruthy();
  });

  it("核弹复位:先弹二次确认,确认后才触发复位", async () => {
    scenario.status = readyStatus();
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "snapshots"));

    fireEvent.click(comfyEl("reset-button"));
    expect(actions.resetEngine).not.toHaveBeenCalled();
    expect(comfyEl("reset-dialog")).toBeTruthy();
    expect(screen.getByText("核弹复位引擎运行环境?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认复位" }));
    await waitFor(() => expect(actions.resetEngine).toHaveBeenCalledOnce());
  });
});

describe("ComfyEngineSettingsSection 插件子区块", () => {
  beforeEach(() => {
    scenario.status = readyStatus();
    scenario.plugins = [
      {
        id: "rgthree",
        name: "RG三节点集",
        description: "效率工具合集",
        license: "GPL-3.0",
        state: "installed",
        version: "1.0.0",
        deps: ["torch"],
        author: "rgthree",
        downloads: 1234567,
        category: "效率",
        nodeCount: 42,
      },
    ];
    scenario.catalog = [
      {
        id: "layerstyle",
        name: "图层样式",
        description: "上百个图像处理节点",
        license: "GPL-3.0",
        author: "chflame163",
        downloads: 987654,
        category: "画质",
        installedState: null,
        ref: "layerstyle",
        source: "curated",
      },
    ];
  });

  it("已装行胶囊「已装 42 节点」;可装行「可安装」;license 徽章", () => {
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("已装 42 节点")).toBeTruthy();
    expect(screen.getByText("可安装")).toBeTruthy();
    expect(screen.getAllByText("GPL-3.0").length).toBeGreaterThanOrEqual(2);
  });

  it("行展开显示作者/下载量/依赖清单;可装行有安装按钮", () => {
    render(<ComfyEngineSettingsSection embedded />);

    fireEvent.click(screen.getByText("图层样式"));
    expect(screen.getByText("chflame163")).toBeTruthy();
    expect(screen.getByText("98.8 万")).toBeTruthy();
    expect(screen.getByText(/无额外依赖/)).toBeTruthy();

    fireEvent.click(comfyEl("plugin-install", "layerstyle"));
    expect(actions.installPlugin).toHaveBeenCalledWith("curated", "layerstyle");
  });

  it("搜索触发目录检索并本地过滤", () => {
    render(<ComfyEngineSettingsSection embedded />);

    const search = comfyEl("plugin-search");
    fireEvent.change(search, { target: { value: "图层" } });
    expect(actions.searchCatalog).toHaveBeenCalledWith("图层");
    // 本地过滤:匹配词保留,不匹配的已装行还在(已装清单不因搜索消失,目录行被过滤)
    expect(screen.getByText("图层样式")).toBeTruthy();
  });

  it("卸载:引用扫描 → 「1 个工作流在用它」点名警告 → 确认才卸载", async () => {
    scenario.pluginUsage = { workflows: [{ id: "wf-1", name: "Krea2-NSFW专业流" }] };
    render(<ComfyEngineSettingsSection embedded />);

    fireEvent.click(screen.getByText("RG三节点集"));
    fireEvent.click(comfyEl("plugin-uninstall", "rgthree"));
    expect(actions.getPluginUsage).toHaveBeenCalledWith("rgthree");

    await waitFor(() => expect(comfyEl("uninstall-dialog")).toBeTruthy());
    expect(screen.getByText("1 个工作流在用它,卸载后这些工作流会缺节点:")).toBeTruthy();
    expect(screen.getByText("Krea2-NSFW专业流")).toBeTruthy();
    expect(actions.uninstallPlugin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));
    await waitFor(() => expect(actions.uninstallPlugin).toHaveBeenCalledWith("rgthree"));
  });

  it("卸载取消:不触发卸载", async () => {
    render(<ComfyEngineSettingsSection embedded />);

    fireEvent.click(screen.getByText("RG三节点集"));
    fireEvent.click(comfyEl("plugin-uninstall", "rgthree"));
    await waitFor(() => expect(comfyEl("uninstall-dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "先不卸载" }));

    await waitFor(() => expect(comfyQuery("uninstall-dialog")).toBeNull());
    expect(actions.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("高级折叠:git 地址安装(第三方警告文案在)", () => {
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText(/第三方代码警告/)).toBeTruthy();
    const refInput = comfyEl("plugin-advanced-ref");
    fireEvent.change(refInput, { target: { value: "https://example.test/comfyui-x" } });
    fireEvent.click(comfyEl("plugin-advanced-install"));
    expect(actions.installPlugin).toHaveBeenCalledWith("git", "https://example.test/comfyui-x");
  });
});

// ── 09-08 映射表补口:高级设置区 + 快照区 ──
describe("ComfyEngineSettingsSection 标签页布局(照 ComfyUI Desktop)", () => {
  beforeEach(() => {
    scenario.status = readyStatus({ torch: "2.13.0", launchArgs: { vramPolicy: "gpu-only", attentionMode: "pytorch-cross-attention", reserveVramGb: 16 } });
    scenario.snapshots = [];
  });

  it("标签栏四页(更新/启动参数/快照/存储)渲染,更新页含 PyTorch 版本块", async () => {
    render(<ComfyEngineSettingsSection />);
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    expect(comfyEl("tab", "update")).toBeTruthy();
    expect(comfyEl("tab", "launch")).toBeTruthy();
    expect(comfyEl("tab", "snapshots")).toBeTruthy();
    expect(comfyEl("tab", "storage")).toBeTruthy();
    await waitFor(() => expect(comfyEl("torch")?.textContent).toContain("2.13.0"));
  });

  it("启动参数页:端口+显存策略/加速方式下拉,保存传档位", async () => {
    render(<ComfyEngineSettingsSection />);
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "launch"));
    expect(comfyEl("port-input")).toBeTruthy();
    expect(comfyEl("vram-select")).toBeTruthy();
    expect(comfyEl("attention-select")).toBeTruthy();
    expect(comfyEl("reserve-input")).toBeTruthy();
    expect((comfyEl("vram-select") as HTMLSelectElement).value).toBe("gpu-only");
    expect((comfyEl("attention-select") as HTMLSelectElement).value).toBe("pytorch-cross-attention");
    expect((comfyEl("reserve-input") as HTMLInputElement).value).toBe("16");
    fireEvent.change(comfyEl("reserve-input"), { target: { value: "12" } });
    fireEvent.click(comfyEl("advanced-save"));
    await waitFor(() =>
      expect(actions.setLaunchArgs).toHaveBeenCalledWith(
        expect.objectContaining({ vramPolicy: "gpu-only", attentionMode: "pytorch-cross-attention", reserveVramGb: 12 }),
      ));
  });

  it("快照页:大白话原因+回滚传 id;体检/复位同页", async () => {
    scenario.snapshots = [
      { id: "snap-9", createdAt: 1788835819800, reason: "plugin-uninstall:rgthree-comfy", version: "v0.34.6", full: false },
    ];
    render(<ComfyEngineSettingsSection />);
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "snapshots"));
    await waitFor(() => expect(screen.getByText(/卸载插件 rgthree-comfy 前/)).toBeTruthy());
    expect(screen.getByText("依赖体检")).toBeTruthy();
    expect(comfyEl("reset-button")).toBeTruthy();
    fireEvent.click(comfyEl("snapshot-rollback"));
    await waitFor(() => expect(actions.rollbackTo).toHaveBeenCalledWith("snap-9"));
  });

  it("存储页:模型目录输入+保存", async () => {
    render(<ComfyEngineSettingsSection />);
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "storage"));
    expect(comfyEl("models-dir-input")).toBeTruthy();
    fireEvent.change(comfyEl("models-dir-input"), { target: { value: "/Users/x/models" } });
    fireEvent.click(comfyEl("models-dir-save"));
    await waitFor(() => expect(actions.setModelsDir).toHaveBeenCalledWith("/Users/x/models"));
  });
});
