import type { ImageWorkflowGraph, ImageWorkflowNodeType, ImageWorkflowPromptNode } from "@/types/studio";

/**
 * 端口类型系统(09-08 ComfyUI 生态迁移三期A 声明式核心):连线合法性从
 * isValidImageEdge/isValidImageConnection 的手写 if-else 退役为
 * 「类型兼容 + 端口容量 + 互斥组」声明式查表。
 * 本文件只含数据词表与纯函数查表引擎(零 React/注册表依赖):声明数据由
 * canvas-node-registry 持有(注册表 inputs/outputSeats 字段),本引擎由
 * graph-build-mutations 接线调用;行为与旧手写实现逐例等价,由
 * port-types-parity.test.ts 差分对拍锁死。
 * 三期B(通用节点)扩展点:新节点类型在注册表声明 inputs(类型/容量/
 * 互斥组)即自动进入连线规则体系,无需改本引擎(见文末词表注释)。
 */

/** 端口数据类型 kind(输出资源/输入通道)。三期B 类型映射单源:prompt-text↔STRING、reference-image/generated-image↔IMAGE、mask↔MASK */
export type PortTypeKind = "prompt-text" | "reference-image" | "generated-image" | "mask";

/**
 * 类型兼容表:源输出 kind → 可落入的输入口 kind 集合。
 * reference-image 可作生成输入(参考语义);generated-image 自族可链
 * (成图/无衣物结果直通);prompt-text/mask 自族。三期B 通用节点未显式
 * 收窄 accepts 时按此表获得缺省连线规则;存量大白话节点的历史裁定收窄
 * 写在注册表各通道的 accepts 里。
 */
export const PORT_TYPE_COMPATIBILITY: Readonly<Record<PortTypeKind, readonly PortTypeKind[]>> = {
  "prompt-text": ["prompt-text"],
  "reference-image": ["reference-image", "generated-image"],
  "generated-image": ["generated-image"],
  mask: ["mask"],
};

/** 源节点类型 → 输出资源类型(与注册表 outputs 同源语义;sticky/group=画布注释容器无输出) */
export const NODE_OUTPUT_KIND: Readonly<Partial<Record<ImageWorkflowNodeType, PortTypeKind>>> = {
  reference: "reference-image",
  prompt: "prompt-text",
  generated: "generated-image",
  uncloth: "generated-image",
  nsfw: "prompt-text",
};

/** 类型兼容快捷判断(三期B 通用连线入口):输出 kind 能否落入输入 kind */
export function portKindCompatible(output: PortTypeKind, input: PortTypeKind): boolean {
  return PORT_TYPE_COMPATIBILITY[output].includes(input);
}

/** 通道可接源类型:"*"=兜底放行(旧成图尾态);数组=显式白名单;缺省=按类型兼容表推导 */
export type PortAcceptRule = readonly ImageWorkflowNodeType[] | "*";

/**
 * 存量无 handle 边的席位归属回落(与渲染层同口径):
 * non-prompt=非提示词源边归图口 / prompt-first=提示词源边归①口 / none=不归任何口
 */
export type LegacySeatRule = "none" | "prompt-first" | "non-prompt";

/** 容量计数口径:edges=按入边计数 / prompt-attach=按提示词挂靠(targetNodeId 直挂或入边,与 findPromptNodeForGenerated 同义) */
export type ChannelOccupancyMode = "edges" | "prompt-attach";

/** 物理输入口(handle 席位)声明——连线级(isValidImageConnection)查表源 */
export interface PortSeatSpec {
  /** React Flow targetHandle id(uncloth:image/prompt-1/prompt-2) */
  handleId: string;
  label: string;
  /** 该席位并存入边上限 */
  capacity: number;
  /** 源出口极性约束:连线带 sourceHandle 时必须同极性才放行(缺省=不筛) */
  polarity?: "positive" | "negative";
  /** 存量无 handle 边是否计入本席位(回落口径) */
  legacySeat: LegacySeatRule;
}

