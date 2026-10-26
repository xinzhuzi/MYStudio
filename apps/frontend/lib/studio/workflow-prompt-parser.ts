/**
 * 出图提示词解构器(10-25-asset-prompt-layered-panel B-2,PRD §4.2):
 * 输入=PNG tEXt `prompt` 串(引擎实收的 API 形工作流 JSON),输出分层提示词结构,
 * 供「查词/实发终稿」弹层按层展示。纯函数,零 IO,零第三方依赖。
 *
 * 键位解构纪律(PRD §八/§九):**class_type 优先、节点号兜底**——先按节点类型定位,
 * 同类型多节点时用仓库模板真源钉死的节点号消歧;预期节点缺席=键位漂移,
 * 抛 WorkflowPromptParseError 而非静默空串(漂移锚,模板手术即红)。
 *
 * 键位真源(已验实盘+仓库模板):
 * - i2i 实盘样本(晏燎_共主期_海报_v1.png tEXt,40 节点,PRD §二 事实①):
 *   节点 400 `PrimitiveStringMultiline.value`=指令/主体终稿(实盘 1439 字);
 *   节点 6:4011 `MyQi21PromptAssembly` 的 inputs 含「锁层X全文」键=注入层
 *   (层名取键,实盘 锁层A全文=209 字底座全文);节点 10 `LoadImage` 在场→i2i;
 *   节点 7:7014 `PrimitiveInt.value`=主采样 seed。
 * - t2i 仓库模板真源(apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/
 *   qi21-道劫-t2i.json 画布形 + qwen21-道劫-t2i-api.json API 形):
 *   节点 400=正向主体句、节点 404=负向提示词(PrimitiveStringMultiline);
 *   `TextEncodeQwenImage21` 4015=主编码(API 形 negative_prompt 为内联串)、
 *   4016=负向编码(画布形,标题「[4015N] 负向编码·TextEncode」)——t2i 实弹
 *   产物落地后以实弹复核;`MyQi21美术风格底座` 的「负向词表」=底座负面全文。
 *   模板为画布形,tEXt 恒为 API 形(class_type 同源性推断并容错,画布形输入=错形抛错)。
 */

/** 注入层卡:层名=MyQi21PromptAssembly inputs 的「锁层X全文」键名,原文整段。 */
export interface WorkflowPromptLayer {
  name: string;
  text: string;
}

/** 解构产物(PRD §4.2 B-2 输出契约)。negative=可读负面文本(禁拼装,见下)。 */
export interface WorkflowPromptBreakdown {
  /** 指令/主体终稿(节点 400 PrimitiveStringMultiline.value,i2i/t2i 通用锚)。 */
  finalText: string;
  /** 注入层(i2i 装配键;t2i 无内联注入层,恒空数组)。 */
  layers: WorkflowPromptLayer[];
  /**
   * 负面文本:取 JSON 内联可读的负面源(编码器内联 negative_prompt /
   * 装配 主体句负面 / 404 负向提示词 / 美术风格底座负向词表),首个非空者。
   * 引擎侧型负+底座负的拼装真源在引擎模板内——本解构器**禁拼装第二真源**
   * (PRD §五 裁定 Q1),链接不可解析到底层文本时如实回空串。
   */
  negative: string;
  /** 主采样 seed(节点号 7:7014 优先;缺席回 null 不抛——seed 非漂移锚)。 */
  seed: number | null;
  /** LoadImage 在场=i2i,否则 t2i。 */
  routeHint: "i2i" | "t2i";
}

/** 键位漂移/输入错形错误(漂移锚:预期节点或键缺席即抛,不静默空)。 */
export class WorkflowPromptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowPromptParseError";
  }
}

interface WorkflowNode {
  class_type?: unknown;
  inputs?: unknown;
}

type WorkflowGraph = Record<string, WorkflowNode>;

/** API 形输入值:标量 | ComfyUI 链接 [节点号, 输出槽]。 */
type InputValue = string | number | boolean | [string, number] | unknown[] | undefined | null;

function isLinkValue(value: InputValue): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

function nodeInputs(node: WorkflowNode): Record<string, InputValue> {
  const inputs = node.inputs;
  if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) {
    return inputs as Record<string, InputValue>;
  }
  return {};
}

