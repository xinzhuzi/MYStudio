import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadExtension() {
  const extensions: Array<{ setup?: () => void; beforeRegisterNodeDef?: (type: unknown, data: unknown) => void }> = [];
  const node = { comfyClass: "MyGenerated", widgets: [{ name: "shot_target", value: "" }, { name: "meta", value: '{"seed":3}' }] };
  const queue = vi.fn(async (...args: unknown[]) => { void args; return { prompt_id: "queued" }; });
  const app = { canvas: { selected_node: node }, graph: { change: vi.fn() }, registerExtension: (extension: typeof extensions[number]) => extensions.push(extension) };
  const api = { queuePrompt: queue };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ originProjectId: "project-a", updatedAt: Date.now(), staleAfterMs: 900000 }) }));
  const confirm = vi.fn(() => true);
  const context = vm.createContext({ app, api, window: { confirm, alert: vi.fn() }, fetch: fetchMock, Date, URLSearchParams });
  const source = readFileSync(resolve("backend/engines/comfyui/my_nodes/web/theme.js"), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace(/export\s*\{[^}]+\};/g, "")
    .replace(/\bexport (?=(?:const|let|async|function)\b)/g, "");
  vm.runInContext(`${source}\nglobalThis.originTools = { applyShotToSelection };`, context);
  for (const extension of extensions) extension.setup?.();
  return { api, queue, node, extensions, fetchMock, confirm, tools: context.originTools as { applyShotToSelection: (id: string, label: string, project: string) => { ok: boolean } } };
}

describe("Comfy writeback explicit project origin", () => {
  it("binds selected shot with its origin while preserving metadata", () => {
    const { tools, node } = loadExtension();
    expect(tools.applyShotToSelection("shot-a", "S01", "project-a").ok).toBe(true);
    expect(JSON.parse(node.widgets[1].value)).toMatchObject({ seed: 3, originProjectId: "project-a" });
  });

  it("rejects unbound serialized image before submitting any prompt", async () => {
    const { api, queue } = loadExtension();
    await expect(api.queuePrompt(0, { output: { 1: { class_type: "MyGenerated", inputs: { meta: "", shot_target: "" } } }, workflow: { nodes: [] } })).rejects.toThrow(/绑定/);
    expect(queue).not.toHaveBeenCalled();
  });

  it("preserves a queued image origin without querying current host state", async () => {
    const { api, queue, fetchMock } = loadExtension();
    const data = { output: { 1: { class_type: "ManyingGenerated", inputs: { meta: '{"originProjectId":"project-a"}' } } }, workflow: { nodes: [] } };
    await api.queuePrompt(0, data);
    expect(queue).toHaveBeenCalledWith(0, data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "   ", 17, null])("rejects invalid origin %j without submission", async (originProjectId) => {
    const { api, queue } = loadExtension();
    await expect(api.queuePrompt(0, { output: { 1: { class_type: "MyGenerated", inputs: { meta: JSON.stringify({ originProjectId }) } } } })).rejects.toThrow(/绑定/);
    expect(queue).not.toHaveBeenCalled();
  });

  it("does not block unrelated partial execution because of an idle unbound output", async () => {
    const { api, queue } = loadExtension();
    const data = { output: { 1: { class_type: "MyGenerated", inputs: { meta: "" } }, 2: { class_type: "PreviewImage", inputs: {} } } };
    await api.queuePrompt(0, data, { partialExecutionTargets: ["2"] });
    expect(queue).toHaveBeenCalledOnce();
  });

  it("requires the video anchor's own project instead of another node's origin", async () => {
    const { api, queue } = loadExtension();
    const data = { output: { 100: { class_type: "MyShot", inputs: { video: ["4", 0] } } }, workflow: { nodes: [{ id: 99, properties: { myOriginProjectId: "project-a" } }, { id: 100 }] } };
    await expect(api.queuePrompt(0, data)).rejects.toThrow(/绑定/);
    expect(queue).not.toHaveBeenCalled();
    data.workflow.nodes[1] = { id: 100, properties: { myOriginProjectId: "project-a" } };
    await api.queuePrompt(0, data);
    expect(queue).toHaveBeenCalledOnce();
  });

  it("lets a standalone empty-target node explicitly bind the displayed project", async () => {
    const { extensions, confirm } = loadExtension();
    const widgets: Array<{ name: string; value: string; callback?: () => Promise<void>; options?: unknown }> = [{ name: "meta", value: '{"seed":4}' }, { name: "shot_target", value: "" }];
    class Node {
      widgets = widgets;
      addWidget(_kind: string, name: string, _value: unknown, callback: () => Promise<void>, options: unknown) { const widget = { name, value: "", callback, options }; this.widgets.push(widget); return widget; }
    }
    for (const extension of extensions) extension.beforeRegisterNodeDef?.(Node, { name: "MyGenerated" });
    const node = new Node() as Node & { onNodeCreated: () => void };
    node.onNodeCreated();
    const button = widgets.find((widget) => widget.callback);
    expect(button).toBeDefined();
    await button?.callback?.();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("project-a"));
    expect(JSON.parse(widgets[0].value)).toMatchObject({ seed: 4, originProjectId: "project-a" });
    expect(button?.name).toContain("project-a");
    expect(button?.options).toMatchObject({ serialize: false });
  });

  it("rejects a stale binding snapshot and preserves existing node metadata", async () => {
    const { extensions, node, fetchMock } = loadExtension();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ originProjectId: "old-project", updatedAt: Date.now() - 20000, staleAfterMs: 900000 }) });
    let bind: (() => Promise<void>) | undefined;
    class Node {
      widgets = node.widgets;
      addWidget(_kind: string, _name: string, _value: unknown, callback: () => Promise<void>) { bind = callback; return { name: "绑定当前项目" }; }
    }
    for (const extension of extensions) extension.beforeRegisterNodeDef?.(Node, { name: "MyGenerated" });
    (new Node() as Node & { onNodeCreated: () => void }).onNodeCreated();
    await bind?.();
    expect(node.widgets[1].value).toBe('{"seed":3}');
  });
});