/** 逻辑输入通道声明——节点级(isValidImageEdge)查表源;席位是通道的物理投影 */
export interface InputChannelSpec {
  id: string;
  label: string;
  /** 本通道承载的数据类型(类型词表挂点) */
  type: PortTypeKind;
  /** 可接源节点类型(缺省=按 PORT_TYPE_COMPATIBILITY×NODE_OUTPUT_KIND 推导;"*"=兜底) */
  accepts?: PortAcceptRule;
  /** 节点级并存上限(无 handle/程序化建边口径);Number.POSITIVE_INFINITY=不限 */
  capacity: number;
  /** 容量计数口径(缺省 edges) */
  occupancy?: ChannelOccupancyMode;
  /** 已占用者==本次源时放行(成图提示词首根放行/自身 targetNodeId 直挂补边) */
  selfReallow?: boolean;
  /** 互斥组:这些通道已占用则本通道拒绝(成图提示词通道↔nsfw 链二选一) */
  mutexWith?: readonly string[];
  /** 物理 handle 席位(多口节点;缺省=整节点单口,无 handle 语义) */
  seats?: readonly PortSeatSpec[];
}

/** 源出口席位(09-07 双出口:prompt 正/负同口分席各≤1) */
export interface SourceOutputSeatSpec {
  handleId: string;
  label: string;
  /** 席位极性(存量无 sourceHandle 边按族的 legacyPolarity 归席) */
  polarity: "positive" | "negative";
  /** 拒绝此出口的目标类型(NSFW破限只吃正向) */
  bannedTargetTypes?: readonly string[];
}

/** 某源类型的出口席位族(连线级源侧查表源) */
export interface SourceOutputSeatsSpec {
  /** 归属源节点类型 */
  sourceType: ImageWorkflowNodeType;
  /** 无 targetHandle 时的席位键回落(双出口裁定:目标口×极性分席,缺省①口) */
  defaultSeatKey: string;
  /** 存量无 targetHandle 边仅当源类型在此列表才归入 defaultSeatKey(其余不占席) */
  legacySeatSourceTypes: readonly ImageWorkflowNodeType[];
  /** 存量无 sourceHandle 边归入的极性席(整节点语义占正席,行为兼容) */
  legacyPolarity: "positive" | "negative";
  seats: readonly SourceOutputSeatSpec[];
}

/** 注册表侧声明的纯数据部分(连线规则数据源) */
export interface ImageWorkflowPortDeclarations {
  /** 目标类型→输入通道声明;未登记类型=不可作为连线目标 */
  inputsByType: Readonly<Record<string, readonly InputChannelSpec[]>>;
  /** 源类型→出口席位声明 */
  outputSeatsByType: Readonly<Record<string, SourceOutputSeatsSpec>>;
  /** 禁作源的节点类型(便利贴/分组=画布注释容器,旧规则 sticky/group 源拒) */
  bannedSourceTypes: readonly string[];
}

/** 完整查表规则集(声明数据+提示词挂靠解析器接线而成) */
export interface ImageWorkflowPortRuleSet extends ImageWorkflowPortDeclarations {
  /** prompt-attach 口径解析器(findPromptNodeForGenerated 注入,单源不重复实现) */
  resolvePromptAttach: (
    graph: ImageWorkflowGraph,
    targetNodeId: string,
  ) => Pick<ImageWorkflowPromptNode, "id"> | undefined;
}

/** 注册表声明+挂靠解析器 → 完整规则集(graph-build-mutations 模块级装配一次) */
export function buildImageWorkflowPortRuleSet(
  declarations: ImageWorkflowPortDeclarations,
  resolvePromptAttach: ImageWorkflowPortRuleSet["resolvePromptAttach"],
): ImageWorkflowPortRuleSet {
  return { ...declarations, resolvePromptAttach };
}

