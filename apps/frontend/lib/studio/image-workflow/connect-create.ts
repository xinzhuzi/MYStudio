import type { ImageWorkflowGraph } from "@/types/studio";
import { getCanvasNodeEntry } from "@/lib/studio/canvas-node-registry";
import {
  addGeneratedImageNode,
  addPromptImageNode,
  addReferenceImageNode,
  addUnclothImageNode,
  connectImageWorkflowNodes,
  createId,
  hasPromptSource,
} from "./graph-build";
import { nextStackedPosition } from "./layout";

/**
 * 连接落空创建(08-31-canvas-connect-create-menu):
 * 拖连线落到画布空白处时,按拖出手柄方向创建「下游成图/无衣物」或「上游提示
 * 词/参考图/无衣物」并自动连线。域规则:连线只允许指向 generated/uncloth
 * (connectImageWorkflowNodes 校验),downstream 合法类型=成图+无衣物(图源
 * 节点喂 uncloth 输入口);upstream(从成图输入手柄拖出)创建 prompt/
 * reference/uncloth。落位走布局单源 nextStackedPosition(两列+泳道),
 * 不采用裸落点坐标,防止新节点穿泳道回到「初始重叠」老病。
 */

export type ConnectCreateHandleType = "source" | "target";

export type ConnectCreatableNodeType = "generated" | "prompt" | "reference" | "uncloth" | "uncloth-fast" | "uncloth-instruct";

export interface ConnectCreatableTypeOption {
  type: ConnectCreatableNodeType;
  label: string;
  description: string;
}

/** 可创建类型清单:标签/描述取自节点注册表(canvas-node-registry)。 */
export function getCreatableImageNodeTypes(
  direction: "downstream" | "upstream",
): ConnectCreatableTypeOption[] {
  // 09-05 masked SDEdit 双档封存(见 uncloth-defaults.ts UNCLOTH_ARCHIVED):
  // 创建入口撤下,存量画布节点仍可用
  const types: ConnectCreatableNodeType[] =
    direction === "downstream"
      ? ["generated", "uncloth-instruct"]
      : ["prompt", "reference", "uncloth-instruct"];
  const directionalDescription =
    direction === "downstream"
      ? "创建并从当前节点连入"
      : "创建并连入当前成图";
  return types.map((type) => ({
    type,
    label:
      type === "uncloth-fast"
        ? "无衣物·快"
        : type === "uncloth-instruct"
          ? "无衣物·指令"
          : getCanvasNodeEntry("image-workflow", type)?.label ?? type,
    description: directionalDescription,
  }));
}

export function connectCreateDirection(
  fromHandleType: ConnectCreateHandleType,
): "downstream" | "upstream" {
  return fromHandleType === "source" ? "downstream" : "upstream";
}

export interface ConnectCreateInput {
  fromNodeId: string;
  fromHandleType: ConnectCreateHandleType;
  type: ConnectCreatableNodeType;
}

export interface ConnectCreateResult {
  graph: ImageWorkflowGraph;
  nodeId: string;
}

/**
 * 创建节点并按拖出手柄方向连线;返回新图与新节点 id(供选中)。
 * upstream 只在 fromNode 为 generated 时成立(连线域规则),否则原样返回 null。
 */
export function createConnectedImageNode(
  graph: ImageWorkflowGraph,
  input: ConnectCreateInput,
): ConnectCreateResult | null {
  const fromNode = graph.nodes.find((node) => node.id === input.fromNodeId);
  if (!fromNode) return null;

  const direction = connectCreateDirection(input.fromHandleType);
  if (direction === "downstream" && input.type !== "generated" && input.type !== "uncloth") {
    return null;
  }
  if (
    direction === "upstream" &&
    input.type !== "prompt" &&
    input.type !== "reference" &&
    input.type !== "uncloth"
  ) {
    return null;
  }
  // upstream 的连线终点是 fromNode,必须是成图节点
  if (direction === "upstream" && fromNode.type !== "generated") return null;
  // 该成图已挂提示词源时不再新建提示词(单源会拒边→留下悬空节点)
  if (direction === "upstream" && input.type === "prompt" && hasPromptSource(graph, input.fromNodeId)) {
    return null;
  }
  // 该成图已吃一根无衣物链时不再新建(单链规则会拒边→留下悬空节点)
  if (direction === "upstream" && input.type === "uncloth" && hasUnclothUpstreamEdge(graph, input.fromNodeId)) {
    return null;
  }

  // 布局单源假设节点带 position;历史无位节点(如未摆放的种子)不参与堆叠计算
  const positionedNodes = graph.nodes.filter((node) => node.position);
  // uncloth-fast 与 uncloth 共用布局槽位(布局表按 ImageWorkflowNodeType 键控)
  const position = nextStackedPosition(
    positionedNodes,
    input.type === "generated" || input.type === "prompt" || input.type === "reference"
      ? input.type
      : "uncloth",
  );

  let nextGraph = graph;
  let nodeId = "";
  if (input.type === "generated") {
    nodeId = createId("gen");
    nextGraph = addGeneratedImageNode(nextGraph, { id: nodeId, position });
  } else if (input.type === "prompt") {
    nodeId = createId("prompt");
    nextGraph = addPromptImageNode(nextGraph, {
      id: nodeId,
      position,
      // upstream 时新提示词直连该成图,保持「提示词→成图」配对语义
      targetNodeId: direction === "upstream" ? input.fromNodeId : undefined,
    });
  } else if (input.type === "uncloth" || input.type === "uncloth-fast" || input.type === "uncloth-instruct") {
    nodeId = createId("uncloth");
    nextGraph = addUnclothImageNode(nextGraph, {
      id: nodeId,
      position,
      variant:
        input.type === "uncloth-fast" ? "fast"
          : input.type === "uncloth-instruct" ? "instruct" : undefined,
    });
  } else {
    nodeId = createId("ref");
    nextGraph = addReferenceImageNode(nextGraph, {
      id: nodeId,
      position,
      imageUrl: "",
    });
  }

  const edge =
    direction === "downstream"
      ? { source: input.fromNodeId, target: nodeId }
      : { source: nodeId, target: input.fromNodeId };
  nextGraph = connectImageWorkflowNodes(nextGraph, edge);

  return { graph: nextGraph, nodeId };
}

/** 该成图是否已有无衣物上游边(单链规则守卫,与 isValidImageEdge 同语义) */
function hasUnclothUpstreamEdge(graph: ImageWorkflowGraph, generatedNodeId: string): boolean {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges.some((edge) => {
    if (edge.target !== generatedNodeId) return false;
    return nodesById.get(edge.source)?.type === "uncloth";
  });
}

export function isConnectCreatableType(
  value: string,
): value is ConnectCreatableNodeType {
  return (
    value === "generated"
    || value === "prompt"
    || value === "reference"
    || value === "uncloth"
  );
}
