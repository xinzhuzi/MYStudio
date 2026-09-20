// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// ComfyUI sidecar HTTP 适配器测试(09-08 集成):fetch mock 覆盖字段映射
// (引擎状态/任务阶段/报告/目录/体检)、两步删除、keep-both 改名、错误大白话。

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHttpComfyEngineClient,
  setComfySidecarLivenessProbeForTests,
  createHttpComfyWorkflowLibraryTransport,
  isElectronRenderer,
  mapDoctorReport,
  mapEngineStatus,
  mapJob,
  mapPluginRow,
  mapCatalogReply,
  mapWorkflowTree,
} from "./comfy-sidecar-bridge";

// ---------------------------------------------------------------------------
// fetch 路由桩
// ---------------------------------------------------------------------------

/** 测试用的宽松 JSON 值(避免 any,同时允许任意嵌套取键)。 */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface FetchCall {
  method: string;
  url: string;
  body?: { [key: string]: Json };
  headers: Record<string, string>;
}

interface RouteReply {
  status?: number;
  body: unknown;
}

function createFetchRouter() {
  const calls: FetchCall[] = [];
  const routes: Array<{
    match: (call: FetchCall) => boolean;
    respond: (call: FetchCall, callIndex: number) => RouteReply | Promise<RouteReply>;
  }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const rawHeaders = init?.headers;
    const headers: Record<string, string> = {};
    if (rawHeaders) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[key.toLowerCase()] = value;
      }
    }
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { [key: string]: Json }) : undefined;
    const call: FetchCall = { method: (init?.method ?? "GET").toUpperCase(), url, body, headers };
    calls.push(call);
    const index = calls.filter((item) => item.method === call.method).length - 1;
    // 后注册的路由优先(同一端点多次打桩时以最新为准)。
    const route = [...routes].reverse().find((item) => item.match(call));
    if (!route) {
      return new Response(JSON.stringify({ error: { message: `no stub route: ${call.method} ${call.url}` } }), {
        status: 404,
      });
    }
    const reply = await route.respond(call, index);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  const on = (
    method: string,
    match: string | RegExp | ((call: FetchCall) => boolean),
    // 注意:此处不能写 RouteReply["body"](=unknown,吸收整个联合→respond
    // lambda 失去上下文类型,参数退隐式 any);裸 body 值以 Json 收口。
    respond: Json | RouteReply | ((call: FetchCall, callIndex: number) => RouteReply),
  ) => {
    routes.push({
      match: (call) =>
        call.method === method &&
        (typeof match === "function"
          ? match(call)
          : typeof match === "string"
            ? call.url === `http://127.0.0.1:17595${match}`
            : match.test(call.url)),
      respond: (call, callIndex) => {
        if (typeof respond === "function") return respond(call, callIndex);
        // 带 status/body 键的对象按应答壳解析,其余按纯 body。
        if (respond && typeof respond === "object" && ("status" in respond || "body" in respond)) {
          return respond as RouteReply;
        }
        return { body: respond };
      },
    });
  };
  return { fetchMock, calls, on, reset: () => { calls.length = 0; routes.length = 0; } };
}

const router = createFetchRouter();