// ────────── 查表引擎(纯函数;与旧手写分支逐分支等价,对拍测试锁死) ──────────

function nodeTypeOf(graph: ImageWorkflowGraph, nodeId: string): ImageWorkflowNodeType | undefined {
  return graph.nodes.find((node) => node.id === nodeId)?.type;
}

/** 通道是否可接该源类型:显式白名单 / 兜底 / 类型兼容表推导 */
function channelAccepts(channel: InputChannelSpec, sourceType: ImageWorkflowNodeType): boolean {
  if (channel.accepts === "*") return true;
  if (channel.accepts) return channel.accepts.includes(sourceType);
  const outputKind = NODE_OUTPUT_KIND[sourceType];
  return outputKind !== undefined && portKindCompatible(outputKind, channel.type);
}

/** 通道入边数(edges 口径:源类型落入通道可接集的入边,不筛 handle) */
function countChannelEdges(
  graph: ImageWorkflowGraph,
  targetNodeId: string,
  channel: InputChannelSpec,
): number {
  return graph.edges.filter((edge) => {
    if (edge.target !== targetNodeId) return false;
    const sourceType = nodeTypeOf(graph, edge.source);
    return sourceType !== undefined && channelAccepts(channel, sourceType);
  }).length;
}

/** 通道是否已被占用(互斥组判定;prompt-attach 口径不做 selfReallow 豁免) */
function isChannelOccupied(
  graph: ImageWorkflowGraph,
  targetNodeId: string,
  channel: InputChannelSpec,
  rules: ImageWorkflowPortRuleSet,
): boolean {
  if (channel.occupancy === "prompt-attach") {
    return rules.resolvePromptAttach(graph, targetNodeId) !== undefined;
  }
  return countChannelEdges(graph, targetNodeId, channel) > 0;
}

/** 存量无 handle 边是否计入某席位(回落口径与旧实现逐字一致) */
function edgeOccupiesSeat(
  graph: ImageWorkflowGraph,
  edge: { source: string; targetHandle?: string },
  seat: PortSeatSpec,
): boolean {
  if (edge.targetHandle) return edge.targetHandle === seat.handleId;
  const sourceType = nodeTypeOf(graph, edge.source);
  if (seat.legacySeat === "non-prompt") return sourceType !== "prompt";
  if (seat.legacySeat === "prompt-first") return sourceType === "prompt";
  return false;
}

/**
 * 节点级连线查表(isValidImageEdge 的声明式实现,签名/行为与旧手写逐例等价):
 * 自环拒 / 节点不存在拒 / 同向去重 / 禁作源(sticky、group)/ 目标类型
 * 未声明输入拒 → 命中通道后查「端口容量+互斥组」。
 */
export function evaluateImageEdge(
  graph: ImageWorkflowGraph,
  source: string,
  target: string,
  rules: ImageWorkflowPortRuleSet,
): boolean {
  if (source === target) return false;
  const sourceNode = graph.nodes.find((node) => node.id === source);
  const targetNode = graph.nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) return false;
  if (graph.edges.some((item) => item.source === source && item.target === target)) return false;
  if (rules.bannedSourceTypes.includes(sourceNode.type)) return false;

  const channels = rules.inputsByType[targetNode.type];
  if (!channels) return false;
  const channel = channels.find((item) => channelAccepts(item, sourceNode.type));
  if (!channel) return false;

  // 端口容量(节点级口径)
  if (channel.occupancy === "prompt-attach") {
    const attached = rules.resolvePromptAttach(graph, target);
    if (attached && !(channel.selfReallow && attached.id === source)) return false;
  } else if (channel.capacity !== Number.POSITIVE_INFINITY
    && countChannelEdges(graph, target, channel) >= channel.capacity) {
    return false;
  }
  // 互斥组(成图提示词通道↔nsfw 链二选一等)
  for (const mutexId of channel.mutexWith ?? []) {
    const mutexChannel = channels.find((item) => item.id === mutexId);
    if (mutexChannel && isChannelOccupied(graph, target, mutexChannel, rules)) return false;
  }
  return true;
}

