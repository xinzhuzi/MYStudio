// comfy-engine-contract 纯函数测试:状态机→胶囊分级(出错>可更新>需准备)、
// 阶段文案、插件胶囊、体检汇总、目录过滤。

import { describe, expect, it } from "vitest";
import {
  COMFY_ENGINE_PILL_LABELS,
  comfyVersionGithubUrl,
  deriveComfyEnginePill,
  filterComfyCatalogEntries,
  formatComfyEnginePillLabel,
  formatComfyPluginPillLabel,
  summarizeDoctorReport,
  type ComfyEngineJob,
  type ComfyEngineStatus,
  type ComfyPluginInfo,
} from "./comfy-engine-contract";

function status(overrides: Partial<ComfyEngineStatus>): ComfyEngineStatus {
  return {
    installed: true,
    version: "0.34.0",
    latest: null,
    state: "ready",
    port: 17599,
    modelsDir: "/tmp/comfyui/models",
    defaultModelsDir: "/tmp/comfyui/models",
    serviceRunning: true,
    pluginCount: 0,
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

function job(overrides: Partial<ComfyEngineJob>): ComfyEngineJob {
  return {
    jobId: "job-1",
    kind: "install",
    state: "running",
    progress: 42,
    stage: "download",
    message: null,
    report: null,
    ...overrides,
  };
}

describe("deriveComfyEnginePill 状态机", () => {
  it("无桥 → 不支持;未探测 → 检查中", () => {
    expect(deriveComfyEnginePill({ hasBridge: false, status: status({}), activeJob: null })).toBe("unsupported");
    expect(deriveComfyEnginePill({ hasBridge: true, status: null, activeJob: null })).toBe("checking");
  });

  it("未安装/需准备/已就绪 基础三态", () => {
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({ installed: false, state: "not-installed" }), activeJob: null }),
    ).toBe("not-installed");
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({ state: "needs-setup" }), activeJob: null }),
    ).toBe("needs-setup");
    expect(deriveComfyEnginePill({ hasBridge: true, status: status({}), activeJob: null })).toBe("ready");
  });

  it("胶囊分级裁定:出错 > 可更新 > 需准备", () => {
    // 出错压过一切
    expect(
      deriveComfyEnginePill({
        hasBridge: true,
        status: status({ state: "error", updateAvailable: true }),
        activeJob: null,
      }),
    ).toBe("error");
    // 可更新压过就绪与需准备
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({ updateAvailable: true }), activeJob: null }),
    ).toBe("update");
    expect(
      deriveComfyEnginePill({
        hasBridge: true,
        status: status({ state: "needs-setup", updateAvailable: true }),
        activeJob: null,
      }),
    ).toBe("update");
  });

  it("就绪口径裁定:装完即就绪,服务未跑不降级胶囊", () => {
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({ serviceRunning: false }), activeJob: null }),
    ).toBe("ready");
  });

  it("任务进行中:install→下载中,update/reset→更新中,插件任务不改引擎胶囊", () => {
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({ state: "not-installed", installed: false }), activeJob: job({ kind: "install" }) }),
    ).toBe("downloading");
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({}), activeJob: job({ kind: "update" }) }),
    ).toBe("updating");
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({}), activeJob: job({ kind: "reset" }) }),
    ).toBe("updating");
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({}), activeJob: job({ kind: "plugin-install" }) }),
    ).toBe("ready");
  });

  it("终态任务不参与分级(失败 job 由 status.state 决定)", () => {
    expect(
      deriveComfyEnginePill({ hasBridge: true, status: status({}), activeJob: job({ kind: "install", state: "failed" }) }),
    ).toBe("ready");
  });
});

describe("formatComfyEnginePillLabel 文案", () => {
  it("下载中带 x%(钳位 0-100)", () => {
    expect(formatComfyEnginePillLabel("downloading", job({ progress: 42 }))).toBe("下载中 42%");
    expect(formatComfyEnginePillLabel("downloading", job({ progress: 130 }))).toBe("下载中 100%");
    expect(formatComfyEnginePillLabel("downloading", job({ progress: null }))).toBe("下载中");
  });

  it("九种胶囊文案齐备且无英文", () => {
    expect(Object.keys(COMFY_ENGINE_PILL_LABELS).length).toBe(9);
    expect(COMFY_ENGINE_PILL_LABELS).toEqual({
      unsupported: "不支持",
      checking: "检查中",
      "not-installed": "未安装",
      downloading: "下载中",
      "needs-setup": "需准备",
      ready: "已就绪",
      update: "可更新",
      updating: "更新中",
      error: "出错",
    });
  });
});

describe("formatComfyPluginPillLabel 插件胶囊", () => {
  const base = {
    id: "rgthree",
    name: "RG三节点集",
    description: "效率工具",
    license: "GPL-3.0",
    state: "installed" as const,
    version: null,
    deps: [],
    author: null,
    downloads: null,
    category: null,
    nodeCount: null,
  } satisfies ComfyPluginInfo;

  it("已装显示节点数,其余三态大白话", () => {
    expect(formatComfyPluginPillLabel({ ...base, state: "installed", nodeCount: 42 })).toBe("已装 42 节点");
    expect(formatComfyPluginPillLabel({ ...base, state: "installed", nodeCount: null })).toBe("已安装");
    expect(formatComfyPluginPillLabel({ ...base, state: "updatable" })).toBe("可更新");
    expect(formatComfyPluginPillLabel({ ...base, state: "install-failed" })).toBe("安装失败");
    expect(formatComfyPluginPillLabel({ ...base, state: "installable" })).toBe("可安装");
  });
});

