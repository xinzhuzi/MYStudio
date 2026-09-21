// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadActionBridge() {
  const fetchMock = vi.fn(async (...args: unknown[]) => { void args; return { ok: true, status: 200 }; });
  const alert = vi.fn();
  const context = vm.createContext({ window: { alert }, fetch: fetchMock });
  const source = readFileSync(resolve("backend/engines/comfyui/my_nodes/web/bridge-action.js"), "utf8").replace(/\bexport /g, "");
  vm.runInContext(`${source}\nglobalThis.submit = postAction;`, context);
  return { fetchMock, alert, submit: context.submit as (kind: string, note: string, button: unknown, origin?: string, episode?: string) => void };
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
  const source = readFileSync(resolve(`backend/engines/comfyui/my_nodes/web/${file}`), "utf8").replace(/^import .*;$/gm, "");
  vm.runInContext(source, context);
  return { context, extensions, postAction };
}

describe("Comfy action origin binding", () => {
  it("submits the explicitly bound node project with the action", () => {
    const { fetchMock, submit } = loadActionBridge();
    submit("generate-images", "source note", null, "project-a", "chapter-a");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request[1].body)).toEqual({ kind: "generate-images", note: "source note", originProjectId: "project-a", originEpisodeId: "chapter-a" });
  });

  it("never fetches active project or submits an unbound legacy node", () => {
    const { fetchMock, submit, alert } = loadActionBridge();
    submit("generate-images", "", null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("项目"));
  });

  it.each(["rejected", "disconnected"])("shows submission failure when the action is %s without auto-retry", async (failure) => {
    const { fetchMock, submit, alert } = loadActionBridge();
    if (failure === "rejected") fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    else fetchMock.mockRejectedValueOnce(new Error("offline"));
    submit("generate-images", "", null, "project-a", "chapter-a");
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("制作动作提交失败")));
    expect(fetchMock).toHaveBeenCalledOnce();
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
    const source = readFileSync(resolve("backend/engines/comfyui/my_nodes/web/stage-ui/shot-production.js"), "utf8")
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
    const source = readFileSync(resolve("backend/engines/comfyui/my_nodes/web/sidebar.js"), "utf8")
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
