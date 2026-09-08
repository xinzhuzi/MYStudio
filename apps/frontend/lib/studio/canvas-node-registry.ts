/**
 * 画布节点注册表契约(08-31-canvas-node-registry,Phase 2 内核地基):
 * 每种节点类型声明 几何/动作/输出资源,画布层只认注册表。
 * lib 层持契约与 image-workflow 面注册(类型来自 @/types/studio,零 React);
 * 生产流面定义在 components/panels/studio/workflow-node-registry.ts 合并
 * (生产流常量在 panels 侧,lib 不反向依赖 components——分层铁律)。
 * 注册表只统一实现层契约;分镜/资产/自由生图的展示分组不在此合并。
 *
 * 09-08 三期A(端口类型系统):节点定义补 inputs(输入通道:类型/容量/
 * 互斥组)与 outputSeats(源出口席位)声明——连线合法性查表的数据源,
 * 与 outputs 一起构成端口声明的完整两半(见 image-workflow/port-types.ts)。
 */

import type { ImageWorkflowNodeType } from "@/types/studio";
import type { ImageWorkflowPortDeclarations, InputChannelSpec, SourceOutputSeatsSpec } from "./image-workflow/port-types";

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
  /**
   * 输入通道声明(09-08 三期A 连线规则查表源):每通道 {id,label,type,
   * 容量,互斥组,席位}。缺省=该类型不可作为连线目标(reference/prompt
   * 只作源)。行为与旧 isValidImageEdge/isValidImageConnection 手写分支
   * 逐例等价(对拍测试 port-types-parity.test.ts)。
   */
  inputs?: readonly InputChannelSpec[];
  /** 源出口席位声明(09-07 双出口:prompt 正/负同口分席各≤1);缺省=单输出口无分席规则 */
  outputSeats?: SourceOutputSeatsSpec;
  /** 小地图节点色:主题语义 token 名,渲染时按当前主题预设解析成具体色 */
  miniMapToken: CanvasMiniMapToken;
}

/** 小地图可用的主题语义 token(随 colorPreset/明暗模式自动跟随) */
export type CanvasMiniMapToken = "primary" | "info" | "success" | "warning" | "accent";

