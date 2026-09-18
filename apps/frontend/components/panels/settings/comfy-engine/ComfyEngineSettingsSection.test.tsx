// @vitest-environment jsdom

// ComfyEngineSettingsSection 组件测试:未安装/下载中/需准备/就绪/可更新状态机、
// 端口与模型目录行、更新链报告/失败回滚、插件子区块(搜索/展开/卸载引用警告)、
// 彻底重装二次确认、引擎检查报告。hook 整体 mock(历史模式沿用)。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComfyEngineStatus } from "./comfy-engine-contract";
import { createMockComfyEngineClient } from "./mock-comfy-engine-client";

// 存储位置卡(ComfyEngineStoragePaths)独立解析 window.comfyEngine,
// hook 被整体 mock 不覆盖它——装上 mock client 让卡随页渲染
beforeEach(() => {
  (window as { comfyEngine?: unknown }).comfyEngine = createMockComfyEngineClient();
});

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
  setLaunchConfig: vi.fn(async () => undefined),
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
const scenarioModels = vi.hoisted(() => ({ reply: null as import("./comfy-engine-contract").ComfyModelsReply | null }));
const modelActions = vi.hoisted(() => ({ loadModels: vi.fn(async () => undefined) }));

vi.mock("./useComfyEngineSettings", () => ({
  useComfyEngineSettings: () => ({
    models: scenarioModels.reply,
    loadModels: modelActions.loadModels,
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
    aheadBy: null,
    lastCheckAt: null,
    message: null,
    installDir: "/tmp/comfyui",
    torch: null,
    launchArgs: null,
    envVars: null,
    portConflictPolicy: null,
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
  delete (window as { comfyEngine?: unknown }).comfyEngine;
  scenario.status = null;
  scenario.activeJob = null;
  scenario.updateReport = null;
  scenario.doctorReport = null;
  scenario.plugins = [];
  scenario.catalog = [];
  scenarioModels.reply = null;
  modelActions.loadModels.mockClear();
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
    // 09-08 实弹根修:冷启动真空窗里展开卡不能空无一物——标签页先挂载,
    // 页体用占位文案,状态确认后自动填充(否则用户以为没做逻辑)。
    // 09-09 增「模型」页置首 → 五页。
    expect(document.querySelectorAll("[data-comfy-tab]")).toHaveLength(5);
    expect(screen.getByText(/确认后这里会展示版本与更新信息/)).toBeTruthy();
    expect(screen.queryByText(/当前版本/)).toBeNull();
  });

  it("已就绪但服务未跑:副标「准备运行时」+ 启动服务按钮(端口镜像行已退役,看页顶状态行)", () => {
    scenario.status = readyStatus({ serviceRunning: false });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("服务未启动")).toBeTruthy();
    fireEvent.click(comfyEl("tab", "launch"));
    expect(document.querySelector("[data-comfy-port-input]")).toBeNull();
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
  it("默认落「模型」页不自动检查;切「更新」页才静默检查,发现新版出「更新到最新」按钮", async () => {
    scenario.status = readyStatus({ updateAvailable: true, latest: "0.34.5" });
    render(<ComfyEngineSettingsSection embedded />);

    // 09-09 模型页置默认:挂载不触发 GitHub 检查,更新页未激活时版本行不在。
    expect(actions.checkUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText(/当前版本/)).toBeNull();

    fireEvent.click(comfyEl("tab", "update"));
    expect(screen.getByText(/当前版本/)).toBeTruthy();
    expect(screen.getByText("0.34.0")).toBeTruthy();
    expect(screen.getByText("可更新到 0.34.5")).toBeTruthy();

    // 进更新页即自动静默检查一次(照 Comfy Desktop)
    await waitFor(() => expect(actions.checkUpdate).toHaveBeenCalledOnce());
    expect(actions.checkUpdate).toHaveBeenCalledWith({ silent: true });

    // 09-09 用户裁定:检查更新/更新通道等运维控件全撤,只剩自动检查+一键更新
    expect(screen.queryByRole("button", { name: /检查更新/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /更新到最新/ }));
    expect(actions.updateEngine).toHaveBeenCalledOnce();
  });

  it("已在最新 tag 上仅 master 领先:徽章说「master 有新提交」,不出「可更新到 ==当前版本」怪相(09-11)", () => {
    // 实弹:v0.35.1 已装、远端 master 领先但领先数算不出(aheadBy null)、
    // latest tag == 当前版本 → 旧文案「可更新到 v0.35.1」自相矛盾
    scenario.status = readyStatus({
      version: "v0.35.1",
      updateAvailable: true,
      latest: "v0.35.1",
      aheadBy: null,
    });
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    expect(screen.getByText("master 有新提交")).toBeTruthy();
    expect(screen.queryByText("可更新到 v0.35.1")).toBeNull();
  });

  it("同 release 但 master 领先:徽章「可更新(+N 个新提交)」+ 更新按钮(09-09 提交口径)", () => {
    scenario.status = readyStatus({ updateAvailable: true, latest: "0.34.0", aheadBy: 87 });
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    expect(screen.getByText("可更新(+87 个新提交)")).toBeTruthy();
    expect(screen.getByRole("button", { name: /更新到最新/ })).toBeTruthy();
  });

  it("版本号后带 GitHub 链接:点击走 openExternalLink(09-09)", () => {
    const openExternalLink = vi.fn(async () => ({ success: true }));
    window.appUpdater = { openExternalLink } as unknown as typeof window.appUpdater;
    scenario.status = readyStatus({ version: "v0.34.6" });
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    const link = comfyEl("version-link");
    expect(link.getAttribute("title")).toBe("https://github.com/Comfy-Org/ComfyUI/tree/v0.34.6");
    fireEvent.click(link);
    expect(openExternalLink).toHaveBeenCalledWith("https://github.com/Comfy-Org/ComfyUI/tree/v0.34.6");
    delete window.appUpdater;
  });

  it("已是最新徽章;上次检查时间与更新通道下拉已撤", () => {
    scenario.status = readyStatus({
      latest: "0.34.0",
      updateAvailable: false,
      lastCheckAt: new Date(2026, 8, 8, 10, 30).getTime(),
    });
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    expect(screen.getByText("已是最新")).toBeTruthy();
    expect(comfyQuery("last-check")).toBeNull();
    expect(document.querySelector("[data-comfy-channel-select]")).toBeNull();
  });

  it("没查过:不出已是最新徽章", () => {
    scenario.status = readyStatus({}); // latest=null:从没查过
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    expect(screen.queryByText("已是最新")).toBeNull();
  });

  it("切走再切回更新页不重复自动检查(ref 防重)", async () => {
    scenario.status = readyStatus({});
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

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

  it("更新链成功报告:版本/节点数变化 + 不兼容插件点名(09-09 撤回滚按钮)", () => {
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
  });

  it("更新失败:大白话 + 重试自愈指引(09-09 无快照无回滚)", () => {
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
    expect(screen.getByText(/更新没成功;重新点「更新到最新」会从断点续装/)).toBeTruthy();
  });
});

describe("ComfyEngineSettingsSection 模型目录/引擎修复", () => {
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

  it("引擎检查:点击出报告(版本不对大白话)", async () => {
    scenario.status = readyStatus();
    scenario.doctorReport = { missing: [], drifted: ["numpy(被外部顶到 2.1.0)"], orphan: [] };
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "snapshots"));

    fireEvent.click(screen.getByRole("button", { name: /开始检查/ }));
    expect(actions.runDoctor).toHaveBeenCalledOnce();
    expect(screen.getByText(/1 项版本不对/)).toBeTruthy();
    expect(screen.getByText(/numpy/)).toBeTruthy();
  });

  it("彻底重装:先弹二次确认,确认后才触发", async () => {
    scenario.status = readyStatus();
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "snapshots"));

    fireEvent.click(comfyEl("reset-button"));
    expect(actions.resetEngine).not.toHaveBeenCalled();
    expect(comfyEl("reset-dialog")).toBeTruthy();
    expect(screen.getByText("彻底重装引擎运行环境?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认重装" }));
    await waitFor(() => expect(actions.resetEngine).toHaveBeenCalledOnce());
  });
});