describe("summarizeDoctorReport 引擎检查汇总", () => {
  it("全空 → 正常", () => {
    expect(summarizeDoctorReport({ missing: [], drifted: [], orphan: [] })).toEqual({
      healthy: true,
      summary: "引擎环境正常:该装的都在,版本都对,没有多余的东西。",
    });
  });

  it("三类问题逐项计数", () => {
    const result = summarizeDoctorReport({
      missing: ["insightface"],
      drifted: ["numpy"],
      orphan: ["旧包A", "旧包B"],
    });
    expect(result.healthy).toBe(false);
    expect(result.summary).toBe("检查发现问题:1 项缺了没装上、1 项版本不对、2 项多余没登记。");
  });
});

describe("filterComfyCatalogEntries 目录过滤", () => {
  const entries = [
    { id: "a", name: "图层样式", description: "图像处理", category: "画质" },
    { id: "b", name: "RG三节点集", description: "效率工具合集", category: "效率" },
    { id: "c", name: "Krea 节点", description: "生图模型配套", category: "生图" },
  ].map((entry) => ({ ...entry, license: "GPL-3.0", author: null, downloads: null, installedState: null, ref: entry.id, source: "curated" as const }));

  it("空查询返回全部;分词命中名字或描述", () => {
    expect(filterComfyCatalogEntries(entries, "", null)).toHaveLength(3);
    expect(filterComfyCatalogEntries(entries, "图层", null)).toHaveLength(1);
    expect(filterComfyCatalogEntries(entries, "效率 工具", null)).toHaveLength(1);
    expect(filterComfyCatalogEntries(entries, "不存在", null)).toHaveLength(0);
  });

  it("分类筛选与查询叠加", () => {
    expect(filterComfyCatalogEntries(entries, "", "效率")).toHaveLength(1);
    expect(filterComfyCatalogEntries(entries, "节点", "生图")).toHaveLength(1);
    expect(filterComfyCatalogEntries(entries, "图层", "生图")).toHaveLength(0);
  });

  it("已装清单(ComfyPluginInfo 形状)同口径过滤(09-10 根修:搜索对已装插件生效)", () => {
    const plugins: ComfyPluginInfo[] = [
      {
        id: "comfyui-manager",
        name: "插件管理器",
        description: "装/更/卸插件",
        license: "GPL-3.0",
        state: "installed",
        version: null,
        deps: [],
        author: null,
        downloads: null,
        category: "管理",
        nodeCount: 3,
      },
    ];
    expect(filterComfyCatalogEntries(plugins, "manager", null)).toHaveLength(1);
    expect(filterComfyCatalogEntries(plugins, "插件 管理", null)).toHaveLength(1);
    expect(filterComfyCatalogEntries(plugins, "管理", "管理")).toHaveLength(1);
    expect(filterComfyCatalogEntries(plugins, "管理", "画质")).toHaveLength(0);
    expect(filterComfyCatalogEntries(plugins, "不存在", null)).toHaveLength(0);
  });
});

describe("comfyVersionGithubUrl(09-09 版本地址跳转)", () => {
  it("纯 tag → tree/{tag};三横线/单横线/master@ 回落短 sha;无法解析 null", () => {
    expect(comfyVersionGithubUrl("v0.34.6")).toBe("https://github.com/Comfy-Org/ComfyUI/tree/v0.34.6");
    expect(comfyVersionGithubUrl("v0.34.6---87---g672ba9e")).toBe("https://github.com/Comfy-Org/ComfyUI/tree/672ba9e");
    expect(comfyVersionGithubUrl("v0.34.6-87-g672ba9e")).toBe("https://github.com/Comfy-Org/ComfyUI/tree/672ba9e");
    expect(comfyVersionGithubUrl("master@672ba9e")).toBe("https://github.com/Comfy-Org/ComfyUI/tree/672ba9e");
    expect(comfyVersionGithubUrl(null)).toBeNull();
    expect(comfyVersionGithubUrl("未知版本")).toBeNull();
  });
});

// ── 启动参数串纯函数(09-10 Desktop 化;同日晚快填下拉随重复展示一并退役)──
import { launchArgsWarnings, tokenizeArgsString } from "./comfy-engine-contract";

describe("launch args string helpers", () => {
  it("tokenize:引号段成词;不成对/反斜杠/空引号段报错(与后端三类硬拒镜像)", () => {
    expect(tokenizeArgsString('--a "b c" d').tokens).toEqual(["--a", "b c", "d"]);
    const bad = tokenizeArgsString('"--unbalanced');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("引号");
    expect(tokenizeArgsString("--foo a\\b").ok).toBe(false);
    expect(tokenizeArgsString('--listen ""').ok).toBe(false);
  });

  it("warnings:大众端口黄字;0.0.0.0 红字;正常串零警告", () => {
    const w = launchArgsWarnings("--port 8188 --listen 0.0.0.0");
    expect(w).toHaveLength(2);
    expect(w[0]!.level).toBe("warn");
    expect(w[1]!.level).toBe("danger");
    expect(launchArgsWarnings("--gpu-only")).toEqual([]);
  });

  it("09-10 用户指定全参数默认串:基线 flag 透传+零警告", () => {
    const full = "--port 17598 --enable-manager --use-pytorch-cross-attention --gpu-only --reserve-vram 16";
    expect(tokenizeArgsString(full).ok).toBe(true);
    expect(launchArgsWarnings(full)).toEqual([]);  // 17598=保留口段,不触大众端口黄字
  });
});
