// @vitest-environment jsdom
// ComfyUI 画布工作室 tab 测试(09-09 0b):三态渲染(未装/就绪未跑/运行中 webview)。

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyCanvasStudio, buildCanvasFitScript, buildOverviewOpenScript } from "./ComfyCanvasStudio";
import { createMockComfyEngineClient } from "@/components/panels/settings/comfy-engine/mock-comfy-engine-client";
import type { ComfyEngineClient, ComfyEngineStatus } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

// open-shot-video 全链(09-14 单镜视频):两个 IO 面在 jsdom 里不可达,桩化——
// 全尺寸关键帧读取(b64)与工作流库导入(importFiles)
vi.mock("@/lib/assist/image-studio/storyboard-overview-sync", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, readStoryboardImageB64: vi.fn(async () => "ZnJhbWU=") };
});
const importFilesMock = vi.hoisted(() => vi.fn(async (files: Array<{ name: string }>) =>
  files.map((file) => ({ name: file.name, status: "imported" }))));
vi.mock("@/lib/assist/image-studio/comfy-sidecar-bridge", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createHttpComfyWorkflowLibraryTransport: () => ({ importFiles: importFilesMock }) };
});

// studio-store mock:autoOpen 注入路径需要 storyboards>0(链工作流载荷);
// 其余用例保持空分镜(注入跳过)语义
const storeState = vi.hoisted(() => ({
  storyboards: [] as unknown[],
  novelChapters: [] as unknown[],
  scriptPlans: [] as unknown[],
  entityExtractions: [] as unknown[],
  productionTracks: [] as unknown[],
  // resolveProductionEpisodeId 读 agentWorkData(缺字段会抛错被 tick 吞掉)
  agentWorkData: [] as unknown[],
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => storeState },
}));

afterEach(() => {
  cleanup();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  vi.clearAllMocks();
  storeState.storyboards = [];
  storeState.novelChapters = [];
  storeState.scriptPlans = [];
  storeState.entityExtractions = [];
  storeState.productionTracks = [];
});

function stubClient(status: Partial<ComfyEngineStatus>): ComfyEngineClient {
  const base = createMockComfyEngineClient({ initialStatus: status });
  return base;
}