const IMAGE_WORKFLOW_DEFINITIONS: readonly CanvasNodeEntry[] = [
  {
    typeId: "reference",
    surface: "image-workflow",
    label: "参考图节点",
    description: "挂参考图供成图参照",
    actions: ["pick-image", "update", "delete"] as const,
    outputs: [{ kind: "reference-image", description: "作为下游成图的参考输入" }],
    miniMapToken: "success",
  },
  {
    typeId: "prompt",
    surface: "image-workflow",
    label: "提示词节点",
    description: "正/反向提示词与参数",
    actions: ["update", "generate", "delete"] as const,
    outputs: [{ kind: "prompt-text", description: "作为下游成图的提示词输入" }],
    outputSeats: {
      // 09-07 双出口裁定:正/负两个出口同口分席各≤1,两口可共存=目标侧
      // 正负拼装;存量无 sourceHandle 边=整节点语义占正席(行为兼容);
      // 无 targetHandle 的席位键回落①口(仅提示词源边归席,其余不占席)
      sourceType: "prompt",
      defaultSeatKey: "prompt-1",
      legacySeatSourceTypes: ["prompt"],
      legacyPolarity: "positive",
      seats: [
        { handleId: "positive", label: "正向", polarity: "positive" },
        // NSFW破限目标拒负向口(专业流只吃正向)
        { handleId: "negative", label: "负向", polarity: "negative", bannedTargetTypes: ["nsfw"] },
      ],
    },
    miniMapToken: "info",
  },
  {
    typeId: "generated",
    surface: "image-workflow",
    label: "成图节点",
    description: "生成结果与产线操作",
    actions: ["generate", "stop", "upscale", "apply-to-storyboard", "store-in-asset-library", "update", "delete"] as const,
    outputs: [{ kind: "generated-image", description: "生成图,可被超分/回写/入库消费" }],
    inputs: [
      {
        // 09-03 一图一提示词:已挂「别的」提示词(边或 targetNodeId 直挂)才拒,
        // 自身首根放行(建组流程 prompt 先经 targetNodeId 挂靠)
        id: "prompt",
        label: "提示词",
        type: "prompt-text",
        accepts: ["prompt"],
        capacity: 1,
        occupancy: "prompt-attach",
        selfReallow: true,
        // 09-07 通道二选一:成图已挂 nsfw 链时直连提示词边拒(反向见 nsfw-chain)
        mutexWith: ["nsfw-chain"],
      },
      // 静态参考边:不限量
      { id: "reference", label: "参考图", type: "reference-image", accepts: ["reference"], capacity: Number.POSITIVE_INFINITY },
      // 09-04 无衣物链:一图一根(结果直通,双链语义未定义,歧义消灭在源头);
      // 与提示词/参考可共存(提示词仍驱动,静态参考边在链模式下被管线输入取代)
      { id: "uncloth-chain", label: "无衣物链", type: "generated-image", accepts: ["uncloth"], capacity: 1 },
      // 09-07 nsfw 链:一图一根;提示词通道=直连 prompt 或 nsfw 链二选一
      // (含 findPromptNodeForGenerated 的 targetNodeId 直挂语义)
      { id: "nsfw-chain", label: "NSFW破限链", type: "prompt-text", accepts: ["nsfw"], capacity: 1, mutexWith: ["prompt"] },
      // 上游成图链式输入:不限量
      { id: "image-chain", label: "上游成图", type: "generated-image", accepts: ["generated"], capacity: Number.POSITIVE_INFINITY },
      {
        // 兜底通道(旧手写规则尾态逐字保留:成图目标对未列名源类型放行;
        // 三期B 新源类型接入时在前面的通道显式声明即可收窄本兜底)
        id: "passthrough",
        label: "兜底",
        type: "generated-image",
        accepts: "*",
        capacity: Number.POSITIVE_INFINITY,
      },
    ],
    miniMapToken: "primary",
  },
  {
    // 通用节点(09-04 用户裁定):无衣物不再只属图片工作室私有注册表,
    // 分镜图画布创建/渲染/生成链与 image-studio 同源接入
    typeId: "uncloth",
    surface: "image-workflow",
    label: "无衣物节点",
    description: "衣物区域局部重绘,快(fashn 单分割+单遍)/精(双分割+两遍+色彩对齐+硬合成)两档,结果直通成图",
    actions: ["update", "delete"] as const,
    outputs: [{ kind: "generated-image", description: "处理结果直通下游成图节点" }],
    inputs: [
      {
        // 图口:reference/generated/uncloth 链式源(accepts 缺省=按类型兼容
        // 表推导,恰好等于参考图+成图族)。节点级不限量(旧规则图源永真);
        // 席位级一根封口(连线级 targetHandle=image 口别规则)
        id: "image",
        label: "图",
        type: "generated-image",
        capacity: Number.POSITIVE_INFINITY,
        seats: [{ handleId: "image", label: "图", capacity: 1, legacySeat: "non-prompt" }],
      },
      {
        // 09-08 双参考(two-input,原版协议:场景在前主体在后):图B=主体图
        // (干净单人参考图,换脸/换装/换场景);类型同图口,席位级一根
        id: "image-b",
        label: "图B(主体)",
        type: "generated-image",
        capacity: 1,
        seats: [{ handleId: "image-b", label: "主体图", capacity: 1, legacySeat: "none" }],
      },
      {
        // 09-07 编号口:①=正向席(编辑指令)/②=负向席(一致性描述),
        // 极性错口拒;节点级合计两根(存量无 handle 提示词边上限 2 兼容),
        // 席位级各口一根;存量无 handle 提示词边回落占①席(渲染层同口径)
        id: "prompt",
        label: "提示词",
        type: "prompt-text",
        accepts: ["prompt"],
        capacity: 2,
        seats: [
          { handleId: "prompt-1", label: "①编辑指令", capacity: 1, polarity: "positive", legacySeat: "prompt-first" },
          { handleId: "prompt-2", label: "②一致性描述", capacity: 1, polarity: "negative", legacySeat: "none" },
        ],
      },
    ],
    miniMapToken: "warning",
  },
  {
    // 通用节点(09-07-nsfw-pro-node):提示词→NSFW破限→成图,成图生成
    // 即走「Krea2-NSFW专业流」(use_lora 注入,sidecar 挂固定 LoRA 栈+重平衡)
    typeId: "nsfw",
    surface: "image-workflow",
    label: "NSFW破限节点",
    description: "Krea2-NSFW专业流增强:提示词经此节点连成图,生成自动挂专业流 LoRA 栈与重平衡(仅 Krea2/ComfyUI桥)",
    actions: ["update", "delete"] as const,
    outputs: [{ kind: "prompt-text", description: "专业流提示词通道,连成图节点启用增强" }],
    inputs: [
      {
        // 09-07 只吃单根提示词边(专业流提示词通道,不收图/不收链);
        // 负向出口拒见 prompt 节点 outputSeats 的 bannedTargetTypes
        id: "prompt",
        label: "提示词",
        type: "prompt-text",
        accepts: ["prompt"],
        capacity: 1,
      },
    ],
    miniMapToken: "warning",
  },
  {
    // ComfyUI 工作流节点(09-08 二期收官,流X):工作流库导入的整体卡。
    // 左 prompt 口+图口(各容量 1;卡上静态三口与渲染层 handle id 同口径),
    // 右出图口;graph-build-mutations 引擎按本声明自动放行(零改动接入)。
    typeId: "comfy-workflow",
    surface: "image-workflow",
    label: "工作流节点",
    description: "ComfyUI 工作流库导入的整体卡:左连提示词/参考图,卡上运行出图",
    actions: ["update", "run", "delete"] as const,
    outputs: [{ kind: "generated-image", description: "工作流输出图,可连成图/效果节点" }],
    inputs: [
      {
        // 提示词口:整根 prompt 边携带正负文本(卡内按 descriptor 极性分流注入)
        id: "prompt",
        label: "提示词",
        type: "prompt-text",
        accepts: ["prompt"],
        capacity: 1,
      },
      {
        // 图口:参考图/上游成图/无衣物/通用节点结果,一根(注入首个图口)
        id: "image",
        label: "图",
        type: "reference-image",
        accepts: ["reference", "generated", "uncloth", "comfy-workflow", "comfy-generic"],
        capacity: 1,
      },
    ],
    miniMapToken: "accent",
  },
  {
    // ComfyUI 通用节点(09-08 三期收官,流X):object_info/策展直放的生态节点。
    // 声明层宽松(image+prompt-text 双向容量,动态口不进声明);类型严格校验
    // 留给子图编译器执行时(编译期大白话报错)。
    typeId: "comfy-generic",
    surface: "image-workflow",
    label: "效果节点",
    description: "直放的 ComfyUI 生态节点:与效果节点连成子图,工具菜单「运行子图」出图",
    actions: ["update", "delete"] as const,
    outputs: [{ kind: "generated-image", description: "节点输出(按 classType 的输出口)" }],
    inputs: [
      {
        // 图口:参考图/上游成图族/生态节点输出(动态口按边注入,容量宽松)
        id: "image",
        label: "图",
        type: "reference-image",
        accepts: ["reference", "generated", "uncloth", "comfy-workflow", "comfy-generic"],
        capacity: Number.POSITIVE_INFINITY,
      },
      {
        // 提示词口:STRING 型动态口直接注入文本
        id: "prompt",
        label: "提示词",
        type: "prompt-text",
        accepts: ["prompt"],
        capacity: 1,
      },
    ],
    miniMapToken: "accent",
  },
  {
    // Reroute 中转(09-09 照 ComfyUI):纯连线整理件。规则层单进单出任意源
    // (真源经 collapseTransparentNodes 穿透后按原类型参与下游校验/解析),
    // 编译期被编译器塌缩成直连线。
    typeId: "reroute",
    surface: "image-workflow",
    label: "中转点",
    description: "连线中转/拐弯整理:任意一根进,原样一根出,不改变链语义",
    actions: ["delete"] as const,
    outputs: [{ kind: "generated-image", description: "原样转发上游(类型随上游)" }],
    inputs: [
      { id: "in", label: "入", type: "generated-image", accepts: "*", capacity: 1 },
    ],
    miniMapToken: "accent",
  },
];

