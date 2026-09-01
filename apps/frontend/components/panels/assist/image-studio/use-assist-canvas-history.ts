import { useCallback } from "react";
import {
  useCanvasHistory,
  useCanvasHistoryShortcuts,
} from "@/components/panels/studio/use-canvas-history";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import type { ImageWorkflowGraph } from "@/types/studio";

/**
 * assist 画布撤销重做(09-02-assist-undo-redo):
 * 订阅式快照——workflow 引用变化即 commit({nodes,edges},防抖合并),
 * 与 image-workflow 面完全同构(结构+文本入史;status 流转误入一条可接受,
 * 简化裁定见任务 design)。restore 直写 store workflows(保 viewport);
 * resetKey=workflowId(切画布清史)。不包 store(共享域零碰撞)。
 */
export function useAssistCanvasHistory({
  workflow,
}: {
  workflow: ImageWorkflowGraph | undefined;
}) {
  const history = useCanvasHistory<{
    nodes: ImageWorkflowGraph["nodes"];
    edges: ImageWorkflowGraph["edges"];
  }>({
    read: () => ({ nodes: workflow?.nodes ?? [], edges: workflow?.edges ?? [] }),
    resetKey: workflow?.id ?? "",
    debounceMs: 300,
    restore: (snapshot) => {
      useImageStudioStore.setState((state) => ({
        workflows: state.workflows.map((item) =>
          item.id === workflow?.id ? { ...item, nodes: snapshot.nodes, edges: snapshot.edges } : item,
        ),
      }));
    },
  });

  useCanvasHistoryShortcuts({ undo: history.undo, redo: history.redo });

  // 订阅式 commit:引用变化(任何过 updateActiveWorkflow/直写的变更)即提交
  const commitSnapshot = useCallback(() => {
    if (!workflow) return;
    history.commit({ nodes: workflow.nodes, edges: workflow.edges });
  }, [history, workflow]);

  return { history, commitSnapshot };
}