describe("ComfyCanvasStudio(辅助面板第六 tab)", () => {
  it("状态查询不到=「确认中」,绝不误报未安装/渲染安装按钮(09-10 实弹根修)", async () => {
    const client = stubClient({ installed: true, state: "ready", serviceRunning: false, port: 17001 });
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      ...client,
      getEngineStatus: vi.fn(async () => {
        throw new Error("本地生图服务未运行");
      }),
    };
    render(<ComfyCanvasStudio />);
    expect(await screen.findByText(/正在确认引擎状态/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "安装引擎" })).toBeNull();
    expect(screen.queryByText(/还没安装 ComfyUI 引擎/)).toBeNull();
  });

  it("引擎未安装:占位引导+手动安装按钮(绝不自动)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({ installed: false, state: "not-installed" });
    render(<ComfyCanvasStudio />);
    const installButton = await screen.findByRole("button", { name: "安装引擎" });
    expect(installButton).toBeTruthy();
  });

  it("引擎就绪未跑:启动按钮占位", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: false,
      port: 17123,
    });
    render(<ComfyCanvasStudio />);
    expect(await screen.findByRole("button", { name: "启动 ComfyUI" })).toBeTruthy();
  });

  it("myScope=模块分野标记进 webview URL(09-11:侧栏按模块分工)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17001,
    });
    const { rerender } = render(<ComfyCanvasStudio myScope="models" />);
    await waitFor(
      () => expect(document.querySelector("[data-comfy-canvas-webview]")).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(document.querySelector("[data-comfy-canvas-webview]")!.getAttribute("src"))
      .toBe("http://127.0.0.1:17001/?myScope=models");
    // 换回工作流模块标记:src 同步换值
    rerender(<ComfyCanvasStudio myScope="workflow" />);
    expect(document.querySelector("[data-comfy-canvas-webview]")!.getAttribute("src"))
      .toBe("http://127.0.0.1:17001/?myScope=workflow");
  });

  it("模块分离会话隔离(09-12):models 域 webview 独立 partition,workflow 域不设", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17001,
    });
    const { rerender } = render(<ComfyCanvasStudio myScope="models" />);
    await waitFor(
      () => expect(document.querySelector("[data-comfy-canvas-webview]")).toBeTruthy(),
      { timeout: 3000 },
    );
    const webview = document.querySelector("[data-comfy-canvas-webview]")!;
    // 独立持久会话:ComfyUI 的 localStorage(activePath+草稿)顶签恢复不再串工作流模块
    expect(webview.getAttribute("partition")).toBe("persist:my-comfy-models");
    rerender(<ComfyCanvasStudio myScope="workflow" />);
    expect(document.querySelector("[data-comfy-canvas-webview]")!.getAttribute("partition")).toBeNull();
  });

  it("引擎运行中:webview 指向 127.0.0.1 引擎端口", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17001,
    });
    render(<ComfyCanvasStudio />);
    await waitFor(
      () => expect(document.querySelector("[data-comfy-canvas-webview]")).toBeTruthy(),
      { timeout: 3000 },
    );
    const webview = document.querySelector("[data-comfy-canvas-webview]")!;
    expect(webview.getAttribute("src")).toBe("http://127.0.0.1:17001/");
    // 09-10 用户裁定(二轮):状态条连同按钮整块退役——live 区零按钮零文案,画布即全部
    const live = document.querySelector("[data-comfy-canvas-live]")!;
    expect(live.textContent).toBe("");
    expect(live.querySelector("button")).toBeNull();
    expect(document.querySelector("[data-comfy-canvas-overlay]")).toBeNull();
  });

  it("dom-ready 注入主题选中色(压过 xterm vendor 泄漏的默认黄;09-10 实弹)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17003,
    });
    render(<ComfyCanvasStudio />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { insertCSS?: (css: string) => Promise<string> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    const injected: string[] = [];
    const scripts: string[] = [];
    webview.insertCSS = (css: string) => {
      injected.push(css);
      return Promise.resolve("id");
    };
    expect(injected).toHaveLength(0); // 无挂载即调(P1:Electron 同步 throw 白屏)
    webview.dispatchEvent(new Event("dom-ready"));
    expect(injected).toHaveLength(1); // 记录器视角:首笔来自事件
    webview.dispatchEvent(new Event("did-finish-load"));
    expect(injected).toHaveLength(2); // 双事件兜底各一发,同规则无害
    expect(injected[0]).toContain("::selection");
    expect(injected[0]).toContain("hsl(212 100% 48% / 0.28)");
    expect(injected[0]).toContain("color:inherit");
    expect(scripts).toHaveLength(0);
  });

  it("dom-ready 同步注入 Sign in 遮蔽脚本(云端收编;CSP 断网外的皮面收口)", async () => {
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17004,
    });
    render(<ComfyCanvasStudio />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    const scripts: string[] = [];
    webview.executeJavaScript = (code: string) => {
      scripts.push(code);
      return Promise.resolve(undefined);
    };
    webview.dispatchEvent(new Event("dom-ready"));
    // 注入顺序:登录遮蔽 → 画布满幅矫正(09-11) →(workflow 时)藏库入口 →(autoOpen 时)总览打开
    // 本用例默认 local 模块:只注 2 段
    expect(scripts).toHaveLength(2);
    const script = scripts[0];
    // 真源=my_login_cloak.js(二轮精确化:按钮整文案精确命中+卡片锚
    // 向上找;不扫容器/不碰 title/aria/弹窗——Comfy 设置页零接触)
    expect(script).toContain("myLoginCloak");
    expect(script).toContain('"登录 / 注册"');
    expect(script).toContain('"登录您的账户"');
    expect(script).toContain('button, a, [role="button"]');
    expect(script).toContain("MutationObserver");
    expect(script).toContain('display", "none", "important');
    expect(script).toContain("__mySignInCloak");
    expect(script).not.toContain("p, span, div"); // 宽扫描面=事故源,禁回归
    webview.dispatchEvent(new Event("did-finish-load"));
    expect(scripts).toHaveLength(4); // 双事件兜底同款节律(每发 2 脚本:遮蔽+满幅矫正)
  });

  it("制作动作通道:轮询到侧栏提交即分发宿主批量钩子并 ack(09-11 收口)", async () => {
    const calls: string[] = [];
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      ...stubClient({ installed: true, state: "ready", serviceRunning: true, port: 17007 }),
      getBridgeActions: vi.fn(async (cursor: number) =>
        cursor === 0
          ? { cursor: 0, items: [
              { id: 1, kind: "generate-images" },
              { id: 2, kind: "generate-videos" },
              { id: 3, kind: "generate-director-plan" },
              { id: 4, kind: "generate-storyboard-table" },
              { id: 5, kind: "rebuild-workbench-tracks" },
            ] }
          : { cursor, items: [] }),
      ackBridgeActions: vi.fn(async (upTo: number) => {
        calls.push(`ack:${upTo}`);
        return 2;
      }),
    } as ComfyEngineClient;
    const onGenerateImages = vi.fn(() => calls.push("dispatch:generate-images"));
    const onGenerateVideos = vi.fn(() => calls.push("dispatch:generate-videos"));
    const onGenerateDirectorPlan = vi.fn(() => calls.push("dispatch:generate-director-plan"));
    const onGenerateStoryboardTable = vi.fn(() => calls.push("dispatch:generate-storyboard-table"));
    const onRebuildWorkbenchTracks = vi.fn(() => calls.push("dispatch:rebuild-workbench-tracks"));
    render(<ComfyCanvasStudio sidebarActions={{ onGenerateImages, onGenerateVideos, onGenerateDirectorPlan, onGenerateStoryboardTable, onRebuildWorkbenchTracks }} />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    webview.dispatchEvent(new Event("dom-ready"));
    await waitFor(() => expect(calls).toEqual([
      "dispatch:generate-images",
      "dispatch:generate-videos",
      "dispatch:generate-director-plan",
      "dispatch:generate-storyboard-table",
      "dispatch:rebuild-workbench-tracks",
      "ack:5",
    ]));
    expect(onGenerateImages).toHaveBeenCalledTimes(1);
    expect(onGenerateVideos).toHaveBeenCalledTimes(1);
  });

  it("补充要求透传(09-12 B1):动作带 note → 付费回调收到 userInstruction 语义参数", async () => {
    const calls: string[] = [];
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      ...stubClient({ installed: true, state: "ready", serviceRunning: true, port: 17007 }),
      getBridgeActions: vi.fn(async (cursor: number) =>
        cursor === 0
          ? { cursor: 0, items: [
              { id: 1, kind: "generate-director-plan", note: "多加两个反派伏笔" },
              { id: 2, kind: "generate-storyboard-table" },
            ] }
          : { cursor, items: [] }),
      ackBridgeActions: vi.fn(async () => 2),
    } as ComfyEngineClient;
    const onGenerateDirectorPlan = vi.fn((note?: string) => calls.push(`plan:${note ?? ""}`));
    const onGenerateStoryboardTable = vi.fn((note?: string) => calls.push(`table:${note ?? ""}`));
    render(<ComfyCanvasStudio sidebarActions={{
      onGenerateImages: () => calls.push("images"),
      onGenerateVideos: () => calls.push("videos"),
      onGenerateDirectorPlan,
      onGenerateStoryboardTable,
    }} />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    webview.dispatchEvent(new Event("dom-ready"));
    await waitFor(() => expect(calls).toEqual([
      "plan:多加两个反派伏笔",
      "table:",
    ]));
  });

  it("单镜视频入口(09-14):open-shot-video 动作→上传关键帧→写库→注入打开脚本", async () => {
    storeState.storyboards = [
      {
        id: "sb-9", index: 1, episodeId: "chapter-001", videoDesc: "雨夜石桥",
        prompt: "备用", duration: 5, durationTarget: 5, lines: "", sound: "雨声",
        shotSemantics: { actionIn: "雨幕落下", actionOut: "水面涟漪" },
        mediaRef: { kind: "image", path: "project-file://frame.png" },
      },
    ] as unknown[];
    storeState.novelChapters = [{ id: "chapter-001", title: "第一章 雨夜" }];
    const uploaded: string[] = [];
    // 门闩:挂载首轮 tick 的微任务链会先于 spy 挂载跑完打开脚本——把动作
    // 释放挪到 executeJavaScript spy 就位之后,消除竞态
    let releaseActions: (() => void) | undefined;
    const actionsGate = new Promise<void>((resolve) => { releaseActions = resolve; });
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = {
      ...stubClient({ installed: true, state: "ready", serviceRunning: true, port: 17008 }),
      getBridgeActions: vi.fn(async (cursor: number) => {
        if (cursor !== 0) return { cursor, items: [] };
        await actionsGate;
        return { cursor: 1, items: [{ id: 1, kind: "open-shot-video", note: "sb-9" }] };
      }),
      ackBridgeActions: vi.fn(async () => 1),
      uploadBridgeReference: vi.fn(async (name: string) => {
        uploaded.push(name);
        return { accepted: true, name };
      }),
    } as ComfyEngineClient;
    render(<ComfyCanvasStudio />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    const scripts: string[] = [];
    webview.executeJavaScript = (code: string) => {
      scripts.push(code);
      return Promise.resolve(undefined);
    };
    releaseActions?.();
    const payload = await waitFor(() => {
      const hit = scripts.find((code) => code.includes("单镜视频"));
      if (!hit) throw new Error("单镜视频打开脚本未注入");
      return hit;
    }, { timeout: 3000 });
    // 全尺寸关键帧以专用名上传(禁用 768px 缩略图当 H3 首帧)
    expect(uploaded).toEqual(["my-shot-h3-sb-9.jpg"]);
    // 库写入位=视频域自研家应用写入位;打开脚本带锚卡与秒数节点载荷
    expect(importFilesMock).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "分镜/3_单镜视频/MY-单镜视频 · 第一章 雨夜 · S01.json" })],
      "overwrite",
    );
    expect(payload).toContain("MyShot");
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it("autoOpen+有分镜:注入分镜流程链工作流载荷(旧画布迁移 09-11)", async () => {
    storeState.storyboards = [
      { id: "sb-1", index: 1, episodeId: "chapter-001", videoDesc: "第1镜", mediaRef: { kind: "image", path: "/a.png" } },
    ] as unknown[];
    storeState.novelChapters = [{ id: "c1" }];
    (window as { comfyEngine?: ComfyEngineClient }).comfyEngine = stubClient({
      installed: true,
      state: "ready",
      serviceRunning: true,
      port: 17006,
    });
    render(<ComfyCanvasStudio autoOpenOverview />);
    const webview = (await waitFor(() => {
      const el = document.querySelector("[data-comfy-canvas-webview]") as
        (HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> }) | null;
      if (!el) throw new Error("webview 未挂");
      return el;
    }, { timeout: 3000 }))!;
    const scripts: string[] = [];
    webview.executeJavaScript = (code: string) => {
      scripts.push(code);
      return Promise.resolve(undefined);
    };
    webview.dispatchEvent(new Event("dom-ready"));
    // local 默认模块 2 段 + 链工作流载荷 1 段;09-12 封面转换异步化后
    // 载荷注入落在微任务后——waitFor 等第 3 段到位再断内容
    const payload = await waitFor(() => {
      if (scripts.length < 3) throw new Error("链工作流载荷未注入");
      return scripts[2];
    }, { timeout: 3000 });
    // 载荷=链工作流:七环节 MyStage+MY_FLOW 连线+分镜网格+摘要
    expect(payload).toContain('"type":"MyStage"');
    expect(payload).toContain("MyShot");
    expect((payload.match(/MyStage/g) || []).length).toBeGreaterThanOrEqual(7);
    expect(payload).toContain("MY_FLOW");
    expect(payload).toContain("已导入 1 章原文");
    expect(payload).toContain("第1镜");
    // 09-12 stage-node-content-parity:富内容载荷随链工作流注入(自绘消费)
    expect(payload).toContain("myStage");
    expect(payload).toContain("剧本内容");
  });
});