function nodesOfType(graph: WorkflowGraph, classType: string): Array<[string, WorkflowNode]> {
  return Object.entries(graph).filter(([, node]) => node.class_type === classType);
}

/**
 * 1025 my21fast:TE 类名并集——TextEncodeQwenImage21(官方/存量 api 件)与
 * MyQi21FastEncode(1025 手术件:qi21 道劫 t2i/i2i/edit 换类)同视为文本编码器;
 * 编码器识别面(resolveNegative 容错链 + t2i 路在场校验)一律走本并集。
 */
const TE_CLASS_UNION = ["TextEncodeQwenImage21", "MyQi21FastEncode"] as const;

function teNodesOf(graph: WorkflowGraph): Array<[string, WorkflowNode]> {
  return TE_CLASS_UNION.flatMap((cls) => nodesOfType(graph, cls));
}

function inlineStringValue(node: WorkflowNode, key: string): string | null {
  const value = nodeInputs(node)[key];
  return typeof value === "string" ? value : null;
}

/** 首个非空内联串(null=该键缺席/链接/空串——调用方续走下一来源)。 */
function nonEmptyInline(node: WorkflowNode, key: string): string | null {
  const value = inlineStringValue(node, key);
  return value !== null && value.length > 0 ? value : null;
}

/** 取图对象:优先 `graph` 成员(仓库 API 模板包装形),否则根对象(tEXt 平铺形)。 */
function resolveGraphObject(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const graph = (raw as { graph?: unknown }).graph;
  if (graph && typeof graph === "object" && !Array.isArray(graph)) return graph;
  return raw;
}

/** 收集 API 形节点(class_type 字符串键);画布形(nodes 数组)/空图 → 空表。 */
function collectApiNodes(raw: unknown): WorkflowGraph {
  const source = resolveGraphObject(raw);
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const graph: WorkflowGraph = {};
  for (const [id, node] of Object.entries(source as Record<string, unknown>)) {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const candidate = node as WorkflowNode;
      if (typeof candidate.class_type === "string") graph[id] = candidate;
    }
  }
  return graph;
}

/** 指令/主体终稿锚:节点号 400 优先,404(t2i 负向节点)排除;无法消歧=漂移。 */
function resolveFinalText(graph: WorkflowGraph): string {
  const candidates = nodesOfType(graph, "PrimitiveStringMultiline")
    .filter(([id]) => id !== "404");
  const pinned = candidates.find(([id]) => id === "400");
  if (pinned) {
    const value = inlineStringValue(pinned[1], "value");
    if (value !== null) return value;
  }
  if (candidates.length === 1) {
    const value = inlineStringValue(candidates[0][1], "value");
    if (value !== null) return value;
  }
  if (candidates.length === 0) {
    throw new WorkflowPromptParseError(
      "键位漂移:PrimitiveStringMultiline.value(指令/主体终稿锚)缺席",
    );
  }
  throw new WorkflowPromptParseError(
    "键位漂移:PrimitiveStringMultiline 多于一个且无 400 号节点可消歧",
  );
}

/** 注入层:MyQi21PromptAssembly inputs 中含「锁层」的键(层名取键,实盘钉)。 */
function resolveLockLayers(graph: WorkflowGraph): WorkflowPromptLayer[] {
  const assembly = nodesOfType(graph, "MyQi21PromptAssembly")[0];
  if (!assembly) {
    throw new WorkflowPromptParseError("键位漂移:i2i 路 MyQi21PromptAssembly 缺席");
  }
  const layers = Object.entries(nodeInputs(assembly[1]))
    .filter(([key, value]) => key.includes("锁层") && typeof value === "string")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, text]) => ({ name, text: text as string }));
  if (layers.length === 0) {
    throw new WorkflowPromptParseError("键位漂移:MyQi21PromptAssembly 无「锁层*」注入键");
  }
  return layers;
}

/**
 * 负面文本(容错链,首个非空内联可读者;空串=如实无可读负面,不抛错):
 * 1. 4016 号 TE(画布真源:负向编码节点,API 形常缺席;1025 特判保留)的
 *    prompt/negative_prompt 内联串;
 * 2. 任意 TE(1025 并集域)内联非空 negative_prompt(t2i API 形常为 ""——
 *    视为无可读,续走);
 * 3. negative_prompt 链接 → 目标节点(FinalOutput/装配)的 负向提示词/主体句负面
 *    内联非空串(i2i 实盘:negative_prompt 是链接,装配的 主体句负面 常为 "");
 * 4. 404 号 PrimitiveStringMultiline(t2i 负向提示词节点)内联非空;
 * 5. MyQi21美术风格底座「负向词表」(底座负面全文,t2i 模板真源 6:4032)。
 */
