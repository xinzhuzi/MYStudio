/**
 * 画布节点注册表契约(08-31-canvas-node-registry,Phase 2 内核地基):
 * 每种节点类型声明 几何/动作/输出资源,画布层只认注册表。
 * lib 层持契约与 image-workflow 面注册(类型来自 @/types/studio,零 React);
 * 生产流面定义在 components/panels/studio/workflow-node-registry.ts 合并
 * (生产流常量在 panels 侧,lib 不反向依赖 components——分层铁律)。
 * 注册表只统一实现层契约;分镜/资产/自由生图的展示分组不在此合并。
 */

export type CanvasSurface = "image-workflow" | "production-flow";

/** 节点作为上游输入时产出的资源 */
export interface CanvasNodeResource {
  kind: "prompt-text" | "reference-image" | "generated-image" | "production-status";
  description: string;
}

export interface CanvasNodeEntry {
  typeId: string;
  surface: CanvasSurface;
  /** 显示名(创建菜单/无障碍标签) */
  label: string;
  /** 创建菜单副文案 */
  description: string;
  /** 默认几何(注册表落地前各面已有落位单源,此处为契约声明) */
  defaultSize?: { width: number; height: number };
  /** 该类型可触发的动作清单(枚举供 ops 层/自动化消费) */
  actions: readonly string[];
  /** 作为上游连接时输出的资源 */
  outputs: readonly CanvasNodeResource[];
  /** 小地图节点色(hsl token) */
  miniMapColor: string;
}

const IMAGE_WORKFLOW_DEFINITIONS: readonly CanvasNodeEntry[] = [
  {
    typeId: "reference",
    surface: "image-workflow",
    label: "参考图节点",
    description: "挂参考图供成图参照",
    actions: ["pick-image", "update", "delete"] as const,
    outputs: [{ kind: "reference-image", description: "作为下游成图的参考输入" }],
    miniMapColor: "hsl(142 60% 45%)",
  },
  {
    typeId: "prompt",
    surface: "image-workflow",
    label: "提示词节点",
    description: "正/反向提示词与参数",
    actions: ["update", "generate", "delete"] as const,
    outputs: [{ kind: "prompt-text", description: "作为下游成图的提示词输入" }],
    miniMapColor: "hsl(38 90% 50%)",
  },
  {
    typeId: "generated",
    surface: "image-workflow",
    label: "成图节点",
    description: "生成结果与产线操作",
    actions: ["generate", "stop", "upscale", "apply-to-storyboard", "store-in-asset-library", "update", "delete"] as const,
    outputs: [{ kind: "generated-image", description: "生成图,可被超分/回写/入库消费" }],
    miniMapColor: "hsl(var(--primary))",
  },
];

/** panels 侧生产流定义经此注入(模块加载一次) */
let productionFlowDefinitions: readonly CanvasNodeEntry[] = [];

export function registerProductionFlowNodeDefinitions(
  definitions: readonly CanvasNodeEntry[],
): void {
  productionFlowDefinitions = definitions;
}

export function getCanvasNodeEntry(
  surface: CanvasSurface,
  typeId: string,
): CanvasNodeEntry | undefined {
  const pool =
    surface === "production-flow"
      ? productionFlowDefinitions
      : IMAGE_WORKFLOW_DEFINITIONS;
  return pool.find((definition) => definition.typeId === typeId);
}

export function listCanvasNodeEntrys(
  surface: CanvasSurface,
): readonly CanvasNodeEntry[] {
  return surface === "production-flow"
    ? productionFlowDefinitions
    : IMAGE_WORKFLOW_DEFINITIONS;
}

/** 小地图类型色;未注册类型回退 accent */
export function canvasMiniMapNodeColor(typeId: string): string {
  for (const definition of [...IMAGE_WORKFLOW_DEFINITIONS, ...productionFlowDefinitions]) {
    if (definition.typeId === typeId) return definition.miniMapColor;
  }
  return "hsl(var(--accent))";
}