describe("ComfyEngineSettingsSection 插件子区块", () => {
  beforeEach(() => {
    scenario.status = readyStatus();
    // 区块折叠状态记 localStorage,清掉防跨用例污染(默认收起口径)
    window.localStorage.removeItem("comfy-plugin-block-open");
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

  // 09-09 区块默认收起:用例先展开(卸载弹窗类置顶不受影响);
  // 09-10 裁定:插件块收进「更新」页——先切页再展开
  const openPluginBlock = () => {
    fireEvent.click(comfyEl("tab", "update"));
    fireEvent.click(comfyEl("plugin-toggle"));
  };

  it("已装行胶囊「已装 42 节点」;可装行「可安装」;license 徽章", () => {
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    expect(screen.getByText("已装 42 节点")).toBeTruthy();
    expect(screen.getByText("可安装")).toBeTruthy();
    expect(screen.getAllByText("GPL-3.0").length).toBeGreaterThanOrEqual(2);
  });

  it("行展开显示作者/下载量/依赖清单;可装行有安装按钮", () => {
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    fireEvent.click(screen.getByText("图层样式"));
    expect(screen.getByText("chflame163")).toBeTruthy();
    expect(screen.getByText("98.8 万")).toBeTruthy();
    expect(screen.getByText(/无额外依赖/)).toBeTruthy();

    fireEvent.click(comfyEl("plugin-install", "layerstyle"));
    expect(actions.installPlugin).toHaveBeenCalledWith("curated", "layerstyle");
  });

  it("搜索触发目录检索并本地过滤(已装行同口径,09-10 根修)", () => {
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    const search = comfyEl("plugin-search");
    fireEvent.change(search, { target: { value: "图层" } });
    expect(actions.searchCatalog).toHaveBeenCalledWith("图层");
    // 已装行同样吃过滤:命中的目录行保留,不匹配的已装行(RG三节点集)消失
    expect(screen.getByText("图层样式")).toBeTruthy();
    expect(screen.queryByText("RG三节点集")).toBeNull();
  });

  it("搜索命中已装插件(id 也参与匹配):保留该行,其余隐藏;无命中出空状态", () => {
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    fireEvent.change(comfyEl("plugin-search"), { target: { value: "rgthree" } });
    expect(screen.getByText("RG三节点集")).toBeTruthy();
    expect(screen.queryByText("图层样式")).toBeNull();

    fireEvent.change(comfyEl("plugin-search"), { target: { value: "不存在的东西" } });
    expect(screen.getByText("没有匹配的插件")).toBeTruthy();
  });

  it("分类下拉同步过滤已装行", () => {
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    fireEvent.change(comfyEl("plugin-category"), { target: { value: "画质" } });
    expect(screen.getByText("图层样式")).toBeTruthy();
    expect(screen.queryByText("RG三节点集")).toBeNull();
  });

  it("Registry 小写 id 与已装目录名大小写不一:归一化去重,不再重复出「可安装」行(09-10 根修)", () => {
    scenario.plugins = [
      {
        id: "ComfyUI-Manager", // 台账键=目录名
        name: "插件管理器",
        description: "装/更/卸插件",
        license: "GPL-3.0",
        state: "installed",
        version: "3.41",
        deps: [],
        author: null,
        downloads: null,
        category: null,
        nodeCount: 12,
      },
    ];
    scenario.catalog = [
      {
        id: "comfyui-manager", // Registry 渠道小写 id
        name: "ComfyUI-Manager",
        description: "插件管理器(Registry)",
        license: "未标明",
        author: "ltdrdata",
        downloads: 1000000,
        category: null,
        installedState: null,
        ref: "comfyui-manager",
        source: "registry",
      },
    ];
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    // 只剩已装真身行;Registry 孪生按归一化 id 去重,不出现第二行「可安装」
    expect(screen.getByText("已装 12 节点")).toBeTruthy();
    expect(screen.queryByText("可安装")).toBeNull();
    expect(screen.queryByText("插件管理器(Registry)")).toBeNull();
  });

  it("策展 id 与仓库名不一致:按仓库地址去重,已装插件不以「可安装」孪生回流(09-19 根修)", () => {
    scenario.plugins = [
      {
        id: "Rebalance-Pack", // 台账键=目录名(派生自仓库尾段)
        name: "Krea2 提示重平衡",
        description: "十二带提示词重平衡",
        license: "Apache-2.0",
        state: "installed",
        version: "abc1234",
        deps: [],
        author: null,
        downloads: null,
        category: null,
        nodeCount: 4,
        repo: "https://github.com/nova452/Rebalance-Pack",
      },
    ];
    scenario.catalog = [
      {
        id: "ComfyUI-ConditioningKrea2Rebalance", // 策展 id 与目录名永远对不上
        name: "Krea2 提示重平衡",
        description: "十二带提示词重平衡(策展)",
        license: "Apache-2.0",
        author: "nova452",
        downloads: 1000,
        category: null,
        installedState: null,
        ref: "ComfyUI-ConditioningKrea2Rebalance",
        source: "curated",
        repo: "https://github.com/nova452/Rebalance-Pack",
      },
    ];
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    // 只剩已装真身行;策展孪生按仓库地址去重,不再出现可安装的第二行
    expect(screen.getByText("已装 4 节点")).toBeTruthy();
    expect(screen.queryByText("可安装")).toBeNull();
    expect(screen.queryByText("十二带提示词重平衡(策展)")).toBeNull();
  });

  it("已装清单暂空 + 目录行后端已标已装:显示「已安装」且不给安装钮(过渡形态)", () => {
    scenario.plugins = [];
    scenario.catalog = [
      {
        id: "comfyui-manager",
        name: "ComfyUI-Manager",
        description: "插件管理器",
        license: "未标明",
        author: "ltdrdata",
        downloads: 1000000,
        category: null,
        installedState: "installed", // 后端归一化比对后标已装
        ref: "comfyui-manager",
        source: "registry",
      },
    ];
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    expect(screen.getByText("已安装")).toBeTruthy();
    expect(document.querySelector('[data-comfy-plugin-install="comfyui-manager"]')).toBeNull();
  });

  it("详情展开:已装行显 GitHub 星标;星标/作者缺数据整行不显示(09-10 裁定)", () => {
    scenario.plugins = [
      {
        id: "ComfyUI-GGUF",
        name: "GGUF 量化支持",
        description: "本地大模型量化加载",
        license: "Apache-2.0",
        state: "installed",
        version: "2.0.0",
        deps: ["gguf"],
        author: "City",
        downloads: null,
        category: null,
        nodeCount: 8,
        stars: 25123,
      },
      {
        id: "bare-plugin",
        name: "无星插件",
        description: "没有 git 元数据的插件",
        license: "MIT",
        state: "installed",
        version: "1.0",
        deps: [],
        author: null,
        downloads: null,
        category: null,
        nodeCount: 2,
      },
    ];
    scenario.catalog = [];
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    // GGUF 行:作者 + GitHub 星标(2.5 万)都在
    fireEvent.click(screen.getByText("GGUF 量化支持"));
    expect(screen.getByText("City")).toBeTruthy();
    expect(screen.getByText("GitHub 星标")).toBeTruthy();
    expect(screen.getByText("2.5 万")).toBeTruthy();
    // 下载量已退役:已装行不出现该字段
    expect(screen.queryByText("下载量")).toBeNull();

    // 无数据行:作者/GitHub 星标/下载量三行全隐藏,只剩依赖清单
    fireEvent.click(screen.getByText("无星插件"));
    expect(screen.queryByText("未知")).toBeNull();
    expect(screen.queryByText("GitHub 星标")).toBeNull();
    expect(screen.getByText("无额外依赖")).toBeTruthy();
  });

  it("版本三件套(09-10 晚):当前/最新版本展示;落后出「可更新」胶囊+更新按钮可点", () => {
    scenario.plugins = [
      {
        id: "ComfyUI-GGUF",
        name: "GGUF 量化支持",
        description: "本地大模型量化加载",
        license: "Apache-2.0",
        state: "updatable",
        version: "1.9.0",
        deps: [],
        author: null,
        downloads: null,
        category: null,
        nodeCount: 8,
        stars: 3991,
        latestVersion: "2.0.0",
      },
    ];
    scenario.catalog = [];
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    expect(screen.getByText("可更新")).toBeTruthy();
    fireEvent.click(screen.getByText("GGUF 量化支持"));
    // 更新页里引擎自己的版本行也叫「当前版本」,断言取插件块内唯一值
    expect(screen.getByText("1.9.0")).toBeTruthy();
    expect(screen.getByText("最新版本")).toBeTruthy();
    expect(screen.getByText("2.0.0")).toBeTruthy();

    fireEvent.click(comfyEl("plugin-update", "ComfyUI-GGUF"));
    expect(actions.updatePlugin).toHaveBeenCalledWith("ComfyUI-GGUF");
  });

  it("卸载:引用扫描 → 「1 个工作流在用它」点名警告 → 确认才卸载", async () => {
    scenario.pluginUsage = { workflows: [{ id: "wf-1", name: "Krea2-NSFW专业流" }] };
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

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
    openPluginBlock();

    fireEvent.click(screen.getByText("RG三节点集"));
    fireEvent.click(comfyEl("plugin-uninstall", "rgthree"));
    await waitFor(() => expect(comfyEl("uninstall-dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "先不卸载" }));

    await waitFor(() => expect(comfyQuery("uninstall-dialog")).toBeNull());
    expect(actions.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("高级折叠:git 地址安装(第三方警告文案在)", () => {
    render(<ComfyEngineSettingsSection embedded />);
    openPluginBlock();

    expect(screen.getByText(/第三方代码警告/)).toBeTruthy();
    const refInput = comfyEl("plugin-advanced-ref");
    fireEvent.change(refInput, { target: { value: "https://example.test/comfyui-x" } });
    fireEvent.click(comfyEl("plugin-advanced-install"));
    expect(actions.installPlugin).toHaveBeenCalledWith("git", "https://example.test/comfyui-x");
  });

  it("生态插件只在「更新」页展示,其他页签不渲染(09-10 裁定)", () => {
    render(<ComfyEngineSettingsSection embedded />);

    // 默认「模型」页 + 启动参数/快照/存储页:插件块不在
    for (const tab of ["models", "launch", "snapshots", "storage"] as const) {
      fireEvent.click(comfyEl("tab", tab));
      expect(screen.queryByText("生态插件")).toBeNull();
    }
    fireEvent.click(comfyEl("tab", "update"));
    expect(screen.getByText("生态插件")).toBeTruthy();
  });

  it("区块默认收起:点标题行展开,再点收起", () => {
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    // 收起态:标题与已装计数在,搜索框/列表不在
    expect(screen.getByText("生态插件")).toBeTruthy();
    expect(comfyQuery("plugin-search")).toBeNull();

    openPluginBlock();
    expect(comfyEl("plugin-search")).toBeTruthy();

    fireEvent.click(comfyEl("plugin-toggle"));
    expect(comfyQuery("plugin-search")).toBeNull();
  });
});

// ── 09-19 统一进度位:引擎/插件任务共用卡顶一条进度条;任务互斥全局可视 ──
describe("ComfyEngineSettingsSection 统一进度与任务互斥", () => {
  beforeEach(() => {
    scenario.status = readyStatus({ updateAvailable: true, latest: "0.34.5" });
    window.localStorage.removeItem("comfy-plugin-block-open");
    scenario.plugins = [];
    scenario.catalog = [
      {
        id: "layerstyle",
        name: "图层样式",
        description: "上百个图像处理节点",
        license: "GPL-3.0",
        author: "chflame163",
        downloads: 987654,
        category: null,
        installedState: null,
        ref: "layerstyle",
        source: "curated",
      },
    ];
  });

  it("插件任务进行中:进度条在卡顶统一位置展示,插件区块内不再有第二条", () => {
    scenario.activeJob = {
      jobId: "j9",
      kind: "plugin-update",
      state: "running",
      progress: 45,
      stage: "pull",
      message: "拉取插件最新代码…",
      report: null,
    };
    render(<ComfyEngineSettingsSection embedded />);

    // 卡顶统一进度:种类小标题 + 后端阶段大白话 + 百分比
    expect(comfyEl("engine-progress")).toBeTruthy();
    expect(screen.getByText("正在更新插件")).toBeTruthy();
    expect(screen.getByText("拉取插件最新代码…")).toBeTruthy();
    expect(screen.getByText("45%")).toBeTruthy();
    // 旧插件区块内的第二条进度位已拆(09-19 裁定:进度只放一处)
    expect(document.querySelector("[data-comfy-plugin-job]")).toBeNull();
  });

  it("插件任务进行中:引擎「更新到最新」同步禁用(单任务闸互斥可视)", () => {
    scenario.activeJob = {
      jobId: "j10",
      kind: "plugin-install",
      state: "running",
      progress: 30,
      stage: "clone",
      message: "获取插件文件…",
      report: null,
    };
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));

    expect(screen.getByText("正在安装插件")).toBeTruthy();
    expect(screen.getByText("获取插件文件…")).toBeTruthy();
    expect(comfyEl("tab", "update")).toBeTruthy();
    const updateBtn = screen.getByRole("button", { name: /更新到最新/ }) as HTMLButtonElement;
    expect(updateBtn.disabled).toBe(true);
  });

  it("引擎更新进行中:插件安装/卸载钮同步禁用,不出现可点的假按钮", () => {
    scenario.activeJob = {
      jobId: "j11",
      kind: "update",
      state: "running",
      progress: 40,
      stage: "pull",
      message: "强制拉取新版 abc1234…",
      report: null,
    };
    render(<ComfyEngineSettingsSection embedded />);
    fireEvent.click(comfyEl("tab", "update"));
    fireEvent.click(comfyEl("plugin-toggle"));

    // 可装行展开:安装钮在但禁用(点了只会撞「已有任务在进行中」的时代结束)
    fireEvent.click(screen.getByText("图层样式"));
    const installBtn = document.querySelector("[data-comfy-plugin-install]") as HTMLButtonElement | null;
    expect(installBtn).toBeTruthy();
    expect(installBtn?.disabled).toBe(true);
  });

  it("插件任务失败:统一进度位显示失败大白话(红色),不再静默只剩 toast", () => {
    scenario.activeJob = {
      jobId: "j12",
      kind: "plugin-install",
      state: "failed",
      progress: 36,
      stage: null,
      message: "依赖冲突,已取消安装: 要装 numpy>=1.26",
      report: null,
    };
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText("正在安装插件")).toBeTruthy();
    expect(screen.getByText("依赖冲突,已取消安装: 要装 numpy>=1.26")).toBeTruthy();
    expect(comfyEl("engine-progress").className).toContain("destructive");
  });
});

// ── 09-08 映射表补口:高级设置区 + 快照区 ──
describe("ComfyEngineSettingsSection 标签页布局(照 ComfyUI Desktop)", () => {
  beforeEach(() => {
    scenario.status = readyStatus({ torch: "2.13.0", launchArgs: "--gpu-only --reserve-vram 16 --use-pytorch-cross-attention" });
    scenario.snapshots = [];
  });

  it("标签栏五页(模型/更新/启动参数/快照/存储)渲染,更新页含 PyTorch 版本块", async () => {
    render(<ComfyEngineSettingsSection />);
    fireEvent.click(comfyEl("tab", "update"));
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    expect(comfyEl("tab", "models")).toBeTruthy();
    expect(comfyEl("tab", "update")).toBeTruthy();
    expect(comfyEl("tab", "launch")).toBeTruthy();
    expect(comfyEl("tab", "snapshots")).toBeTruthy();
    expect(comfyEl("tab", "storage")).toBeTruthy();
    await waitFor(() => expect(comfyEl("torch")?.textContent).toContain("2.13.0"));
  });

  it("启动参数页(Desktop 式):串唯一真源;端口行与快填镜像行已退役(09-10 不要重复展示)", async () => {
    render(<ComfyEngineSettingsSection />);
    fireEvent.click(comfyEl("tab", "update"));
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "launch"));
    const argsInput = comfyEl("args-input") as HTMLInputElement;
    expect(argsInput.value).toBe("--gpu-only --reserve-vram 16 --use-pytorch-cross-attention");
    // 端口与参数态的镜像展示全撤:端口看页顶引擎状态行,参数态看串本身
    expect(document.querySelector("[data-comfy-port-input]")).toBeNull();
    expect(document.querySelector("[data-comfy-vram-select]")).toBeNull();
    expect(document.querySelector("[data-comfy-attention-select]")).toBeNull();
    expect(document.querySelector("[data-comfy-reserve-input]")).toBeNull();
    // 托管旋钮不在串中,零重复故保留
    expect(comfyEl("port-policy-select")).toBeTruthy();
  });

  it("启动参数页:语法错红字拒存;大众端口黄字/0.0.0.0 红字放行警告", async () => {
    render(<ComfyEngineSettingsSection />);
    fireEvent.click(comfyEl("tab", "update"));
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "launch"));
    // 语法错:引号不成对 → 红字+不落账
    fireEvent.change(comfyEl("args-input"), { target: { value: '"--unbalanced' } });
    await waitFor(() => expect(comfyEl("args-error")?.textContent).toContain("引号"));
    // 警告:大众端口黄字 + 0.0.0.0 红字(放行,仅提醒)
    fireEvent.change(comfyEl("args-input"), { target: { value: "--port 8188 --listen 0.0.0.0" } });
    await waitFor(() => {
      const warnings = document.querySelectorAll("[data-comfy-args-warning]");
      expect(warnings.length).toBe(2);
      expect(warnings[0]!.getAttribute("data-comfy-args-warning")).toBe("warn");
      expect(warnings[1]!.getAttribute("data-comfy-args-warning")).toBe("danger");
    });
    await waitFor(
      () => expect(actions.setLaunchConfig).toHaveBeenCalledWith({ argsString: "--port 8188 --listen 0.0.0.0" }),
      { timeout: 2000 },
    );
  });

  it("启动参数页:环境变量表添加行防抖落账,值默认遮蔽", async () => {
    render(<ComfyEngineSettingsSection />);
    fireEvent.click(comfyEl("tab", "update"));
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "launch"));
    fireEvent.click(comfyEl("env-add"));
    const keyInput = document.querySelector("[data-comfy-env-key]") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "HF_TOKEN" } });
    // 深审 C2 修复后行=稳定 id,值输入不再因键名变更重挂载
    const valueInput = document.querySelector("[data-comfy-env-value]") as HTMLInputElement;
    expect(valueInput).toBe(keyInput.parentElement?.querySelector("[data-comfy-env-value]") ?? valueInput);
    fireEvent.change(valueInput, { target: { value: "tok-1" } });
    expect(valueInput.type).toBe("password");
    await waitFor(
      () => expect(actions.setLaunchConfig).toHaveBeenCalledWith({ envVars: { HF_TOKEN: "tok-1" } }),
      { timeout: 2000 },
    );
  });

  it("快照页:大白话原因+回滚传 id;引擎修复同页", async () => {
    scenario.snapshots = [
      { id: "snap-9", createdAt: 1788835819800, reason: "plugin-uninstall:rgthree-comfy", version: "v0.34.6", full: false },
    ];
    render(<ComfyEngineSettingsSection />);
    fireEvent.click(comfyEl("tab", "update"));
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "snapshots"));
    await waitFor(() => expect(screen.getByText(/卸载插件 rgthree-comfy 前/)).toBeTruthy());
    expect(screen.getByText("引擎修复")).toBeTruthy();
    expect(comfyEl("reset-button")).toBeTruthy();
    fireEvent.click(comfyEl("snapshot-rollback"));
    await waitFor(() => expect(actions.rollbackTo).toHaveBeenCalledWith("snap-9"));
  });

  it("存储页:模型目录输入+保存", async () => {
    render(<ComfyEngineSettingsSection />);
    fireEvent.click(comfyEl("tab", "update"));
    await waitFor(() => expect(screen.getByText("当前版本")).toBeTruthy());
    fireEvent.click(comfyEl("tab", "storage"));
    expect(comfyEl("models-dir-input")).toBeTruthy();
    // 09-10 用户裁定回归锁:模型目录行并入「存储位置」卡内首行,页面不再有卡外独立行
    const rows = document.querySelector("[data-comfy-engine-storage-rows]");
    expect(rows?.querySelector('[data-comfy-path-row="modelsDir"]')).toBeTruthy();
    fireEvent.change(comfyEl("models-dir-input"), { target: { value: "/Users/x/models" } });
    fireEvent.click(comfyEl("models-dir-save"));
    await waitFor(() => expect(actions.setModelsDir).toHaveBeenCalledWith("/Users/x/models"));
  });
});