function resolveNegative(graph: WorkflowGraph): string {
  const encoders = teNodesOf(graph);
  const negativeEncoder = encoders.find(([id]) => id === "4016");
  if (negativeEncoder) {
    const fromPinned = nonEmptyInline(negativeEncoder[1], "prompt") ?? nonEmptyInline(negativeEncoder[1], "negative_prompt");
    if (fromPinned !== null) return fromPinned;
  }
  for (const [, encoder] of encoders) {
    const inline = nonEmptyInline(encoder, "negative_prompt");
    if (inline !== null) return inline;
  }
  for (const [, encoder] of encoders) {
    const linked = nodeInputs(encoder).negative_prompt;
    if (isLinkValue(linked)) {
      const target = graph[linked[0]];
      if (target) {
        const resolved = nonEmptyInline(target, "负向提示词") ?? nonEmptyInline(target, "主体句负面");
        if (resolved !== null) return resolved;
      }
    }
  }
  const negativePromptNode = nodesOfType(graph, "PrimitiveStringMultiline").find(([id]) => id === "404");
  if (negativePromptNode) {
    const inline = nonEmptyInline(negativePromptNode[1], "value");
    if (inline !== null) return inline;
  }
  for (const [, styleBase] of nodesOfType(graph, "MyQi21美术风格底座")) {
    const table = nonEmptyInline(styleBase, "负向词表");
    if (table !== null) return table;
  }
  return "";
}

/** seed:7:7014(主采样,模板真源钉)优先,PrimitiveInt 兜底;KSampler 域最后。 */
function resolveSeed(graph: WorkflowGraph): number | null {
  const ints = nodesOfType(graph, "PrimitiveInt")
    .map(([id, node]) => ({ id, value: nodeInputs(node).value }))
    .filter((entry): entry is { id: string; value: number } => typeof entry.value === "number");
  const pinned = ints.find((entry) => entry.id === "7:7014");
  if (pinned) return pinned.value;
  if (ints.length > 0) return ints[0].value;
  for (const classType of ["KSampler", "KSamplerAdvanced", "RandomNoise"]) {
    for (const [, node] of nodesOfType(graph, classType)) {
      for (const key of ["seed", "noise_seed"]) {
        const value = nodeInputs(node)[key];
        if (typeof value === "number") return value;
      }
    }
  }
  return null;
}

/**
 * 解构 API 形工作流 JSON(tEXt 串或仓库 API 模板 graph 包装形)。
 * 预期节点/键缺席抛 WorkflowPromptParseError(漂移锚,禁静默空)。
 */
export function parseWorkflowPrompt(workflowJson: string): WorkflowPromptBreakdown {
  let raw: unknown;
  try {
    raw = JSON.parse(workflowJson);
  } catch (error) {
    throw new WorkflowPromptParseError(
      `工作流 JSON 解析失败:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const graph = collectApiNodes(raw);
  if (Object.keys(graph).length === 0) {
    throw new WorkflowPromptParseError(
      "未找到 API 形工作流节点(无 class_type 键;画布形/空 JSON 不受支持)",
    );
  }
  const routeHint: "i2i" | "t2i" = nodesOfType(graph, "LoadImage").length > 0 ? "i2i" : "t2i";
  const finalText = resolveFinalText(graph);
  if (routeHint === "i2i") {
    // i2i 已验键位(实盘钉):装配+锁层注入键必须在场,缺席=模板键位漂移。
    const layers = resolveLockLayers(graph);
    return { finalText, layers, negative: resolveNegative(graph), seed: resolveSeed(graph), routeHint };
  }
  // t2i 已验键位(仓库模板钉):编码器(1025 并集域)必须在场,缺席=模板键位漂移。
  if (teNodesOf(graph).length === 0) {
    throw new WorkflowPromptParseError("键位漂移:t2i 路 TextEncodeQwenImage21/MyQi21FastEncode 缺席");
  }
  return { finalText, layers: [], negative: resolveNegative(graph), seed: resolveSeed(graph), routeHint };
}
