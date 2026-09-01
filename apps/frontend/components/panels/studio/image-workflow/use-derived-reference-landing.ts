import { useCallback } from "react";
import { toast } from "sonner";
import {
  addReferenceImageNode,
  connectImageWorkflowNodes,
  createId,
} from "@/lib/studio/image-workflow/graph-build";
import type { ImageWorkflowDerivationSource, ImageWorkflowGraph } from "@/types/studio";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { useProjectStore } from "@/stores/project/project-store";
import {
  chapterScopeForWorkflowTarget,
  createWorkflowFilename,
  workflowImageRelativePath,
} from "./image-workflow-file-utils";
import type { StoryboardItem } from "@/types/studio";

/**
 * 取材落图通道(09-01-extraction-infra):像素产物 → 挂血缘的参考图节点。
 * 与 handleUploadReference 同款 media 落盘姿势(project-files bridge+addMaterial,
 * 单一落盘不双写);落位=源节点右邻列扇形;**多产物一次 saveGraph**(单条撤销历史)。
 */

export interface LandDerivedInput {
  sourceNodeId: string;
  /** 像素产物(PNG dataUrl 与像素尺寸) */
  pixels: { dataUrl: string; width: number; height: number };
  title: string;
  derivation: Omit<ImageWorkflowDerivationSource, "createdAt">;
  /** 有则把新节点连入该成图(域规则:target 必须 generated) */
  connectToGeneratedId?: string;
}

export interface LandDerivedOk {
  nodeId: string;
}
export interface LandDerivedFailure {
  error: string;
}

/** 源节点右邻列扇形:邻列 x,纵向按产物序堆叠(卡高按 ~300 步进估计) */
function neighborPositions(
  source: { x: number; y: number },
  count: number,
): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, index) => ({
    x: source.x + 360,
    y: source.y + index * 320,
  }));
}

async function dataUrlBytes(dataUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

export function useDerivedReferenceLanding({
  activeGraph,
  saveGraph,
  storyboards,
  addMaterial,
  setSelectedNodeId,
}: {
  activeGraph: ImageWorkflowGraph | null | undefined;
  saveGraph: (graph: ImageWorkflowGraph) => void;
  storyboards: StoryboardItem[];
  addMaterial: (material: { name: string; localPath: string; size: number }) => string;
  setSelectedNodeId: (nodeId: string | null) => void;
}) {
  return useCallback(
    async (inputs: LandDerivedInput[]): Promise<Array<LandDerivedOk | LandDerivedFailure>> => {
      if (!activeGraph || inputs.length === 0) {
        return inputs.map(() => ({ error: "无活动图像工作流" }));
      }
      const activeProjectId = useProjectStore.getState().activeProjectId;
      const sourceNode = activeGraph.nodes.find((node) => node.id === inputs[0].sourceNodeId);
      if (!activeProjectId) {
        return inputs.map(() => ({ error: "请先选择项目" }));
      }
      if (!sourceNode) {
        return inputs.map(() => ({ error: "源节点不存在" }));
      }

      const chapterId = chapterScopeForWorkflowTarget(activeGraph.target, storyboards);
      const bridge = getProjectFilesBridge();
      const positions = neighborPositions(sourceNode.position, inputs.length);
      const landed: Array<LandDerivedOk> = [];
      // 先全部落盘,再一次性改图(任一落盘失败整批失败,不留半拉子节点)
      let nextGraph = activeGraph;
      const createdIds: string[] = [];

      try {
        for (let index = 0; index < inputs.length; index += 1) {
          const input = inputs[index];
          const id = createId("ref");
          const bytes = await dataUrlBytes(input.pixels.dataUrl);
          const saved = await bridge?.writeBinary({
            projectId: activeProjectId,
            relativePath: workflowImageRelativePath(
              activeGraph.id,
              createWorkflowFilename("ref", id, `${input.title}.png`),
              chapterId,
            ),
            bytes,
          });
          if (!saved?.success || !saved.url) {
            throw new Error(saved?.error || "取材产物保存失败");
          }
          const materialId = addMaterial({
            name: `${input.title}.png`,
            localPath: saved.url,
            size: saved.size ?? bytes.byteLength,
          });
          nextGraph = addReferenceImageNode(nextGraph, {
            id,
            title: input.title,
            imageUrl: saved.url,
            source: { kind: "material", id: materialId },
            position: positions[index],
          });
          // 血缘写入:addReferenceImageNode 的 input 不含 derivedFrom,构造后补
          nextGraph = {
            ...nextGraph,
            nodes: nextGraph.nodes.map((node) =>
              node.id === id && node.type === "reference"
                ? {
                    ...node,
                    derivedFrom: { ...input.derivation, createdAt: Date.now() },
                  }
                : node,
            ),
          };
          if (input.connectToGeneratedId) {
            nextGraph = connectImageWorkflowNodes(nextGraph, {
              source: id,
              target: input.connectToGeneratedId,
            });
          }
          createdIds.push(id);
          landed.push({ nodeId: id });
        }
        saveGraph(nextGraph);
        if (createdIds.length > 1) {
          toast.success(`已落 ${createdIds.length} 张取材参考图`);
        } else {
          setSelectedNodeId(createdIds[0] ?? null);
        }
        return landed;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "取材产物落图失败");
        return inputs.map(() => ({ error: error instanceof Error ? error.message : "落图失败" }));
      }
    },
    [activeGraph, addMaterial, saveGraph, setSelectedNodeId, storyboards],
  );
}
