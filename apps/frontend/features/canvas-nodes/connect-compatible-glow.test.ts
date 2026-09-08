// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { clearCompatibleHandles, markCompatibleHandles } from "./connect-compatible-glow";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  addRerouteImageNode,
  connectImageWorkflowNodes,
  createImageWorkflowGraph,
} from "@/lib/studio/image-workflow/graph-build";
import type { ImageWorkflowGraph } from "@/types/studio";

/** connecting 兼容口高亮(09-09):判定与画布 isValidConnection 同源(域规则+
 * comfy 口型),DOM 类标记驱动。 */

function mountHandle(nodeId: string, handleDir: "target" | "source", handleId?: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "react-flow__node";
  node.setAttribute("data-id", nodeId);
  const handle = document.createElement("div");
  handle.className = "react-flow__handle";
  handle.setAttribute("data-canvas-handle-dir", handleDir);
  if (handleId !== undefined) handle.setAttribute("data-handleid", handleId);
  node.appendChild(handle);
  document.body.appendChild(node);
  return handle;
}

afterEach(() => {
  document.body.innerHTML = "";
  clearCompatibleHandles();
});

describe("connect-compatible-glow(拖线兼容口高亮)", () => {
  it("兼容目标口加光晕类;源节点自身的口不高亮", () => {
    let graph: ImageWorkflowGraph = createImageWorkflowGraph();
    graph = addReferenceImageNode(graph, { id: "ref1", imageUrl: "local-image://a.png", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g1", position: { x: 500, y: 0 } });
    const genHandle = mountHandle("g1", "target");
    const srcHandle = mountHandle("ref1", "source");
    markCompatibleHandles(graph, { nodeId: "ref1", handleId: null });
    expect(genHandle.classList.contains("connect-compatible-glow")).toBe(true);
    expect(srcHandle.classList.contains("connect-compatible-glow")).toBe(false);
  });

  it("空转中转源(无入边)解析不出真源:目标口不得标", () => {
    let graph: ImageWorkflowGraph = createImageWorkflowGraph();
    graph = addRerouteImageNode(graph, { id: "rr1", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g1", position: { x: 500, y: 0 } });
    const genHandle = mountHandle("g1", "target");
    markCompatibleHandles(graph, { nodeId: "rr1", handleId: null });
    expect(genHandle.classList.contains("connect-compatible-glow")).toBe(false);
  });

  it("席位容量已满的口不得标(prompt 单根满席)", () => {
    let graph: ImageWorkflowGraph = createImageWorkflowGraph();
    graph = addPromptImageNode(graph, { id: "p1", prompt: "占席", position: { x: 0, y: 0 } });
    graph = addPromptImageNode(graph, { id: "p2", prompt: "第二根", position: { x: 0, y: 100 } });
    graph = addGeneratedImageNode(graph, { id: "g1", position: { x: 500, y: 0 } });
    graph = connectImageWorkflowNodes(graph, { source: "p1", target: "g1" });
    const genHandle = mountHandle("g1", "target");
    markCompatibleHandles(graph, { nodeId: "p2", handleId: null });
    // p1 已占提示词席(prompt-attach):p2 不可再连 → 不高亮
    expect(genHandle.classList.contains("connect-compatible-glow")).toBe(false);
  });

  it("clearCompatibleHandles 清空全部标记", () => {
    let graph: ImageWorkflowGraph = createImageWorkflowGraph();
    graph = addReferenceImageNode(graph, { id: "ref1", imageUrl: "local-image://a.png", position: { x: 0, y: 0 } });
    graph = addGeneratedImageNode(graph, { id: "g1", position: { x: 500, y: 0 } });
    const genHandle = mountHandle("g1", "target");
    markCompatibleHandles(graph, { nodeId: "ref1", handleId: null });
    expect(genHandle.classList.contains("connect-compatible-glow")).toBe(true);
    clearCompatibleHandles();
    expect(genHandle.classList.contains("connect-compatible-glow")).toBe(false);
  });
});
