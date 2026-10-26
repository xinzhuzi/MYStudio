// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeComfyBridgeActions } from "./comfy-bridge-action-consumer";

function loadActionBridge(mainResponse?: () => unknown) {
  // 0924 令牌随机化后 postAction 走双读:无 window 注入令牌时先 GET /my_bridge/config
  // 取令牌再发主请求——mock 按 URL 分流,主请求响应可注入(失败态用例)
  const fetchMock = vi.fn(async (input: unknown) => {
    if (String(input).includes("/my_bridge/config")) {
      return { ok: true, json: async () => ({ bridgeToken: "bridge-token-test" }) };
    }
    return mainResponse ? mainResponse() : { ok: true, status: 200 };
  });
  const alert = vi.fn();
  const context = vm.createContext({ window: { alert }, fetch: fetchMock });
  const source = readFileSync(resolve("backend/comfyui/my_nodes/web/bridge-action.js"), "utf8").replace(/\bexport /g, "");
  vm.runInContext(`${source}\nglobalThis.submit = postAction;`, context);
  return { fetchMock, alert, submit: context.submit as (kind: string, note: string, button: unknown, origin?: string, episode?: string) => void };
}

function actionCalls(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/comfy/bridge/actions"));
}

function loadNodeExtension(file: string) {
  const extensions: Array<{ beforeRegisterNodeDef?: (type: unknown, data: unknown) => Promise<void> }> = [];
  const postAction = vi.fn();
  const ui = { key: "test", render: () => "" };
  const context = vm.createContext({
    window: {}, document, Element, postAction,
    app: { registerExtension: (extension: typeof extensions[number]) => extensions.push(extension), canvas: { setDirty: vi.fn() } },
    THEME: {}, CINEMA_TOKENS: { status: {} }, SIZE: {},
    scriptUI: ui, directorPlanUI: ui, assetsUI: ui, storyboardTableUI: ui, storyboardPanelUI: ui, shotProductionUI: ui, workbenchUI: ui,
  });
  const source = readFileSync(resolve(`backend/comfyui/my_nodes/web/${file}`), "utf8").replace(/^import .*;$/gm, "");
  vm.runInContext(source, context);
  return { context, extensions, postAction };
}

