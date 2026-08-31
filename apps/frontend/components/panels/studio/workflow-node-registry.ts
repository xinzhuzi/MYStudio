import type { CanvasNodeEntry } from "@/lib/studio/canvas-node-registry";
import { registerProductionFlowNodeDefinitions } from "@/lib/studio/canvas-node-registry";
import {
  PRODUCTION_FLOW_NODE_IDS,
  PRODUCTION_NODE_WIDTH_PX,
  type ProductionFlowNodeId,
} from "./workflow-node-model-schema";

/**
 * 生产流面节点注册(08-31-canvas-node-registry):
 * 生产流是注册表驱动的确定性流水(PRODUCTION_FLOW_EDGES 常量边表保持
 * 确定性,不做自由连线),注册条目只声明 几何/动作/输出资源。
 * 模块加载即注入 lib 注册表(单次幂等)。
 */

const PRODUCTION_ACTIONS = ["open", "refresh"] as const;

const PRODUCTION_FLOW_DEFINITIONS: readonly CanvasNodeEntry[] =
  PRODUCTION_FLOW_NODE_IDS.map((nodeId) => ({
    typeId: nodeId,
    surface: "production-flow" as const,
    label: nodeId,
    description: "生产流水线节点",
    defaultSize: {
      width: PRODUCTION_NODE_WIDTH_PX[nodeId as ProductionFlowNodeId],
      height: 120,
    },
    actions: PRODUCTION_ACTIONS,
    outputs: [
      { kind: "production-status", description: "生产阶段状态供下游节点展示" },
    ],
    miniMapToken: "warning",
  }));

export function registerProductionFlowNodes(): void {
  registerProductionFlowNodeDefinitions(PRODUCTION_FLOW_DEFINITIONS);
}

export const PRODUCTION_FLOW_NODE_TYPE_IDS: readonly string[] = PRODUCTION_FLOW_NODE_IDS;

registerProductionFlowNodes();
