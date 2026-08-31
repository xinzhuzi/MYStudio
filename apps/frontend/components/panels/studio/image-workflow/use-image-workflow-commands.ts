import { useCallback, useEffect, useRef } from "react";
import type {
  CanvasCommand,
  CanvasCommandDispatcher,
  CanvasCommandResult,
} from "@/lib/studio/canvas-commands";
import { registerCanvasDispatcher } from "@/lib/studio/canvas-commands";
import { getCanvasNodeDefinition } from "@/lib/studio/canvas-node-registry";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  connectImageWorkflowNodes,
  removeImageWorkflowEdge,
  updateImageWorkflowNode,
  updateImageWorkflowNodePosition,
} from "@/lib/studio/image-workflow/graph-build";
import { nextStackedPosition } from "@/lib/studio/image-workflow/layout";
import { createConnectedImageNode } from "@/lib/studio/image-workflow/connect-create";
import type { ImageWorkflowGraph } from "@/types/studio";

/** 视口最小结构面(避免 React Flow 泛型变体摩擦) */
interface CanvasViewportSetter {
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
}

/**
 * image-workflow 画布面指令执行器(08-31-canvas-ops-layer):
 * 把类型化指令路由到既有 store actions(saveGraph/deleteNode/generateNode/
 * setSelectedNodeId/flowInstance),不改行为只加通道;注册进 lib 分发总线,
 * 自动化测试经 dispatchCanvasCommand("image-workflow", cmd) 驱动+断言。
 */
export function useImageWorkflowCommands({
  activeGraph,
  saveGraph,
  deleteNode,
  generateNode,
  setSelectedNodeId,
  flowInstance,
}: {
  activeGraph: ImageWorkflowGraph | null | undefined;
  saveGraph: (graph: ImageWorkflowGraph) => void;
  deleteNode: (nodeId: string) => void;
  generateNode: (nodeId: string) => void | Promise<void>;
  setSelectedNodeId: (nodeId: string | null) => void;
  flowInstance: CanvasViewportSetter | null;
}) {
  // dispatcher 每渲染取最新闭包,但注册引用保持稳定(总线不抖)
  const dispatcherRef = useRef<CanvasCommandDispatcher | null>(null);

  const dispatch = useCallback(
    (command: CanvasCommand): CanvasCommandResult => {
      const graph = activeGraph;
      if (!graph) return { ok: false, reason: "无活动图像工作流" };
      switch (command.kind) {
        case "add-node": {
          if (!getCanvasNodeDefinition("image-workflow", command.nodeType)) {
            return { ok: false, reason: `未注册节点类型 ${command.nodeType}` };
          }
          if (command.connectFrom) {
            const result = createConnectedImageNode(graph, {
              fromNodeId: command.connectFrom.nodeId,
              fromHandleType: command.connectFrom.handleType,
              type: command.nodeType as "generated" | "prompt" | "reference",
            });
            if (!result) return { ok: false, reason: "连线域规则拒绝(边只指向成图)" };
            saveGraph(result.graph);
            setSelectedNodeId(result.nodeId);
            return { ok: true, detail: { nodeId: result.nodeId } };
          }
          const position = nextStackedPosition(
            graph.nodes.filter((node) => node.position),
            command.nodeType as "generated" | "prompt" | "reference",
          );
          if (command.nodeType === "generated") {
            const next = addGeneratedImageNode(graph, { position });
            saveGraph(next);
            const nodeId = next.nodes[next.nodes.length - 1]?.id ?? "";
            setSelectedNodeId(nodeId);
            return { ok: true, detail: { nodeId } };
          }
          if (command.nodeType === "prompt") {
            const next = addPromptImageNode(graph, { position });
            saveGraph(next);
            const nodeId = next.nodes[next.nodes.length - 1]?.id ?? "";
            setSelectedNodeId(nodeId);
            return { ok: true, detail: { nodeId } };
          }
          const next = addReferenceImageNode(graph, { position, imageUrl: "" });
          saveGraph(next);
          const nodeId = next.nodes[next.nodes.length - 1]?.id ?? "";
          setSelectedNodeId(nodeId);
          return { ok: true, detail: { nodeId } };
        }
        case "update-node": {
          const node = graph.nodes.find((item) => item.id === command.nodeId);
          if (!node) return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          if (command.patch.position) {
            saveGraph(
              updateImageWorkflowNodePosition(graph, command.nodeId, command.patch.position),
            );
          }
          if (command.patch.title !== undefined) {
            saveGraph(updateImageWorkflowNode(graph, command.nodeId, { title: command.patch.title }));
          }
          return { ok: true, detail: { nodeId: command.nodeId } };
        }
        case "remove-node": {
          if (!graph.nodes.some((node) => node.id === command.nodeId)) {
            return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          }
          deleteNode(command.nodeId);
          return { ok: true, detail: { nodeId: command.nodeId } };
        }
        case "connect": {
          const source = graph.nodes.find((node) => node.id === command.source);
          const target = graph.nodes.find((node) => node.id === command.target);
          if (!source || !target) return { ok: false, reason: "连线端点不存在" };
          if (target.type !== "generated") {
            return { ok: false, reason: "连线域规则:边只指向成图节点" };
          }
          if (graph.edges.some((e) => e.source === command.source && e.target === command.target)) {
            return { ok: false, reason: "连线已存在(幂等拒绝)" };
          }
          const next = connectImageWorkflowNodes(graph, {
            source: command.source,
            target: command.target,
          });
          if (next === graph) return { ok: false, reason: "连线被域规则拒绝" };
          saveGraph(next);
          return { ok: true, detail: { edgeId: `${command.source}->${command.target}` } };
        }
        case "disconnect": {
          const edge = graph.edges.find((item) => item.id === command.edgeId);
          if (!edge) return { ok: false, reason: `连线不存在 ${command.edgeId}` };
          saveGraph(removeImageWorkflowEdge(graph, command.edgeId));
          return { ok: true, detail: { edgeId: command.edgeId } };
        }
        case "select": {
          if (
            command.nodeId !== null &&
            !graph.nodes.some((node) => node.id === command.nodeId)
          ) {
            return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          }
          setSelectedNodeId(command.nodeId);
          return { ok: true };
        }
        case "set-viewport": {
          if (!flowInstance) return { ok: false, reason: "画布实例未就绪" };
          flowInstance.setViewport({
              x: command.viewport.x,
              y: command.viewport.y,
              zoom: command.viewport.zoom,
          });
          return { ok: true };
        }
        case "trigger-node-action": {
          const node = graph.nodes.find((item) => item.id === command.nodeId);
          if (!node) return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          if (command.action !== "generate") {
            return { ok: false, reason: `暂不支持的节点动作 ${command.action}` };
          }
          void generateNode(command.nodeId);
          return { ok: true };
        }
        default:
          return { ok: false, reason: `未知指令 ${(command as { kind: string }).kind}` };
      }
    },
    [activeGraph, deleteNode, flowInstance, generateNode, saveGraph, setSelectedNodeId],
  );

  dispatcherRef.current = dispatch;

  const stableDispatcher = useCallback<CanvasCommandDispatcher>(
    (command) => dispatcherRef.current?.(command) ?? { ok: false, reason: "执行器未就绪" },
    [],
  );

  useEffect(() => registerCanvasDispatcher("image-workflow", stableDispatcher), [stableDispatcher]);
}
