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
  generateNode,
}: {
  workflow: ImageWorkflowGraph | undefined;
  /** 生成编排注入(trigger-node-action "generate");未注入时触发返回可操作失败 */
  generateNode?: (nodeId: string) => void | Promise<void>;
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
            const { nodeId: fromNodeId, handleType } = command.connectFrom;
            // 组装:文生图组(锚点=成图位,提示词落左列);源节点存在时按契约
            // 「创建后自动连线」接边(源→成图,边域规则由 store.connect 把关)——
            // 选中+上游引用的生图语义依赖这条边(buildRequest 只认指向成图的边)
            const group = store.addGenerationGroup({
              position: handleType === "target" ? { x: 360, y: 0 } : undefined,
            });
            if (graph?.nodes.some((item) => item.id === fromNodeId)) {
              store.connect(fromNodeId, group.generatedNodeId);
            }
            return {
              ok: true,
              detail: { nodeId: group.generatedNodeId, promptNodeId: group.promptNodeId },
            };
          }
          if (command.nodeType === "prompt") {
            const id = store.addPromptNode();
            return { ok: true, detail: { nodeId: id } };
          }
          if (command.nodeType === "reference") {
            const id = store.addReferenceNode({ imageUrl: "" });
            return { ok: true, detail: { nodeId: id } };
          }
          if (command.nodeType === "uncloth") {
            // 显式分支(09-04 通用化补漏):fall-through 会误建文生图组
            const id = store.addUnclothNode();
            return { ok: true, detail: { nodeId: id } };
          }
          const group = store.addGenerationGroup();
          return {
            ok: true,
            detail: { nodeId: group.generatedNodeId, promptNodeId: group.promptNodeId },
          };
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
        case "trigger-node-action": {
          const node = graph?.nodes.find((item) => item.id === command.nodeId);
          if (!node) return { ok: false, reason: `节点不存在 ${command.nodeId}` };
          if (command.action !== "generate") {
            return { ok: false, reason: `暂不支持的节点动作 ${command.action}` };
          }
          if (!generateNode) return { ok: false, reason: "生成编排未就绪" };
          void generateNode(command.nodeId);
          return { ok: true };
        }
        case "restore-generation": {
          // 复原=独立新画布(用户裁定 09-03):记录是「当时那张画布」的快照,
          // 落进当前画布会污染现场;先建「复原·<记录时间>」画布再整组重建
          if (!graph) return { ok: false, reason: "画布未就绪" };
          const stampDate = new Date(command.generatedAt ?? Date.now());
          const pad = (value: number) => String(value).padStart(2, "0");
          const workflowName = `复原·${pad(stampDate.getMonth() + 1)}${pad(stampDate.getDate())} ${pad(stampDate.getHours())}:${pad(stampDate.getMinutes())}`;
          const workflowId = store.createWorkflow(workflowName);
          const group = store.restoreGenerationGroup({
            prompt: command.prompt,
            negativePrompt: command.negativePrompt,
            model: command.model,
            aspectRatio: command.aspectRatio,
            references: command.references,
            result: command.result,
            batchImageUrls: command.batchImageUrls,
            generatedAt: command.generatedAt,
          });
          return {
            ok: true,
            detail: {
              nodeId: group.generatedNodeId,
              promptNodeId: group.promptNodeId,
              workflowId,
              workflowName,
            },
          };
        }
        default:
          return { ok: false, reason: `image-studio 面暂不支持 ${command.kind}` };
      }
    },
    [workflow, generateNode],
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