describe("Comfy action origin binding", () => {
  it("submits the explicitly bound node project with the action", async () => {
    const { fetchMock, submit } = loadActionBridge();
    submit("generate-images", "source note", null, "project-a", "chapter-a");
    // 双读链路异步:主请求在 /my_bridge/config 之后发出
    await vi.waitFor(() => expect(actionCalls(fetchMock)).toHaveLength(1));
    const request = actionCalls(fetchMock)[0]! as [string, { body: string; headers: Record<string, string> }];
    expect(JSON.parse(request[1].body)).toEqual({ kind: "generate-images", note: "source note", originProjectId: "project-a", originEpisodeId: "chapter-a" });
    expect(request[1].headers["X-Manying-Image-Token"]).toBe("bridge-token-test");
  });

  it("never fetches active project or submits an unbound legacy node", () => {
    const { fetchMock, submit, alert } = loadActionBridge();
    submit("generate-images", "", null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("项目"));
  });

  it.each(["rejected", "disconnected"])("shows submission failure when the action is %s without auto-retry", async (failure) => {
    // 失败态注入在主请求响应上(config 取令牌请求恒成功)
    const { fetchMock, submit, alert } = loadActionBridge(
      failure === "rejected" ? () => ({ ok: false, status: 400 }) : () => Promise.reject(new Error("offline")),
    );
    submit("generate-images", "", null, "project-a", "chapter-a");
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("制作动作提交失败")));
    expect(actionCalls(fetchMock)).toHaveLength(1);
  });

  it("stage DOM buttons use their node binding", () => {
    const { context, postAction } = loadNodeExtension("stage-node.js");
    vm.runInContext("globalThis.wire = wireActions;", context);
    const el = document.createElement("div");
    el.innerHTML = '<button class="ms-btn" data-kind="generate-images">Generate</button>';
    const node = { properties: { myOriginProjectId: "project-a", myOriginEpisodeId: "chapter-a" } };
    (context.wire as (node: unknown, el: HTMLElement) => void)(node, el);
    el.querySelector("button")!.click();
    expect(postAction).toHaveBeenCalledWith("generate-images", "", el.querySelector("button"), "project-a", "chapter-a");
  });

  it.each([false, true])("stage context menu retains its origin after in-place update=%s", async (inPlace) => {
    const { extensions, postAction } = loadNodeExtension("stage-node.js");
    class Node {
      properties = { myOriginProjectId: "project-a", myOriginEpisodeId: "chapter-a", myStage: { key: "assets", actions: [{ kind: "extract-assets", label: "Extract" }] } };
    }
    await extensions[0].beforeRegisterNodeDef?.(Node, { name: "MyStage" });
    const node = new Node() as Node & { getExtraMenuOptions: (canvas: unknown, options: Array<{ callback: () => void }>) => void };
    const options: Array<{ callback: () => void }> = [];
    node.getExtraMenuOptions(null, options);
    if (inPlace) {
      node.properties.myOriginProjectId = "project-b";
      node.properties.myOriginEpisodeId = "chapter-b";
    } else {
      node.properties = { ...node.properties, myOriginProjectId: "project-b", myOriginEpisodeId: "chapter-b" };
    }
    options.forEach((option) => option.callback());
    expect(postAction).toHaveBeenCalledWith("extract-assets", null, null, "project-a", "chapter-a");
  });

  it("canvas fallback and MyShot buttons pass their own node binding", async () => {
    const canvas = loadNodeExtension("stage-canvas.js");
    class Stage {
      properties = { myOriginProjectId: "project-a", myOriginEpisodeId: "chapter-a" };
      __myActionRects = [{ x: 0, y: 0, w: 30, h: 30, kind: "generate-images" }];
    }
    await canvas.extensions[0].beforeRegisterNodeDef?.(Stage, { name: "MyStage" });
    (new Stage() as Stage & { onMouseDown: (pos: number[]) => void }).onMouseDown([1, 1]);
    expect(canvas.postAction).toHaveBeenCalledWith("generate-images", "", null, "project-a", "chapter-a");

    const shot = loadNodeExtension("shot-node.js");
    class Shot {
      properties = { myOriginProjectId: "project-a", myOriginEpisodeId: "chapter-a" };
      widgets = [{ value: "shot-a" }, { value: "" }, { value: "" }, { value: "图✓" }];
      size = [300, 276];
      addDOMWidget() { return {}; }
    }
    await shot.extensions[0].beforeRegisterNodeDef?.(Shot, { name: "MyShot" });
    const node = new Shot() as Shot & { onNodeCreated: () => void; __myShotActions: { button: HTMLButtonElement } };
    node.onNodeCreated();
    node.__myShotActions.button.click();
    expect(shot.postAction).toHaveBeenCalledWith("open-shot-video", "shot-a", node.__myShotActions.button, "project-a", "chapter-a");
  });

  it("delegated H3 rows carry their rendered project snapshot", () => {
    const postAction = vi.fn();
    const context = vm.createContext({
      window: {}, document, Element, postAction, myTooltipsEnabled: false,
      esc: (value: unknown) => String(value), badge: () => "", liveBadgesHTML: () => "", emptyHTML: () => "",
    });
    const source = readFileSync(resolve("backend/comfyui/my_nodes/web/stage-ui/shot-production.js"), "utf8")
      .replace(/^import .*;$/gm, "").replace("export default", "globalThis.ui =");
    vm.runInContext(source, context);
    const el = document.createElement("div");
    el.innerHTML = (context.ui as { render: (payload: unknown) => string }).render({ originProjectId: "project-a", originEpisodeId: "chapter-a", shots: [{ id: "shot-a", index: 1, imageReady: true, label: "S01" }] });
    document.body.append(el);
    const button = el.querySelector("button")!;
    button.click();
    expect(postAction).toHaveBeenCalledWith("open-shot-video", "shot-a", button, "project-a", "chapter-a");
    el.remove();
  });

  it("sidebar actions keep the displayed snapshot when host state changes", async () => {
    let snapshot = { originProjectId: "project-a", currentEpisodeId: "chapter-a", shots: [] };
    const fetchShots = vi.fn(async () => snapshot);
    const postJson = vi.fn(async () => ({}));
    const makeElement = () => document.createElement("div");
    const context = vm.createContext({
      window: {}, document,
      app: { registerExtension: vi.fn() }, BRIDGE_URL: "http://bridge", THEME: {}, ICONS: {},
      fetchShots, postJson, fetchJson: async () => snapshot,
      snapshotOrigin: (data: typeof snapshot | null) => { if (!data) throw new Error("missing snapshot"); return data.originProjectId; },
      sectionLabel: makeElement, paneStatus: makeElement, icon: () => document.createElement("span"),
      actionButton: ({ label }: { label: string }) => { const button = document.createElement("button"); button.textContent = label; return button; },
    });
    const source = readFileSync(resolve("backend/comfyui/my_nodes/web/sidebar.js"), "utf8")
      .replace(/^import\s+[\s\S]*?from\s+"[^"]+";\s*$/gm, "")
      .replace(/export\s*\{[^}]+\};/g, "");
    vm.runInContext(`${source}\nglobalThis.renderPane = renderShotsPane;`, context);
    const pane = document.createElement("div");
    (context.renderPane as (element: HTMLElement) => void)(pane);
    await vi.waitFor(() => expect(pane.textContent).toContain("当前章节还没有分镜"));
    snapshot = { ...snapshot, originProjectId: "project-b" };
    const button = [...pane.querySelectorAll("button")].find((item) => item.textContent === "一键生图")!;
    button.click();
    await vi.waitFor(() => expect(postJson).toHaveBeenCalledWith("http://bridge/comfy/bridge/actions", { kind: "generate-images", originProjectId: "project-a", originEpisodeId: "chapter-a" }));
    expect(fetchShots).toHaveBeenCalledOnce();
  });
});