/** 画布注释容器类型:不可作为连线源(旧规则 sticky/group 源拒) */
const NON_WIRABLE_SOURCE_TYPES: readonly ImageWorkflowNodeType[] = ["sticky", "group"];

let cachedPortDeclarations: ImageWorkflowPortDeclarations | undefined;

/**
 * image-workflow 面连线规则声明(三期A 查表数据源):注册表 inputs/
 * outputSeats 的键控投影 + 禁作源类型。IMAGE_WORKFLOW_DEFINITIONS 为
 * 模块级常量,首次调用后缓存。graph-build-mutations 侧再接上提示词挂靠
 * 解析器(findPromptNodeForGenerated)装配成完整规则集。
 */
export function getImageWorkflowPortDeclarations(): ImageWorkflowPortDeclarations {
  if (!cachedPortDeclarations) {
    const inputsByType: Record<string, readonly InputChannelSpec[]> = {};
    const outputSeatsByType: Record<string, SourceOutputSeatsSpec> = {};
    for (const definition of IMAGE_WORKFLOW_DEFINITIONS) {
      if (definition.inputs) inputsByType[definition.typeId] = definition.inputs;
      if (definition.outputSeats) outputSeatsByType[definition.typeId] = definition.outputSeats;
    }
    cachedPortDeclarations = {
      inputsByType,
      outputSeatsByType,
      bannedSourceTypes: NON_WIRABLE_SOURCE_TYPES,
    };
  }
  return cachedPortDeclarations;
}

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

export function listCanvasNodeDefinitions(
  surface: CanvasSurface,
): readonly CanvasNodeEntry[] {
  return surface === "production-flow"
    ? productionFlowDefinitions
    : IMAGE_WORKFLOW_DEFINITIONS;
}

/** 小地图类型色 token;未注册类型回退 accent */
export function canvasMiniMapNodeToken(typeId: string): CanvasMiniMapToken {
  for (const definition of [...IMAGE_WORKFLOW_DEFINITIONS, ...productionFlowDefinitions]) {
    if (definition.typeId === typeId) return definition.miniMapToken;
  }
  return "accent";
}