/**
 * 连线级查表(isValidImageConnection 的声明式实现,分支顺序与旧手写一致):
 * ① 多口节点目标席位查表(uncloth image/①②;多口节点未知 handle 拒)
 * ② 源出口极性席位查表(prompt 正/负双出口同口分席各≤1)
 * ③ 无 handle 回落节点级查表
 */
export function evaluateImageConnection(
  graph: ImageWorkflowGraph,
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
  rules: ImageWorkflowPortRuleSet,
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.target === connection.source) return false;
  const sourceNode = graph.nodes.find((node) => node.id === connection.source);
  const targetNode = graph.nodes.find((node) => node.id === connection.target);

  // ① 目标席位口查表(多口节点全部规则整体前置:图口源类型检查先于通用席位分支)
  if (connection.targetHandle) {
    const channels = targetNode ? rules.inputsByType[targetNode.type] : undefined;
    if (channels) {
      let seatChannel: InputChannelSpec | undefined;
      let seat: PortSeatSpec | undefined;
      for (const channel of channels) {
        seat = (channel.seats ?? []).find((item) => item.handleId === connection.targetHandle);
        if (seat) {
          seatChannel = channel;
          break;
        }
      }
      if (seat && seatChannel) {
        // 口别类型兼容(通道白名单/兼容表;源节点不存在拒)
        if (!sourceNode || !channelAccepts(seatChannel, sourceNode.type)) return false;
        // 口别极性(①=正向席/②=负向席,极性错口拒;存量无 sourceHandle 边不筛)
        if (seat.polarity && connection.sourceHandle && connection.sourceHandle !== seat.polarity) {
          return false;
        }
        // 席位容量(存量无 handle 边按回落规则归口计席)
        const occupied = graph.edges.filter(
          (edge) => edge.target === connection.target && edgeOccupiesSeat(graph, edge, seat!),
        ).length;
        return occupied < seat.capacity;
      }
      // 多口节点的未知 handle:拒(旧规则 uncloth 未知口 return false)
      if (channels.some((channel) => (channel.seats ?? []).length > 0)) return false;
    }
  }

  // ② 源出口极性席位查表(prompt 正/负双出口:「目标口×极性」分席各≤1)
  if (sourceNode && connection.sourceHandle) {
    const outputSeats = rules.outputSeatsByType[sourceNode.type];
    if (outputSeats) {
      const seat = outputSeats.seats.find((item) => item.handleId === connection.sourceHandle);
      if (!seat) return false;
      const seatKey = connection.targetHandle ?? outputSeats.defaultSeatKey;
      const samePort = graph.edges.filter((edge) => {
        if (edge.target !== connection.target) return false;
        const edgeKey = edge.targetHandle
          ?? (nodeTypeOf(graph, edge.source) === outputSeats.sourceType ? outputSeats.defaultSeatKey : undefined);
        return edgeKey === seatKey;
      });
      // 目标类型出口黑名单(NSFW破限只吃正向)
      if (targetNode && seat.bannedTargetTypes?.includes(targetNode.type)) return false;
      const polarityTaken = samePort.some(
        (edge) => (edge.sourceHandle ?? outputSeats.legacyPolarity) === seat!.polarity,
      );
      return !polarityTaken;
    }
  }

  // ③ 无 handle(存量边/程序化建边)回落节点级规则
  const declaresSeats = targetNode
    ? (rules.inputsByType[targetNode.type] ?? []).some((channel) => (channel.seats ?? []).length > 0)
    : false;
  if (!declaresSeats || !connection.targetHandle) {
    return evaluateImageEdge(graph, connection.source, connection.target, rules);
  }
  return false;
}