describe("buildOverviewOpenScript(工作流阶段自动打开分镜总览 09-10;09-12 单实例协议通道)", () => {
  it("一次性守卫+轮询等 window.app+协议通道优先+带名兜底;分镜图嵌在载荷里", () => {
    const graph = { nodes: [{ id: 1, type: "MyShot" }], links: [] };
    const workflowId = "分镜/0_工作流主线/MY-分镜工作流.json";
    const script = buildOverviewOpenScript(graph, workflowId);

    // 一次性守卫:已开过不再覆盖用户手动切换的工作流
    expect(script).toContain("if (!window.__myOverviewAutoOpened) tryLoad(0)");
    // 轮询等待(新前端 GraphView 异步赋 window.app)+graph 初始化完成
    // (09-11 竞态根修:window.app 早于 graph 就绪,只查方法会在未初始化
    // graph 上 loadGraphData——上游打 "graph accessed before initialization"
    // 且加载半途断掉)
    expect(script).toContain("app.isGraphReady === true");
    expect(script).toContain('typeof app.loadGraphData === "function"');
    expect(script).toContain("setTimeout");
    // 09-12 单实例协议:扩展提供的全局助手优先(绑定库文件+复用既有签)
    // 09-14 manying→my:双锚(新 __myOpenWorkflow 优先,旧 __manyingOpenWorkflow 兜底)
    expect(script).toContain("window.__myOpenWorkflow || window.__manyingOpenWorkflow");
    expect(script).toContain("void opener(payload)");
    // 助手缺席(旧引擎)先等几拍再带名直载兜底:name=库内相对全路径
    // (loadGraphData 第4参语义;裸文件名落 workflows 根层命中不了库条目)
    expect(script).toContain('app.loadGraphData(payload.graph, true, true, payload.name)');
    expect(script).toContain(JSON.stringify(workflowId));
    // 载荷以对象字面量内嵌,分镜节点在
    expect(script).toContain('"type":"MyShot"');
    // 守卫在实际载入时才置位(app 未出现时后续注入仍可重试)
    expect(script.indexOf("__myOverviewAutoOpened = true")).toBeGreaterThan(
      script.indexOf('typeof app.loadGraphData === "function"'),
    );
  });
});