// ── livefire9/10 根因:盖戳保鲜(kept-modified 短路下 __myStagePatch 只刷
// myStage 载荷不刷 myOrigin* 盖戳 → 节点卡显示新章而点击仍带旧章戳,宿主消费
// 腿按章匹配静默跳过 = ch002 两试零 toast 零 run)───────────────────────
describe("stage patch origin freshness", () => {
  function loadStagePatch() {
    const { context } = loadNodeExtension("stage-node.js");
    const live = {
      properties: {
        myOriginProjectId: "project-a",
        myOriginEpisodeId: "chapter-001",
        myStage: { key: "scriptPlan", statusText: "未开始", previewLines: ["旧载荷"] },
      },
    };
    (context.window as { app?: unknown }).app = { graph: { _nodes: [live] } };
    const patch = (context.window as {
      __myStagePatch?: (graph: unknown) => { ok: boolean; patched: number };
    }).__myStagePatch;
    if (typeof patch !== "function") throw new Error("__myStagePatch 未加载");
    return { patch, live };
  }

  it("refreshes node origin stamps when the host reinjects a new chapter", () => {
    const { patch, live } = loadStagePatch();
    const result = patch({ nodes: [{
      properties: {
        myOriginProjectId: "project-a",
        myOriginEpisodeId: "chapter-002",
        myStage: { key: "scriptPlan", statusText: "未开始", previewLines: ["新载荷"] },
      },
    }] });
    expect(result).toEqual({ ok: true, patched: 1 });
    expect(live.properties.myOriginEpisodeId).toBe("chapter-002");
    expect(live.properties.myOriginProjectId).toBe("project-a");
  });

  it("refreshes origin stamps even when the stage payload is unchanged", () => {
    const { patch, live } = loadStagePatch();
    const result = patch({ nodes: [{
      properties: {
        myOriginProjectId: "project-a",
        myOriginEpisodeId: "chapter-002",
        myStage: { key: "scriptPlan", statusText: "未开始", previewLines: ["旧载荷"] },
      },
    }] });
    expect(result).toEqual({ ok: true, patched: 0 });
    expect(live.properties.myOriginEpisodeId).toBe("chapter-002");
  });
});

// ── livefire9 死点:消费腿章匹配静默 continue(comfy-bridge-action-consumer
// L71-72)——动作滞留必须一次性现形(toast+diagnostics),滞留语义保留(切回
// 对应章后仍可补发)──────────────────────────────────────────────────────
describe("host consumer defer visibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem("mystudio-comfy-action-receipts-v1");
    delete (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog;
  });

  let deferSequence = 0;
  function consumerFixture(items: Array<{ id: number; kind: string; originProjectId?: string; originEpisodeId?: string }>) {
    const state = {
      queueId: `defer-queue-${++deferSequence}`,
      items: items.map((item) => ({ originEpisodeId: "chapter-001", ...item })),
    };
    const client = {
      getBridgeActions: vi.fn(async () => ({ cursor: 0, queueId: state.queueId, items: state.items.map((item) => ({ ...item })) })),
      ackBridgeActions: vi.fn(async (_upTo: number, _queueId?: string, ids?: number[]) => {
        state.items = state.items.filter((item) => !ids?.includes(item.id));
        return ids?.length ?? 0;
      }),
    };
    const handler = vi.fn();
    const options = {
      client,
      projectId: "a",
      episodeId: "chapter-002",
      isActive: () => true,
      handlerFor: () => handler,
      onError: vi.fn(),
    };
    return { client, handler, options };
  }

  function diagnosticsMessages(mock: ReturnType<typeof vi.fn>) {
    return mock.mock.calls.map(([entry]) => entry as { message?: string });
  }

  it("reports a cross-chapter action once without dispatching or acking it", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { client, handler, options } = consumerFixture([
      { id: 7, kind: "generate-director-plan", originProjectId: "a", originEpisodeId: "chapter-001" },
    ]);
    await consumeComfyBridgeActions(options);
    await consumeComfyBridgeActions(options);
    expect(handler).not.toHaveBeenCalled();
    expect(client.ackBridgeActions).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledTimes(1);
    const message = String((options.onError.mock.calls[0] as unknown[])[0]);
    expect(message).toContain("chapter-001");
    expect(message).toContain("chapter-002");
    expect(diagnosticsMessages(diagnostics).filter((entry) => entry.message === "comfyAction.deferred")).toHaveLength(1);
  });

  it("still delivers the retained action once the host returns to its chapter", async () => {
    const { handler, options } = consumerFixture([
      { id: 8, kind: "generate-director-plan", originProjectId: "a", originEpisodeId: "chapter-001" },
    ]);
    await consumeComfyBridgeActions(options);
    options.episodeId = "chapter-001";
    await consumeComfyBridgeActions(options);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("logs a dispatch event when a matching action is delivered", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { options } = consumerFixture([
      { id: 9, kind: "generate-director-plan", originProjectId: "a", originEpisodeId: "chapter-001" },
    ]);
    options.episodeId = "chapter-001";
    await consumeComfyBridgeActions(options);
    const dispatched = diagnosticsMessages(diagnostics).filter((entry) => entry.message === "comfyAction.dispatch");
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as { context?: { kind?: string } }).context?.kind).toBe("generate-director-plan");
  });
});
