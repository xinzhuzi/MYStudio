import { useCallback, useEffect, useRef } from "react";
import type {
  CanvasCommand,
  CanvasCommandDispatcher,
  CanvasCommandResult,
} from "@/lib/studio/canvas-commands";
import { registerCanvasDispatcher } from "@/lib/studio/canvas-commands";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";

/**
 * image-studio 画布面指令执行器(09-02-canvas-assistant 前置):
 * 把 ops 指令路由到 image-studio-store 既有动作;面板/助手/未来 agent 共用。
 * 与 use-image-workflow-commands 同构,不改任何现有行为。
 */
export function useImageStudioCommands({
  workflow,
}: {
  workflow: ImageWorkflowGraph | undefined;
}) {
  const dispatcherRef = useRef<CanvasCommandDispatcher | null>(null);

  const dispatch = useCallback(
    (command: CanvasCommand): CanvasCommandResult => {
      const store = useImageStudioStore.getState();
      const graph = workflow ?? selectActiveImageStudioWorkflow(store);
      switch (command.kind) {
        case "add-node": {
          if (command.surface !== "image-studio") {
            return { ok: false, reason: "surface 不一致" };
          }
          if (command.connectFrom) {
            // 组装:文生图组(锚点=成图位,提示词落左列)
            const group = store.addGenerationGroup({
              position: command.connectFrom.handleType === "target"
                ? { x: 360, y: 0 }
                : undefined,
            });
            return { ok: true, detail: { nodeId: group.generatedNodeId } };
          }
          if (command.nodeType === "prompt") {
            const id = store.addPromptNode();
            return { ok: true, detail: { nodeId: id } };
          }
          if (command.nodeType === "reference") {
            const id = store.addReferenceNode({ imageUrl: "" });
            return { ok: true, detail: { nodeId: id } };
          }
          const group = store.addGenerationGroup();
          return { ok: true, detail: { nodeId: group.generatedNodeId } };
        }
        case "update-node": {
          const node = graph?.nodes.find((item) => item.id === command.nodeId);
          if (!node) return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          store.updateNode(command.nodeId, command.patch as never);
          return { ok: true };
        }
        case "remove-node": {
          if (!graph?.nodes.some((item) => item.id === command.nodeId)) {
            return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          }
          store.removeNode(command.nodeId);
          return { ok: true };
        }
        case "connect": {
          const source = graph?.nodes.find((item) => item.id === command.source);
          const target = graph?.nodes.find((item) => item.id === command.target);
          if (!source || !target) return { ok: false, reason: "连线端点不存在" };
          if (target.type !== "generated") return { ok: false, reason: "边只指向成图节点" };
          store.connect(command.source, command.target);
          return { ok: true };
        }
        case "disconnect": {
          if (!graph?.edges.some((item) => item.id === command.edgeId)) {
            return { ok: false, reason: `连线不存在 ${command.edgeId}` };
          }
          store.removeEdge(command.edgeId);
          return { ok: true };
        }
        case "select": {
          return { ok: true };
        }
        default:
          return { ok: false, reason: `image-studio 面暂不支持 ${command.kind}` };
      }
    },
    [workflow],
  );

  dispatcherRef.current = dispatch;

  const stableDispatcher = useCallback<CanvasCommandDispatcher>(
    (command) =>
      dispatcherRef.current?.(command) ?? { ok: false, reason: "执行器未就绪" },
    [],
  );

  useEffect(
    () => registerCanvasDispatcher("image-studio", stableDispatcher),
    [stableDispatcher],
  );
}