beforeEach(() => {
  router.reset();
  vi.stubGlobal("fetch", router.fetchMock);
  // 门禁默认放行:单测聚焦字段映射;探活语义由文末 describe 单独锁定
  setComfySidecarLivenessProbeForTests(async () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setComfySidecarLivenessProbeForTests(null);
});

// ---------------------------------------------------------------------------
// 环境判定
// ---------------------------------------------------------------------------

describe("isElectronRenderer", () => {
  it("jsdom/浏览器 UA(不含 Electron)→ false,契约入口保持 undefined", () => {
    expect(isElectronRenderer()).toBe(false);
  });
});

describe("bridge origin snapshot", () => {
  it("sends a project origin even when there are no storyboards", async () => {
    router.on("POST", "/comfy/bridge/storyboards", { updatedAt: 1 });
    await createHttpComfyEngineClient().pushBridgeStoryboards([], undefined, [], "project-a");
    expect(router.calls[0]?.body).toMatchObject({ shots: [], originProjectId: "project-a" });
  });
});

describe("exact bridge acknowledgement", () => {
  it("forwards only exact IDs and queue epoch, never a cumulative upTo", async () => {
    router.on("POST", "/comfy/bridge/actions/ack", { deleted: 1, ackMode: "exact" });
    router.on("POST", "/comfy/bridge/writebacks/ack", { deleted: 1, ackMode: "exact" });
    const client = createHttpComfyEngineClient();
    expect(await client.ackBridgeActions(9, "queue-a", [9])).toBe(1);
    expect(await client.ackBridgeWritebacks(9, [9])).toBe(1);
    expect(router.calls.map((call) => call.body)).toEqual([{ queueId: "queue-a", ids: [9] }, { ids: [9] }]);
  });

  it("fails closed against an old sidecar without exact acknowledgement support", async () => {
    router.on("POST", "/comfy/bridge/actions/ack", { deleted: 0 });
    router.on("POST", "/comfy/bridge/writebacks/ack", { deleted: 0 });
    const client = createHttpComfyEngineClient();
    expect(await client.ackBridgeActions(9, "queue-a", [9])).toBeNull();
    expect(await client.ackBridgeWritebacks(9, [9])).toBeNull();
    expect(router.calls.every((call) => !Object.hasOwn(call.body ?? {}, "upTo"))).toBe(true);
  });

  it("does not send unsafe legacy or invalid acknowledgement arguments", async () => {
    const client = createHttpComfyEngineClient();
    expect(await client.ackBridgeActions(9)).toBeNull();
    expect(await client.ackBridgeActions(9, "queue-a")).toBeNull();
    expect(await client.ackBridgeActions(9, "queue-a", [10])).toBeNull();
    expect(await client.ackBridgeWritebacks(9)).toBeNull();
    expect(await client.ackBridgeWritebacks(9, [10])).toBeNull();
    expect(router.calls).toEqual([]);
  });

  it("keeps the queue epoch and immutable project origin in action listings", async () => {
    const reply = { cursor: 0, queueId: "queue-a", items: [{ id: 1, kind: "generate-images", originProjectId: "project-a", originEpisodeId: "episode-1" }] };
    router.on("GET", "/comfy/bridge/actions?cursor=0", reply);
    expect(await createHttpComfyEngineClient().getBridgeActions(0)).toEqual(reply);
  });
});

// ---------------------------------------------------------------------------
// 引擎状态映射
// ---------------------------------------------------------------------------

describe("mapEngineStatus", () => {
  it("未安装且无残留 → not-installed,字段逐一对齐(含任务二新字段)", () => {
    const status = mapEngineStatus({
      installed: false,
      version: null,
      latest: null,
      state: "not_installed",
      running: false,
      port: null,
      modelsDir: null,
      defaultModelsDir: "/userData/comfyui/models",
      pluginCount: 0,
      updateAvailable: false,
      needsSetup: false,
      message: null,
      installDir: "/userData/comfyui",
    });
    expect(status).toMatchObject({
      installed: false,
      state: "not-installed",
      serviceRunning: false,
      port: null,
      modelsDir: null,
      defaultModelsDir: "/userData/comfyui/models",
      installDir: "/userData/comfyui",
      pluginCount: 0,
      updateAvailable: false,
      message: null,
    });
  });

  it("未安装但源码目录残留(needsSetup)→ needs-setup", () => {
    const status = mapEngineStatus({ installed: false, state: "not_installed", needsSetup: true });
    expect(status.state).toBe("needs-setup");
  });

  it("A 的 updating/resetting/running/stopped → B 的 ready(更新中由任务胶囊表达)", () => {
    for (const state of ["updating", "resetting", "running", "stopped"]) {
      expect(mapEngineStatus({ installed: true, state }).state).toBe("ready");
    }
  });

  it("installing → installing;serviceRunning 独立取 running 字段", () => {
    const installing = mapEngineStatus({ installed: false, state: "installing" });
    expect(installing.state).toBe("installing");
    const stoppedButReady = mapEngineStatus({ installed: true, state: "stopped", running: false });
    expect(stoppedButReady.state).toBe("ready");
    expect(stoppedButReady.serviceRunning).toBe(false);
    const running = mapEngineStatus({ installed: true, state: "running", running: true, port: 17600 });
    expect(running.serviceRunning).toBe(true);
    expect(running.port).toBe(17600);
  });

  it("未知 state → error(防御兜底)", () => {
    expect(mapEngineStatus({ installed: true, state: "nonsense" }).state).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// 任务映射
// ---------------------------------------------------------------------------

describe("mapJob", () => {
  it("kind/state/progress/stage/message 对齐(engine-install 运行中)", () => {
    const job = mapJob({
      id: "abc123",
      kind: "engine-install",
      status: "running",
      progress: 42,
      step: "git-clone",
      message: "下载 ComfyUI 源码…",
    });
    expect(job).toMatchObject({
      jobId: "abc123",
      kind: "install",
      state: "running",
      progress: 42,
      stage: "download",
      message: "下载 ComfyUI 源码…",
      report: null,
    });
  });

  it("失败任务:state=failed 且 error 优先于 message", () => {
    const job = mapJob({
      id: "j2",
      kind: "engine-update",
      status: "error",
      progress: 90,
      step: "rollback",
      message: "更新失败,正在回滚…",
      error: "更新失败已回滚: 网络中断",
    });
    expect(job.state).toBe("failed");
    expect(job.message).toBe("更新失败已回滚: 网络中断");
    expect(job.stage).toBeNull(); // rollback 阶段对不上 B 枚举 → null
  });

  it("阶段映射全表:依赖类→dependencies,fetch→pull,layout→finalize,verify→verify", () => {
    const pairs: Array<[string, string | null]> = [
      ["git-clone", "download"],
      ["venv", "dependencies"],
      ["pip-torch", "dependencies"],
      ["pip-requirements", "dependencies"],
      ["pip-plugins", "dependencies"],
      ["layout", "finalize"],
      ["snapshot", "snapshot"],
      ["fetch", "pull"],
      ["checkout", "pull"],
      ["pull", "pull"],
      ["restart", "restart"],
      ["verify", "verify"],
      ["acquire", "clone"],
      ["clone", "clone"],
      ["wipe-venv", "clean"],
      ["queued", null],
      ["preflight", null],
    ];
    for (const [step, expected] of pairs) {
      expect(mapJob({ id: "j", kind: "plugin-install", status: "running", step }).stage, step).toBe(expected);
    }
  });

  it("更新成功报告:版本/节点前后差分/不兼容点名/兼容计数", () => {
    const job = mapJob({
      id: "j3",
      kind: "engine-update",
      status: "complete",
      step: "verify",
      result: {
        oldVersion: "v0.34.0",
        newVersion: "v0.34.5",
        nodeCount: 2210,
        nodeDelta: 14,
        pluginCount: 5,
        pluginIssues: [{ plugin: "图层样式", detail: "IMPORT FAILED" }],
        snapshotId: "snap-1",
        message: "已更新",
      },
    });
    expect(job.state).toBe("succeeded");
    expect(job.report).toEqual({
      kind: "update",
      previousVersion: "v0.34.0",
      newVersion: "v0.34.5",
      nodeCountBefore: 2196,
      nodeCountAfter: 2210,
      incompatiblePlugins: ["图层样式"],
      compatiblePlugins: 4,
    });
  });

  it("插件安装成功报告与通用兜底报告", () => {
    const pluginJob = mapJob({
      id: "j4",
      kind: "plugin-install",
      status: "complete",
      result: { plugin: "rgthree-comfy", addedNodes: 42, message: "安装成功" },
    });
    expect(pluginJob.report).toEqual({ kind: "plugin-install", pluginId: "rgthree-comfy", addedNodeCount: 42 });
    const resetJob = mapJob({
      id: "j5",
      kind: "engine-reset",
      status: "complete",
      result: { nodeCount: 2190, pluginCount: 2, message: "复位完成" },
    });
    expect(resetJob.report).toEqual({ kind: "generic", message: "复位完成" });
  });

  it("卸载任务映射到 plugin-remove", () => {
    const job = mapJob({ id: "j6", kind: "plugin-uninstall", status: "running", step: "remove" });
    expect(job.kind).toBe("plugin-remove");
  });
});

// ---------------------------------------------------------------------------
// 插件/目录/体检映射
// ---------------------------------------------------------------------------

describe("插件与目录映射", () => {
  it("插件行:deps 账本 → 依赖名列表,目录缺失 → install-failed,license 兜底", () => {
    expect(
      mapPluginRow({
        id: "rgthree-comfy",
        name: "RG三节点集",
        desc: "效率工具",
        license: null,
        state: "installed",
        version: "1.0",
        deps: { torch: "2.9.0", numpy: "1.26" },
        nodeCount: 42,
        dirExists: true,
      }),
    ).toMatchObject({
      id: "rgthree-comfy",
      name: "RG三节点集",
      description: "效率工具",
      license: "未标明",
      state: "installed",
      deps: ["numpy", "torch"],
      nodeCount: 42,
      author: null,
      downloads: null,
      category: null,
    });
    expect(mapPluginRow({ id: "broken", dirExists: false }).state).toBe("install-failed");
  });

  it("插件行富化(09-10):requirements 数组形态 deps + 作者/GitHub 星标透传", () => {
    expect(
      mapPluginRow({
        id: "ComfyUI-Manager",
        name: "插件管理器",
        desc: "装/更/卸插件",
        license: "GPL-3.0",
        deps: ["GitPython", "PyGithub", "uv"],
        author: "Dr.Lt.Data",
        stars: 25000,
        nodeCount: 3,
        dirExists: true,
      }),
    ).toMatchObject({
      id: "ComfyUI-Manager",
      license: "GPL-3.0",
      deps: ["GitPython", "PyGithub", "uv"],
      author: "Dr.Lt.Data",
      stars: 25000,
      state: "installed",
    });
  });

  it("插件行版本三件套(09-10 晚):最新版本透传 + updatable 状态映射", () => {
    expect(
      mapPluginRow({
        id: "ComfyUI-GGUF",
        version: "1.9.0",
        latestVersion: "2.0.0",
        state: "updatable",
        dirExists: true,
      }),
    ).toMatchObject({
      version: "1.9.0",
      latestVersion: "2.0.0",
      state: "updatable",
    });
    // 目录缺失仍压过 updatable(install-failed 优先)
    expect(mapPluginRow({ id: "x", state: "updatable", dirExists: false }).state).toBe("install-failed");
  });

  it("插件行 source/repo 透传(09-19 根修):pip 行更新钮依赖 source,此前生产环境漏传", () => {
    expect(
      mapPluginRow({
        id: "comfyui-manager",
        name: "ComfyUI-Manager",
        desc: "运行时组件",
        license: null,
        state: "installed",
        source: "pip",
        repo: "https://github.com/Comfy-Org/ComfyUI-Manager",
        dirExists: true,
      }),
    ).toMatchObject({ source: "pip", repo: "https://github.com/Comfy-Org/ComfyUI-Manager" });
    // 旧 sidecar 回包无 source:回落 undefined(前端按目录四源默认处理)
    expect(mapPluginRow({ id: "legacy", dirExists: true }).source).toBeUndefined();
  });

  it("目录搜索:策展+Registry 合并,installed → installedState", () => {
    const entries = mapCatalogReply({
      curated: [
        {
          id: "rgthree-comfy",
          name: "RG三节点集",
          desc_zh: "效率工具",
          category: "效率",
          verified_license: "MIT",
          installed: true,
        },
      ],
      registry: [
        { id: "layer-node", name: "图层节点", desc: "图层合成", license: null, author: "x", downloads: 5, installed: false },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "rgthree-comfy",
      source: "curated",
      ref: "rgthree-comfy",
      installedState: "installed",
      license: "MIT",
      category: "效率",
    });
    expect(entries[1]).toMatchObject({ source: "registry", installedState: null, license: "未标明", author: "x" });
  });

  it("目录去重:策展与 Registry 同 id 时策展优先,不重复渲染", () => {
    const entries = mapCatalogReply({
      curated: [
        { id: "rgthree-comfy", name: "RG三节点集", desc_zh: "效率工具", category: "效率", verified_license: "MIT", installed: false },
      ],
      registry: [
        { id: "rgthree-comfy", name: "Rgthree (registry 重复条目)", desc: "dup", license: null, author: "y", downloads: 9, installed: false },
        { id: "other-node", name: "其他", desc: "不重复", license: null, author: "z", downloads: 1, installed: false },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "rgthree-comfy", source: "curated", name: "RG三节点集" });
    expect(entries[1]).toMatchObject({ id: "other-node", source: "registry" });
  });

  it("体检报告:三类问题转大白话字符串数组", () => {
    const report = mapDoctorReport({
      missing: [{ plugin: "layerstyle", message: "插件目录不见了" }],
      drifted: [{ plugin: "rgthree", package: "numpy", recorded: "1.26", actual: "2.1.0" }],
      orphan: [{ plugin: "stray-plugin", message: "目录在 custom_nodes 里但账本没有记录" }],
    });
    expect(report.missing).toEqual(["layerstyle:插件目录不见了"]);
    expect(report.drifted[0]).toContain("numpy");
    expect(report.drifted[0]).toContain("2.1.0");
    expect(report.orphan[0]).toContain("stray-plugin");
  });
});

// ---------------------------------------------------------------------------
// HTTP client 行为(fetch mock)
// ---------------------------------------------------------------------------

describe("httpComfyEngineClient", () => {
  it("getEngineStatus:GET status + Bearer 令牌 + 映射", async () => {
    router.on("GET", "/comfy/engine/status", {
      installed: true,
      version: "v0.34.0",
      latest: null,
      state: "stopped",
      running: false,
      port: 17600,
      modelsDir: "/models",
      defaultModelsDir: "/userData/comfyui/models",
      pluginCount: 3,
      updateAvailable: false,
      needsSetup: false,
      message: null,
      installDir: "/userData/comfyui",
    });
    const status = await createHttpComfyEngineClient().getEngineStatus();
    expect(status.installed).toBe(true);
    expect(status.port).toBe(17600);
    expect(router.calls[0]?.headers.authorization).toBe("Bearer manying-local-image");
  });

  it("HTTP 错误 → 大白话 message(error.message 直通)", async () => {
    router.on("POST", "/comfy/engine/install", { status: 400, body: { error: { message: "引擎已安装;如需重装请先复位" } } });
    await expect(createHttpComfyEngineClient().installEngine()).rejects.toThrow("引擎已安装;如需重装请先复位");
  });

  it("网络失败 → 连接指引大白话(不裸抛 TypeError)", async () => {
    router.on("GET", "/comfy/engine/status", () => {
      throw new TypeError("fetch failed");
    });
    await expect(createHttpComfyEngineClient().getEngineStatus()).rejects.toThrow("无法连接本地生图服务");
  });

  it("startEngine:启动 job 轮询到成功 → accepted", async () => {
    router.on("POST", "/comfy/engine/start", { jobId: "start-1" });
    router.on("GET", (call) => call.url.endsWith("/comfy/jobs/start-1"), (_call, index) =>
      index === 0
        ? { body: { id: "start-1", kind: "engine-start", status: "running", progress: 20 } }
        : { body: { id: "start-1", kind: "engine-start", status: "complete", result: { running: true } } },
    );
    vi.useFakeTimers();
    try {
      const promise = createHttpComfyEngineClient().startEngine();
      const assertion = expect(promise).resolves.toEqual({ accepted: true });
      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("startEngine:启动失败 → accepted false + 大白话", async () => {
    router.on("POST", "/comfy/engine/start", { jobId: "start-2" });
    router.on("GET", (call) => call.url.endsWith("/comfy/jobs/start-2"), {
      body: { id: "start-2", status: "error", error: "引擎健康检查超时(120 秒)" },
    });
    await expect(createHttpComfyEngineClient().startEngine()).resolves.toEqual({
      accepted: false,
      message: "引擎健康检查超时(120 秒)",
    });
  });

  it("uninstallPlugin:DELETE 带 confirm=true + 轮询到终态", async () => {
    router.on("DELETE", (call) => call.url.includes("/comfy/plugins/rgthree"), { jobId: "rm-1" });
    router.on("GET", (call) => call.url.endsWith("/comfy/jobs/rm-1"), {
      body: { id: "rm-1", kind: "plugin-uninstall", status: "complete", result: { plugin: "rgthree" } },
    });
    await expect(createHttpComfyEngineClient().uninstallPlugin("rgthree")).resolves.toEqual({ accepted: true });
    const deleteCall = router.calls.find((call) => call.method === "DELETE");
    expect(deleteCall?.url).toContain("confirm=true");
  });

  it("getPluginUsage:引用清单映射为 workflows(id+去后缀名)", async () => {
    router.on("GET", "/comfy/plugins/rgthree/references", {
      plugin: "rgthree",
      nodeTypes: ["rgthree.abc"],
      referencedBy: [{ workflow: "sub/Krea2 流.json", usedTypes: ["rgthree.abc"] }],
    });
    const usage = await createHttpComfyEngineClient().getPluginUsage("rgthree");
    expect(usage).toEqual({ workflows: [{ id: "sub/Krea2 流.json", name: "Krea2 流" }] });
  });

  it("checkUpdate:sidecar 带回 error 字段 → 抛大白话(不误报「已是最新」)", async () => {
    router.on("POST", "/comfy/engine/update-check", {
      current: "v0.34.0",
      latest: null,
      updateAvailable: false,
      error: "检查更新失败: 网络不可达",
    });
    await expect(createHttpComfyEngineClient().checkUpdate()).rejects.toThrow("检查更新失败");
  });

  it("setModelsDir:POST config + 启动/停止/回滚对接", async () => {
    router.on("POST", "/comfy/engine/config", { restarted: false });
    await expect(createHttpComfyEngineClient().setModelsDir("/models")).resolves.toEqual({ accepted: true });
    expect(router.calls[0]?.body).toEqual({ modelsDir: "/models" });

    router.on("POST", "/comfy/engine/stop", { running: false, stopped: true });
    await expect(createHttpComfyEngineClient().stopEngine()).resolves.toEqual({ accepted: true });

    router.on("POST", "/comfy/engine/rollback", { rolledBackTo: "snap-1", running: false });
    await expect(createHttpComfyEngineClient().rollbackUpdate()).resolves.toEqual({
      accepted: true,
      message: "已回滚到快照 snap-1",
    });
  });
});

// ---------------------------------------------------------------------------
// 工作流库 transport(fetch mock)
// ---------------------------------------------------------------------------

describe("httpComfyWorkflowLibraryTransport", () => {
  it("list:扁平路径推导文件夹树;.keep.json 占位只留文件夹;missingNodes null → 空数组", () => {
    const tree = mapWorkflowTree([
      { id: "Krea2 流.json", name: "Krea2 流", nodeCount: 12, missingNodes: ["FooNode"] },
      { id: "归档/旧流.json", name: "旧流", nodeCount: 3, missingNodes: null },
      { id: "归档/深层/嵌套.json", name: "嵌套", nodeCount: 1, missingNodes: null },
      { id: "归档/.keep.json", name: ".keep", nodeCount: 0, missingNodes: null },
    ]);
    expect(tree.folders).toEqual([
      { id: "归档", name: "归档", parentId: null },
      { id: "归档/深层", name: "深层", parentId: "归档" },
    ]);
    expect(tree.workflows.map((wf) => wf.id)).toEqual(["Krea2 流.json", "归档/旧流.json", "归档/深层/嵌套.json"]);
    expect(tree.workflows[0]?.missingClassTypes).toEqual(["FooNode"]);
    expect(tree.workflows[1]?.missingClassTypes).toEqual([]);
    expect(tree.workflows[1]?.folderId).toBe("归档");
  });

  it("content:取 JSON 原文", async () => {
    router.on("GET", (call) => call.url.includes("/content"), { id: "a.json", content: '{"1":{}}' });
    await expect(createHttpComfyWorkflowLibraryTransport().content("a.json")).resolves.toBe('{"1":{}}');
  });

  it("importFiles skip:同名冲突逐文件 skipped,成功 imported", async () => {
    router.on("POST", "/comfy/workflows/import", { imported: ["新流.json"], skipped: ["Krea2 流.json"] });
    const results = await createHttpComfyWorkflowLibraryTransport().importFiles(
      [
        { name: "新流.json", content: "{}" },
        { name: "Krea2 流.json", content: "{}" },
      ],
      "skip",
    );
    expect(results).toEqual([
      { name: "新流.json", status: "imported", id: "新流.json" },
      { name: "Krea2 流.json", status: "skipped", reason: "conflict" },
    ]);
    expect(router.calls[0]?.body?.overwrite).toBe(false);
  });

  it("importFiles overwrite:整批 overwrite=true", async () => {
    router.on("POST", "/comfy/workflows/import", { imported: ["a.json"], skipped: [] });
    await createHttpComfyWorkflowLibraryTransport().importFiles([{ name: "a.json", content: "{}" }], "overwrite");
    expect(router.calls[0]?.body?.overwrite).toBe(true);
  });

  it("importFiles keep-both:冲突改名「名 2」重试,结果标 renamed", async () => {
    let callCount = 0;
    router.on("POST", "/comfy/workflows/import", () => {
      callCount += 1;
      return callCount === 1
        ? { body: { imported: [], skipped: ["a.json"] } }
        : { body: { imported: ["a 2.json"], skipped: [] } };
    });
    const results = await createHttpComfyWorkflowLibraryTransport().importFiles(
      [{ name: "a.json", content: "{}" }],
      "keep-both",
    );
    expect(results).toEqual([{ name: "a.json", status: "renamed", id: "a 2.json", renamedTo: "a 2" }]);
    expect(callCount).toBe(2);
  });

  it("importFiles 坏 JSON:单文件标失败,好文件照常发(不整批拒)", async () => {
    router.on("POST", "/comfy/workflows/import", { imported: ["b.json"], skipped: [] });
    const results = await createHttpComfyWorkflowLibraryTransport().importFiles(
      [
        { name: "bad.json", content: "not json" },
        { name: "b.json", content: "{}" },
      ],
      "skip",
    );
    expect(results).toEqual([
      { name: "bad.json", status: "failed", error: "文件不是有效 JSON" },
      { name: "b.json", status: "imported", id: "b.json" },
    ]);
  });

  it("删除两步:先无 confirm 扫引用(pluginsUsed→references),再 confirm 执行", async () => {
    let deleteCallCount = 0;
    router.on("POST", (call) => call.url.includes("/delete"), (call) => {
      deleteCallCount += 1;
      if (call.body?.confirm === true) return { body: { deleted: true, pluginsUsed: ["rgthree"] } };
      return { body: { needsConfirmation: true, pluginsUsed: ["rgthree"], nodeCount: 5 } };
    });
    const transport = createHttpComfyWorkflowLibraryTransport();
    const scan = await transport.scanDeleteReferences("wf-1");
    expect(scan).toEqual({ references: [{ kind: "plugin", name: "rgthree" }] });
    await expect(transport.deleteWorkflow("wf-1")).resolves.toEqual({ ok: true });
    expect(deleteCallCount).toBe(2);
  });

  it("rename/move:错误转 {ok:false,error},成功 ok:true(folderId null → to 空串)", async () => {
    router.on("POST", (call) => call.url.includes("/rename"), { status: 400, body: { error: { message: "已有同名工作流: b" } } });
    await expect(createHttpComfyWorkflowLibraryTransport().renameWorkflow("a.json", "b")).resolves.toEqual({
      ok: false,
      error: "已有同名工作流: b",
    });
    router.on("POST", (call) => call.url.includes("/move"), { id: "归档/a.json" });
    await expect(createHttpComfyWorkflowLibraryTransport().moveWorkflow("a.json", "归档")).resolves.toEqual({ ok: true });
    await expect(createHttpComfyWorkflowLibraryTransport().moveWorkflow("归档/a.json", null)).resolves.toEqual({ ok: true });
    const rootMove = router.calls[router.calls.length - 1];
    expect(rootMove?.body).toEqual({ to: "" });
  });

  it("createFolder:导入 .keep.json 占位持久化空目录", async () => {
    router.on("POST", "/comfy/workflows/import", { imported: ["归档/.keep.json"], skipped: [] });
    const folder = await createHttpComfyWorkflowLibraryTransport().createFolder("归档", null);
    expect(folder).toEqual({ id: "归档", name: "归档", parentId: null });
    // body.files 是 Json 联合,先 Array.isArray 窄化再取下标
    const importFiles = router.calls[0]?.body?.files;
    expect(Array.isArray(importFiles) ? importFiles[0] : undefined).toEqual({ name: "归档/.keep.json", content: "{}" });
  });

  it("renameFolder:把文件夹下全部条目(含占位)逐个 move 到新目录", async () => {
    router.on("GET", "/comfy/workflows", {
      engineOnline: false,
      workflows: [
        { id: "归档/a.json", name: "a", nodeCount: 1 },
        { id: "归档/深层/b.json", name: "b", nodeCount: 1 },
        { id: "归档/.keep.json", name: ".keep", nodeCount: 0 },
        { id: "根层.json", name: "根层", nodeCount: 1 },
      ],
    });
    router.on("POST", (call) => call.url.includes("/move"), { id: "moved" });
    await expect(createHttpComfyWorkflowLibraryTransport().renameFolder("归档", "2025")).resolves.toEqual({ ok: true });
    const moves = router.calls.filter((call) => call.url.includes("/move"));
    expect(moves.map((call) => [decodeURIComponent(call.url.split("/comfy/workflows/")[1]?.split("/move")[0]), call.body])).toEqual([
      ["归档/a.json", { to: "2025" }],
      ["归档/深层/b.json", { to: "2025/深层" }],
      ["归档/.keep.json", { to: "2025" }],
    ]);
  });

  it("deleteFolder:逐条 confirm 删除文件夹下全部条目", async () => {
    router.on("GET", "/comfy/workflows", {
      engineOnline: false,
      workflows: [
        { id: "归档/a.json", name: "a", nodeCount: 1 },
        { id: "归档/.keep.json", name: ".keep", nodeCount: 0 },
      ],
    });
    router.on("POST", (call) => call.url.includes("/delete"), { deleted: true });
    await expect(createHttpComfyWorkflowLibraryTransport().deleteFolder("归档")).resolves.toEqual({ ok: true });
    const deletes = router.calls.filter((call) => call.url.includes("/delete"));
    expect(deletes).toHaveLength(2);
    expect(deletes.every((call) => call.body?.confirm === true)).toBe(true);
  });

  it("listAvailableClassTypes:引擎在线透传;离线 null → 空数组", async () => {
    router.on("GET", "/comfy/engine/object-info", { engineOnline: true, classTypes: ["KSampler", "CLIPTextEncode"] });
    await expect(createHttpComfyWorkflowLibraryTransport().listAvailableClassTypes()).resolves.toEqual([
      "KSampler",
      "CLIPTextEncode",
    ]);
    router.on("GET", "/comfy/engine/object-info", { engineOnline: false, classTypes: null });
    await expect(createHttpComfyWorkflowLibraryTransport().listAvailableClassTypes()).resolves.toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// sidecar 探活门禁(09-08 打包 smoke 修复的行为锁定)
// ---------------------------------------------------------------------------
describe("comfy sidecar 探活门禁", () => {
  it("sidecar 未运行:不发 fetch,直接大白话指路", async () => {
    setComfySidecarLivenessProbeForTests(async () => false);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      calls.push(String(args[0]));
      return new Response("{}", { status: 200 });
    });
    const client = createHttpComfyEngineClient();
    await expect(client.getEngineStatus()).rejects.toThrow("本地生图服务未运行");
    await expect(client.listPlugins()).rejects.toThrow("本地生图服务未运行");
    expect(calls).toEqual([]);
  });

  it("探活桥抛错视同未运行(不炸调用方)", async () => {
    setComfySidecarLivenessProbeForTests(async () => {
      throw new Error("ipc down");
    });
    const client = createHttpComfyEngineClient();
    await expect(client.getEngineStatus()).rejects.toThrow("本地生图服务未运行");
  });
});
