// @vitest-environment jsdom
// ComfyUI 画布工作室 tab 测试(09-09 0b):三态渲染(未装/就绪未跑/运行中 webview)。

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyCanvasStudio, buildCanvasFitScript, buildOverviewOpenScript } from "./ComfyCanvasStudio";
import { createMockComfyEngineClient } from "@/components/panels/settings/comfy-engine/mock-comfy-engine-client";
import type { ComfyEngineClient, ComfyEngineStatus } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

afterEach(() => {
  cleanup();
  delete (window as { comfyEngine?: ComfyEngineClient }).comfyEngine;
  vi.clearAllMocks();
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
    // 注入顺序:登录遮蔽 → 画布满幅矫正(09-11) →(autoOpen 时)总览打开
    expect(scripts).toHaveLength(2);
    const script = scripts[0];
    // 真源=manying_login_cloak.js(二轮精确化:按钮整文案精确命中+卡片锚
    // 向上找;不扫容器/不碰 title/aria/弹窗——Comfy 设置页零接触)
    expect(script).toContain("manyingLoginCloak");
    expect(script).toContain('"登录 / 注册"');
    expect(script).toContain('"登录您的账户"');
    expect(script).toContain('button, a, [role="button"]');
    expect(script).toContain("MutationObserver");
    expect(script).toContain('display", "none", "important');
    expect(script).toContain("__manyingSignInCloak");
    expect(script).not.toContain("p, span, div"); // 宽扫描面=事故源,禁回归
    webview.dispatchEvent(new Event("did-finish-load"));
    expect(scripts).toHaveLength(4); // 双事件兜底同款节律(每发 2 脚本:遮蔽+满幅矫正)
  });
});

describe("buildOverviewOpenScript(工作流阶段自动打开分镜总览 09-10)", () => {
  it("一次性守卫+轮询等 window.app+载荷直载 loadGraphData;分镜图嵌在载荷里", () => {
    const graph = { nodes: [{ id: 1, type: "ManyingShot" }], links: [] };
    const script = buildOverviewOpenScript(graph);

    // 一次性守卫:已开过不再覆盖用户手动切换的工作流
    expect(script).toContain("if (!window.__manyingOverviewAutoOpened) tryLoad(0)");
    // 轮询等待(新前端 GraphView 异步赋 window.app)+graph 初始化完成
    // (09-11 竞态根修:window.app 早于 graph 就绪,只查方法会在未初始化
    // graph 上 loadGraphData——上游打 "graph accessed before initialization"
    // 且加载半途断掉)
    expect(script).toContain("app.isGraphReady === true");
    expect(script).toContain('typeof app.loadGraphData === "function"');
    expect(script).toContain("setTimeout");
    // 载荷以对象字面量内嵌,分镜节点在
    expect(script).toContain('"type":"ManyingShot"');
    // 守卫在实际载入时才置位(app 未出现时后续注入仍可重试)
    expect(script.indexOf("__manyingOverviewAutoOpened = true")).toBeGreaterThan(
      script.indexOf('typeof app.loadGraphData === "function"'),
    );
  });
});

describe("buildCanvasFitScript(画布满幅矫正 09-11:分镜工作流画布未占满全屏根修)", () => {
  it("一次性守卫+位图错配才动+照上游 resizeCanvas 语义(CSS×dpr→设位图→scale→draw)", () => {
    const script = buildCanvasFitScript();
    // 幂等键(双事件兜底重复注入无害)
    expect(script).toContain("if (window.__manyingCanvasFit) return");
    expect(script).toContain("window.__manyingCanvasFit = true");
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