describe("buildCanvasFitScript(画布满幅矫正 09-11:分镜工作流画布未占满全屏根修)", () => {
  it("一次性守卫+位图错配才动+照上游 resizeCanvas 语义(CSS×dpr→设位图→scale→draw)", () => {
    const script = buildCanvasFitScript();
    // 幂等键(双事件兜底重复注入无害)
    expect(script).toContain("if (window.__myCanvasFit) return");
    expect(script).toContain("window.__myCanvasFit = true");
    // 目标画布=ComfyUI 主画布
    expect(script).toContain('document.querySelector("#graph-canvas")');
    // 错配才动:位图宽高与 CSS×dpr 逐项比对
    expect(script).toContain("Math.max(window.devicePixelRatio || 1, 1)");
    expect(script).toContain("if (c.width === wantW && c.height === wantH) return");
    // 矫正后 ctx 缩放+主动重绘(上游 resizeCanvas 同款收尾)
    expect(script).toContain("ctx.scale(scale, scale)");
    expect(script).toContain("app.canvas.draw(true, true)");
    // 竞态窗口兜底:加载事件+周期巡检有界停
    expect(script).toContain('addEventListener("load", fit)');
    expect(script).toContain("setInterval");
    expect(script).toContain("clearInterval(iv)");
  });
});