// ── 09-09-comfy-model-tab:模型页(本地大模型展示并入引擎卡) ──
describe("ComfyEngineSettingsSection 模型页", () => {
  it("默认落「模型」页:ComfyUI 模型库清单在,不触发 GitHub 检查,版本行不在", () => {
    scenario.status = readyStatus();
    scenarioModels.reply = {
      modelsDir: "/tmp/comfyui/models",
      groups: [
        { category: "diffusion_models", files: [{ name: "krea2_turbo_bf16.safetensors", sizeBytes: 26283332608 }] },
        { category: "loras", files: [{ name: "Krea2-NSFW/Krea 2 pussy.safetensors", sizeBytes: 268435456 }] }],
      totalBytes: 26283332608 + 268435456,
    };
    render(<ComfyEngineSettingsSection embedded />);

    expect(comfyEl("models-page")).toBeTruthy();
    expect(modelActions.loadModels).toHaveBeenCalled();
    // 域分组默认收起(09-10 分域裁定):域头/域注释/合计常驻;类别组与文件行逐层点开才见
    expect(screen.getByText("图片")).toBeTruthy();
    expect(screen.getByText(/生图画布相关/)).toBeTruthy();
    expect(screen.getByText(/合计 2 件/)).toBeTruthy();
    expect(screen.queryByText(/krea2_turbo_bf16\.safetensors/)).toBeNull();
    fireEvent.click(comfyEl("model-domain-toggle", "image"));
    fireEvent.click(comfyEl("model-group-toggle", "image:diffusion_models"));
    expect(screen.getByText(/krea2_turbo_bf16\.safetensors/)).toBeTruthy();
    expect(screen.getByText(/Krea2 生图主力——文生图\/图生图\/无衣物\/NSFW 专业流/)).toBeTruthy();
    expect(screen.getByText("24.5 GB")).toBeTruthy();
    expect(actions.checkUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText(/当前版本/)).toBeNull();
  });

  it("引擎状态未知:模型页照常渲染(不复现 09-08 真空窗空卡)", () => {
    scenario.status = null;
    scenarioModels.reply = { modelsDir: "/tmp/comfyui/models", groups: [], totalBytes: 0 };
    render(<ComfyEngineSettingsSection embedded />);

    expect(comfyEl("models-page")).toBeTruthy();
    expect(screen.getByText(/模型目录还是空的/)).toBeTruthy();
  });

  it("initialActiveTab=\"update\":挂载直落更新页并自动静默检查(去更新深链)", async () => {
    scenario.status = readyStatus({});
    render(<ComfyEngineSettingsSection embedded initialActiveTab="update" />);

    expect(screen.getByText(/当前版本/)).toBeTruthy();
    expect(comfyQuery("models-page")).toBeNull();
    await waitFor(() => expect(actions.checkUpdate).toHaveBeenCalledOnce());
  });

  it("已挂载时 initialActiveTab 变化切页(深链补发场景)", () => {
    scenario.status = readyStatus({});
    const { rerender } = render(<ComfyEngineSettingsSection embedded />);
    expect(comfyEl("models-page")).toBeTruthy();

    rerender(<ComfyEngineSettingsSection embedded initialActiveTab="update" />);
    expect(screen.getByText(/当前版本/)).toBeTruthy();
    expect(comfyQuery("models-page")).toBeNull();
  });
});

  it("未安装:安装引导 + 模型页仍可见(下载完整模型自足入口不随引擎缺失消失,09-10)", () => {
    scenario.status = readyStatus({ installed: false, state: "not-installed", version: null, port: null, modelsDir: null });
    render(<ComfyEngineSettingsSection embedded />);

    expect(screen.getByText(/引擎尚未安装/)).toBeTruthy();
    expect(comfyEl("models-page")).toBeTruthy();
    // 未装引擎无版本/服务可管:标签页体系不出现
    expect(document.querySelector("[data-comfy-tab]")).toBeNull();
  });
