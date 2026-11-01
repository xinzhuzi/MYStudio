// 09-14 晚间用户裁定(research/0914-late-rulings.md):超分不进工作流——
// 单段直出模板(h3-shot-template,31 节点,无 LatentUpscaler/LTXV,仅节点 9 首帧槽;1004 深夜用户裁定去 MY- 前缀改名)
// 10-27 二期 multiseg(PRD §14.1):h3-multiseg-template{,.api}.json=repo 原件四针适配产物(脚本 --preset multiseg)
import templateJson from "./h3-shot-template.json";
import apiTemplateJson from "./h3-shot-template.api.json";
import fasth3TemplateJson from "./fasth3-shot-template.json";
import fasth3ApiTemplateJson from "./fasth3-shot-template.api.json";
import templateRefJson from "./h3-shot-template-ref2va.json";
import multisegTemplateJson from "./h3-multiseg-template.json";
import multisegApiTemplateJson from "./h3-multiseg-template.api.json";
import type { StoryboardItem } from "@/types/studio";
import { buildShotH3Prompt, buildShotH3MultisegPrompt, buildShotH3RefPrompt, extractPlannedDialogueTexts, verifyPlannedTextVerbatim, type H3AudioPolicy } from "./h3-shot-prompt";
import { H3_WORKFLOW_RECIPES, type H3ResolutionTier } from "./h3-workflow-recipes";

interface WorkflowNode {
  id: number;
  type: string;
  mode?: number;
  inputs?: Array<Record<string, unknown>>;
  outputs?: Array<Record<string, unknown>>;
  widgets_values?: unknown[];
  widgets_values_named?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

interface H3WorkflowTemplate {
  nodes: WorkflowNode[];
  links?: unknown[][];
  last_link_id?: number;
  [key: string]: unknown;
}

type ShotSemanticsForH3 = StoryboardItem["shotSemantics"] & {
  cameraMove?: string;
  shotSize?: string;
  action?: string;
};

export interface ShotH3WorkflowInput {
  shot: Pick<
    StoryboardItem,
    "id" | "index" | "videoDesc" | "prompt" | "duration" | "durationTarget" | "lines" | "sound" | "shotSemantics" | "mediaRef"
  >;
  chapterId: string;
  chapterLabel: string;
  /** Project captured by the host before any upload or generation await. */
  originProjectId?: string;
  policy?: H3AudioPolicy;
  /** 10-11 D1 音色锚(主会话授权最小透传):dispatch 直通 storyboard.emotion,
   *  传给 buildShotH3Prompt/RefPrompt 渲染 "says in a ${voiceMood} tone";
   *  缺省省略(=无锚现状)。 */
  voiceMood?: string;
  imageName?: string;
}

export interface ShotH3WorkflowResult {
  ui: Record<string, unknown>;
  name: string;
  report: { shot: number; seconds: number; frames: number; policy: H3AudioPolicy };
}

const REQUIRED_NODES: Array<[number, string]> = [
  [4, "SaveVideo"],
  [9, "LoadImage"],
  [14, "PrimitiveStringMultiline"],
  [20, "PrimitiveFloat"],
  [100, "MyShot"],
  [101, "MarkdownNote"],
];

/** API 档模板对(10-27 windows-fasth3-mainline W10 配方化):recipeId → (UI 画布档, API 图)。
 *  两对锚点契约同构(4/9/14/20/100/101 + 16 宽高直填),组装器注入/回收面零分叉;
 *  id 与 h3-workflow-recipes.ts 注册表对齐(注册表是数据面,本表是 bundle 面——
 *  有 apiTemplate 的注册条目才可派发,画布登记件不进本表)。 */
const H3_API_TEMPLATE_PAIRS: Record<string, { ui: H3WorkflowTemplate; api: ApiGraph }> = {
  "my-h3-i2v-31": { ui: templateJson as unknown as H3WorkflowTemplate, api: apiTemplateJson as unknown as ApiGraph },
  "my-fasth3-i2v-27": { ui: fasth3TemplateJson as unknown as H3WorkflowTemplate, api: fasth3ApiTemplateJson as unknown as ApiGraph },
};

export const DEFAULT_H3_RECIPE_ID = "my-h3-i2v-31";

/** 可 API 派发的配方 id 集(批量桥发车前校验用;未知/画布登记件在此被拒)。 */
export function h3ApiTemplateRecipeIds(): string[] {
  return Object.keys(H3_API_TEMPLATE_PAIRS);
}

function getNode(template: H3WorkflowTemplate, id: number, type: string): WorkflowNode {
  const node = template.nodes.find((item) => item.id === id);
  if (!node || node.type !== type) throw new Error(`h3-shot-template drift: node ${id} must be ${type}`);
  return node;
}

export function assertH3TemplateIntegrity(template: { nodes?: unknown }): void {
  if (!Array.isArray(template.nodes)) throw new Error("h3-shot-template drift: nodes missing");
  for (const [id, type] of REQUIRED_NODES) {
    const node = template.nodes.find((item): item is { id?: unknown; type?: unknown } => Boolean(item && typeof item === "object" && "id" in item && "type" in item) && (item as { id?: unknown }).id === id);
    if (!node || node.type !== type) throw new Error(`h3-shot-template drift: node ${id} must be ${type}`);
  }
}

function safeImageId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function shotLabel(index: number): string {
  return `S${String(index).padStart(2, "0")}`;
}

/** 文案逐字自检门(docs/comfyui-kb/参考_文案逐字自检门.md §一,10-01-a7 代码化):
 * 产出 prompt 之后、注入工作流(=入队派发)之前逐条验「计划文案一字不差在场」,
 * 任一缺席即抛大白话中文错误阻断派发(冒泡至桥消费 onError→toast,不静默不放行)。
 * 清单口径:仅 full 档台词进 prompt 才入清单(与 renderDialogue 同一解析源);
 * ambient/bare 档台词走 TTS 线不进 prompt(「No dialogue」),清单为空不拦。 */
function assertPlannedTextVerbatimGate(shot: ShotH3WorkflowInput["shot"], policy: H3AudioPolicy, prompt: string): void {
  const plannedTexts = policy === "full" ? extractPlannedDialogueTexts(shot.lines) : [];
  const { ok, missing } = verifyPlannedTextVerbatim(prompt, plannedTexts);
  if (ok) return;
  const items = missing.map((text) => `「${text}」`).join("");
  throw new Error(
    `文案逐字自检未通过,${shotLabel(shot.index)} 这镜已禁止派发:有 ${missing.length} 条计划台词没有一字不差地进入最终提示词——${items}。请回上一环节把文案修正到一字不差(含标点)后再派发。`,
  );
}

function setFirstWidget(node: WorkflowNode, value: unknown): void {
  if (!Array.isArray(node.widgets_values)) throw new Error(`h3-shot-template drift: node ${node.id} widgets_values missing`);
  node.widgets_values[0] = value;
}

function setNamedWidget(node: WorkflowNode, key: string, value: unknown): void {
  if (node.widgets_values_named) node.widgets_values_named[key] = value;
}

function connectVideoWriteback(template: H3WorkflowTemplate): void {
  const saveVideo = getNode(template, 4, "SaveVideo");
  const anchor = getNode(template, 100, "MyShot");
  const output = saveVideo.outputs?.[0];
  if (!output) throw new Error("h3-shot-template drift: SaveVideo video output missing");
  const existing = anchor.inputs?.find((input) => input.name === "video");
  if (existing) return;
  const nextLinkId = Math.max(template.last_link_id ?? 0, ...(template.links ?? []).map((link) => Number(link[0]) || 0)) + 1;
  const link = [nextLinkId, 4, 0, 100, 0, "VIDEO"];
  output.links = [...((output.links as number[] | undefined) ?? []), nextLinkId];
  anchor.inputs = [{ name: "video", type: "VIDEO", link: nextLinkId }, ...(anchor.inputs ?? [])];
  template.links = [...(template.links ?? []), link];
  template.last_link_id = nextLinkId;
}

export function buildShotH3Workflow(input: ShotH3WorkflowInput): ShotH3WorkflowResult {
  return buildShotWorkflowFromTemplate(templateJson, input);
}

/** 画布档组装真身(10-27 windows-fasth3-mainline W10 配方化:模板参数化,
 *  buildShotH3Workflow 保留为旧模板薄壳=旧行为零变;FastH3 通道走同真身)。 */
function buildShotWorkflowFromTemplate(source: H3WorkflowTemplate, input: ShotH3WorkflowInput): ShotH3WorkflowResult {
  const template = JSON.parse(JSON.stringify(source)) as H3WorkflowTemplate;
  assertH3TemplateIntegrity(template);
  connectVideoWriteback(template);
  const policy = input.policy ?? "ambient";
  const shot = input.shot;
  const semantics = shot.shotSemantics as ShotSemanticsForH3;
  const description = shot.videoDesc.trim() || shot.prompt.trim();
  const durationSec = shot.durationTarget ?? shot.duration;
  const prompt = buildShotH3Prompt({
    videoDesc: description,
    action: semantics?.action || [semantics?.actionIn, semantics?.actionOut].filter(Boolean).join(" "),
    cameraMove: semantics?.cameraMove,
    shotSize: semantics?.shotSize,
    lines: shot.lines,
    sound: shot.sound,
    durationSec,
    voiceMood: input.voiceMood,
  }, policy);
  assertPlannedTextVerbatimGate(shot, policy, prompt.prompt);
  const label = shotLabel(shot.index);
  const imageName = input.imageName ?? `my-shot-h3-${safeImageId(shot.id)}.jpg`;

  const saveVideo = getNode(template, 4, "SaveVideo");
  const firstFrame = getNode(template, 9, "LoadImage");
  const promptNode = getNode(template, 14, "PrimitiveStringMultiline");
  const secondsNode = getNode(template, 20, "PrimitiveFloat");
  const prefix = `video/漫影/${input.chapterId}/${shot.id}/${policy}`;
  setFirstWidget(saveVideo, prefix);
  setNamedWidget(saveVideo, "filename_prefix", prefix);
  // 裁定二:I2V 单图语义——模板内节点 9 旁路(mode=4)占位,注入图名时激活
  setFirstWidget(firstFrame, imageName);
  setNamedWidget(firstFrame, "image", imageName);
  firstFrame.mode = 0;
  setFirstWidget(promptNode, prompt.prompt);
  setNamedWidget(promptNode, "text", prompt.prompt);
  setFirstWidget(secondsNode, prompt.seconds);
  setNamedWidget(secondsNode, "value", prompt.seconds);

  const anchor = getNode(template, 100, "MyShot");
  anchor.widgets_values = [shot.id, label, description, "图✓"];
  anchor.properties = { ...(anchor.properties ?? {}), myPreview: imageName, myOriginProjectId: input.originProjectId ?? "", myOriginEpisodeId: input.chapterId };

  // 09-14 用户裁定(二次修订):漫影工作流文件名一律 `MY-` 前缀。
  const name = `MY-单镜视频 · ${input.chapterLabel} · ${label}`;
  return {
    ui: template as unknown as Record<string, unknown>,
    name,
    report: { shot: shot.index, seconds: prompt.seconds, frames: prompt.lengthFrames, policy },
  };
}

/** API 档输入(§5.2 C3):画布档输入 + 首帧 b64(走 execute images 通道上传)+ 分辨率档。
 *  recipeId(10-27 windows-fasth3-mainline W10):选模板对——缺省 "my-h3-i2v-31"=旧行为
 *  零变;"my-fasth3-i2v-27"=Windows FastH3 主线对(fasth3-shot-template{,.api}.json)。 */
export interface ShotH3ApiWorkflowInput extends ShotH3WorkflowInput {
  /** 首帧图 base64(execute images 通道后端代上传);缺省=9 节点只填派生名不带上传(引擎 input 须已有同名文件)。 */
  firstFrameB64?: string;
  /** 分辨率档(D5 批量默认 960P 生产);960p=1344×768、480p=608×352(N11)。 */
  resolutionTier?: H3ResolutionTier;
  /** 工作流配方 id(h3-workflow-recipes 注册表;缺省=旧 H3 线 my-h3-i2v-31)。 */
  recipeId?: string;
}

export interface ShotH3ApiWorkflowResult {
  /** 出厂即完整可执行 API 图(C3:标量已直填,批量器零再加工) */
  apiGraph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  /** 画布档同源 UI 图(properties 三键已注入)——直接作 extraPngInfo.workflow 附件 */
  uiWorkflow: Record<string, unknown>;
  /** b64 图独走 images 通道;无 b64=空数组 */
  images: Array<{ key: string; name: string; b64: string }>;
  report: { shot: number; seconds: number; frames: number; policy: H3AudioPolicy };
}

type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const H3_RESOLUTION_TIERS: Record<"480p" | "960p", readonly [number, number]> = {
  "480p": [608, 352],
  "960p": [1344, 768],
};

function getApiNode(apiGraph: ApiGraph, id: string, classType: string): { class_type: string; inputs: Record<string, unknown> } {
  const node = apiGraph[id];
  if (!node || node.class_type !== classType) throw new Error(`h3-shot-template.api.json drift: node ${id} must be ${classType}`);
  return node;
}

/** API 档组装器(§5.2,通道B 批量派发真身;C3 修正:标量出厂直填,不走 strings 通用注入)。
 *  提示词链与画布档完全同源——先跑 buildShotWorkflowFromTemplate(内含 buildShotH3Prompt+
 *  文案逐字自检门+dialogueAudioPolicy+voiceMood+MyShot properties 三键),再从同源 UI 图读值
 *  直填 apiGraph,两形态逐字一致;自检门失败时大白话错误在此抛出。
 *  W10 配方化:按 recipeId 选 (UI, API) 模板对;两对锚点契约同构(14.value/20.value/9.image/
 *  4.filename_prefix/100/16 宽高直填),注入与回收面零分叉;未知 id 抛错(禁静默回缺省)。 */
export function buildShotH3ApiWorkflow(input: ShotH3ApiWorkflowInput): ShotH3ApiWorkflowResult {
  const tier = input.resolutionTier ?? "960p";
  const recipeId = input.recipeId ?? DEFAULT_H3_RECIPE_ID;
  const pair = H3_API_TEMPLATE_PAIRS[recipeId];
  if (!pair) {
    throw new Error(`未知 H3 工作流配方:${recipeId}(可派发配方:${h3ApiTemplateRecipeIds().join(" / ")})`);
  }
  const base = buildShotWorkflowFromTemplate(pair.ui, input);
  const nodes = base.ui.nodes as WorkflowNode[];
  const widgets = (id: number, type: string): unknown[] => {
    const node = getNode({ nodes } as H3WorkflowTemplate, id, type);
    if (!Array.isArray(node.widgets_values)) throw new Error(`h3-shot-template drift: node ${id} widgets_values missing`);
    return node.widgets_values;
  };
  const widget = (id: number, type: string): unknown => widgets(id, type)[0];

  const apiGraph = JSON.parse(JSON.stringify(pair.api)) as ApiGraph;
  const promptText = widget(14, "PrimitiveStringMultiline");
  const seconds = widget(20, "PrimitiveFloat");
  const prefix = widget(4, "SaveVideo");
  const imageName = widget(9, "LoadImage");
  const myShotWidgets = widgets(100, "MyShot");
  if (!Array.isArray(myShotWidgets) || myShotWidgets.length < 4) throw new Error("h3-shot-template drift: node 100 widgets_values missing");
  const [shotId, label, description, mediaStatus] = myShotWidgets;

  // 锚字段名以 object_info 实锚为准(1027 引擎 17001 实查;14 的文本锚=value 非 text)
  getApiNode(apiGraph, "14", "PrimitiveStringMultiline").inputs.value = promptText;
  getApiNode(apiGraph, "20", "PrimitiveFloat").inputs.value = seconds; // PrimitiveFloat 得 number,不走全字符串注入通道
  getApiNode(apiGraph, "4", "SaveVideo").inputs.filename_prefix = prefix;
  getApiNode(apiGraph, "9", "LoadImage").inputs.image = imageName;
  const myShot = getApiNode(apiGraph, "100", "MyShot");
  myShot.inputs = { ...myShot.inputs, shot_id: shotId, label, description, media_status: mediaStatus };
  const generator = getApiNode(apiGraph, "16", "MiniMaxH3ImageToVideo");
  const [width, height] = H3_RESOLUTION_TIERS[tier]; // 档位直填覆盖出厂 ResolutionSelector link(N11)
  generator.inputs.width = width;
  generator.inputs.height = height;

  const images = input.firstFrameB64 ? [{ key: "9.image", name: String(imageName), b64: input.firstFrameB64 }] : [];
  return { apiGraph, uiWorkflow: base.ui, images, report: base.report };
}

// ── multiseg API 档(PRD 10-27 §14.1.4;my-h3-multiseg 适配的分段组装器)──────────────────────────

/** multiseg 档位映射(§14.1.4 M5):960×544=模板原厂值,禁擅改比例;不与 i2v-31 的
 *  1344×768 共用——turbo LoRA 名义 768p,960×544 失配属画质问题非正确性问题,实弹判读后候令对齐。 */
const MULTISEG_RESOLUTION_TIERS: Record<"960p", readonly [number, number]> = { "960p": [960, 544] };
/** multiseg 适配模板完整性锚(四针产物,脚本 h3_template_to_api_1027.py --preset multiseg 生成)。 */
const MULTISEG_REQUIRED_NODES: Array<[number, string]> = [
  [4, "SaveVideo"],
  [9, "LoadImage"],
  [100, "H3Parameter"],
  [101, "H3AutoContextSampler"],
  [103, "MyShot"],
];

/** multiseg API 档组装器(§14.1.4):克隆适配 UI 模板(h3-multiseg-template.json,四针产物)
 *  →注入(long_prompt/宽高 960×544/首帧名/五段前缀/MyShot 四字段+properties 三键/激活 9+103)→
 *  读值直填 apiGraph(照 buildShotH3ApiWorkflow「一份组装产两形态」范式,两形态逐字一致)。
 *  提示词=buildShotH3MultisegPrompt(分段大文本)+文案逐字自检门(同门同文案);
 *  无 seconds 锚——时长在分段文本标签行内(§4.1 修订:multiseg 适配后有 firstFrame 潜空间锚)。 */
export function buildShotH3MultisegApiWorkflow(input: ShotH3ApiWorkflowInput): ShotH3ApiWorkflowResult {
  const tier = input.resolutionTier ?? "960p";
  if (tier !== "960p") {
    throw new Error("my-h3-multiseg 暂只支持 960p 档(960×544 模板原厂比例;480p 属画质对齐议题候令,非档位裁剪)");
  }
  const template = JSON.parse(JSON.stringify(multisegTemplateJson)) as H3WorkflowTemplate;
  for (const [id, type] of MULTISEG_REQUIRED_NODES) {
    const node = template.nodes.find((item) => item.id === id);
    if (!node || node.type !== type) throw new Error(`h3-multiseg-template drift: node ${id} must be ${type}`);
  }
  const policy = input.policy ?? "ambient";
  const shot = input.shot;
  const description = shot.videoDesc.trim() || shot.prompt.trim();
  const durationSec = shot.durationTarget ?? shot.duration;
  const prompt = buildShotH3MultisegPrompt({
    videoDesc: description,
    durationTarget: durationSec,
    lines: shot.lines,
    sound: shot.sound,
    policy,
    voiceMood: input.voiceMood,
    fps: 24, // 模板 100.fps 出厂值,组装恒与模板一致
  });
  assertPlannedTextVerbatimGate(shot, policy, prompt.longPrompt);
  const label = shotLabel(shot.index);
  const imageName = input.imageName ?? `my-shot-h3-${safeImageId(shot.id)}.jpg`;
  const prefix = `video/漫影/${input.chapterId}/${shot.id}/${policy}`;

  // 注入 UI 克隆:首帧/前缀/分段提示词/宽高原厂档/MyShot 四字段+properties 三键/激活双旁路节点
  const saveVideo = getNode(template, 4, "SaveVideo");
  const firstFrame = getNode(template, 9, "LoadImage");
  const parameter = getNode(template, 100, "H3Parameter");
  const anchor = getNode(template, 103, "MyShot");
  const [width, height] = MULTISEG_RESOLUTION_TIERS["960p"];
  setFirstWidget(saveVideo, prefix);
  setNamedWidget(saveVideo, "filename_prefix", prefix);
  setFirstWidget(firstFrame, imageName);
  setNamedWidget(firstFrame, "image", imageName);
  firstFrame.mode = 0; // 适配模板出厂旁路(防占位污染收件箱),组装时激活(i2v 节点 9 同构)
  if (!Array.isArray(parameter.widgets_values) || parameter.widgets_values.length < 19) {
    throw new Error("h3-multiseg-template drift: node 100 widgets_values missing");
  }
  parameter.widgets_values[0] = prompt.longPrompt;
  parameter.widgets_values[6] = width;
  parameter.widgets_values[7] = height;
  anchor.widgets_values = [shot.id, label, description, "图✓"];
  anchor.properties = { ...(anchor.properties ?? {}), myPreview: imageName, myOriginProjectId: input.originProjectId ?? "", myOriginEpisodeId: input.chapterId };
  anchor.mode = 0;

  // 读值直填 apiGraph(锚=object_info 实锚:100.long_prompt/100.width/100.height/4/9/103)
  const apiGraph = JSON.parse(JSON.stringify(multisegApiTemplateJson)) as ApiGraph;
  const parameterApi = getApiNode(apiGraph, "100", "H3Parameter");
  parameterApi.inputs.long_prompt = prompt.longPrompt;
  parameterApi.inputs.width = width;
  parameterApi.inputs.height = height;
  getApiNode(apiGraph, "4", "SaveVideo").inputs.filename_prefix = prefix;
  getApiNode(apiGraph, "9", "LoadImage").inputs.image = imageName;
  const myShot = getApiNode(apiGraph, "103", "MyShot");
  myShot.inputs = { ...myShot.inputs, shot_id: shot.id, label, description, media_status: "图✓" };

  const images = input.firstFrameB64 ? [{ key: "9.image", name: imageName, b64: input.firstFrameB64 }] : [];
  return {
    apiGraph,
    uiWorkflow: template as unknown as Record<string, unknown>,
    images,
    report: {
      shot: shot.index,
      seconds: prompt.totalSeconds,
      frames: prompt.segments.reduce((sum, segment) => sum + segment.frames, 0),
      policy,
    },
  };
}

/** 注册表分派组装器(§14.1.4):按 H3_WORKFLOW_RECIPES 查 inputMode——
 *  multiseg→buildShotH3MultisegApiWorkflow;i2v 族→buildShotH3ApiWorkflow(W10 配方化
 *  模板对);未知 id 抛错(禁静默回缺省)。 */
export function buildShotH3ApiWorkflowForRecipe(recipeId: string, input: ShotH3ApiWorkflowInput): ShotH3ApiWorkflowResult {
  const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === recipeId);
  if (!recipe) {
    throw new Error(`未知 H3 工作流配方:${recipeId}(注册表在册:${H3_WORKFLOW_RECIPES.map((item) => item.id).join(" / ")})`);
  }
  if (recipe.inputMode === "multiseg") return buildShotH3MultisegApiWorkflow(input);
  return buildShotH3ApiWorkflow({ ...input, recipeId });
}

/** 批量可派发配方 id 集(§14.1.4,W10 配方化与 multiseg 并轨):bundle 模板对(i2v 族)
 *  + 注册表 ready 的 multiseg 件(走专用组装器,不进模板对表)。发车前双门之一:
 *  注册表 ready 门(batchDispatchableH3Recipes)在前,本集在后。 */
export function h3BatchDispatchableRecipeIds(): string[] {
  return [
    ...Object.keys(H3_API_TEMPLATE_PAIRS),
    ...H3_WORKFLOW_RECIPES.filter((item) => item.inputMode === "multiseg" && item.status === "ready").map((item) => item.id),
  ];
}

/** i2v 族档位执行超时秒(PRD D2:480P 全链≈334s 留裕量;960P 21min+冷启 4min;现状不动)。 */
const H3_I2V_TIER_TIMEOUT_S: Record<H3ResolutionTier, number> = { "480p": 900, "960p": 2700 };
/** multiseg 执行超时公式基数:600s 冷启/装载余量+每秒 300s(§14.1.4;40s 960p≈12600s+余量)。 */
const MULTISEG_TIMEOUT_BASE_S = 600;
const MULTISEG_TIMEOUT_PER_SECOND_S = 300;
/** multiseg 超时上限(§14.1.5 M2:40s 960p≈12600s+冷启+余量;与 execute.py MAX_EXECUTE_TIMEOUT_S=14400 对齐)。 */
export const MULTISEG_TIMEOUT_CAP_S = 14400;

/** 执行超时秒解析(§14.1.4):i2v 族=档位表(900/2700,现状不动);
 *  multiseg=600+ceil(seconds)×300(960p 单档),clamp≤14400。
 *  前端轮询 pollTimeoutMs=timeoutS×1000+30s 既有公式自动随宽。 */
export function resolveH3ShotTimeoutS(recipeId: string, seconds: number, tier: H3ResolutionTier = "960p"): number {
  const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === recipeId);
  if (!recipe) {
    throw new Error(`未知 H3 工作流配方:${recipeId}(注册表在册:${H3_WORKFLOW_RECIPES.map((item) => item.id).join(" / ")})`);
  }
  if (recipe.inputMode === "multiseg") {
    return Math.min(MULTISEG_TIMEOUT_CAP_S, MULTISEG_TIMEOUT_BASE_S + Math.ceil(seconds) * MULTISEG_TIMEOUT_PER_SECOND_S);
  }
  return H3_I2V_TIER_TIMEOUT_S[tier];
}

/** Ref2VA 参考资产(宿主按 shot.assetIds 调度后传入;≤4,按序占 ref_image_1..4)。 */
export interface ShotH3RefAssetInput {
  name: string;
  kind: "character" | "scene";
  imageName: string;
}

export interface ShotH3RefWorkflowInput extends ShotH3WorkflowInput {
  refs: ShotH3RefAssetInput[];
}

/** Ref2VA 资产调度档:分镜图恒占 ref_image_0;refs 按序激活 110-113 槽,
 * 定妆照/场景图经六节提示词绑定 <Subject>/<Picture>(09-14-h3-ref2va-line)。 */
const REF_IMAGE_NODE_IDS = [110, 111, 112, 113] as const;

export function buildShotH3RefWorkflow(input: ShotH3RefWorkflowInput): ShotH3WorkflowResult {
  const template = JSON.parse(JSON.stringify(templateRefJson)) as H3WorkflowTemplate;
  assertH3TemplateIntegrity(template);
  connectVideoWriteback(template);
  getNode(template, 16, "MiniMaxH3ReferenceToVideo");
  const policy = input.policy ?? "ambient";
  const shot = input.shot;
  const semantics = shot.shotSemantics as ShotSemanticsForH3;
  const description = shot.videoDesc.trim() || shot.prompt.trim();
  const durationSec = shot.durationTarget ?? shot.duration;
  const refs = input.refs.slice(0, REF_IMAGE_NODE_IDS.length);
  const characters = [] as Array<{ name: string; pictureIndex: number }>;
  let scene: { name: string; pictureIndex: number } | undefined;
  refs.forEach((ref, position) => {
    const pictureIndex = position + 2; // ref_image_1..4 → <Picture 2..5>
    if (ref.kind === "character") characters.push({ name: ref.name, pictureIndex });
    else if (!scene) scene = { name: ref.name, pictureIndex };
  });
  const prompt = buildShotH3RefPrompt({
    videoDesc: description,
    action: semantics?.action || [semantics?.actionIn, semantics?.actionOut].filter(Boolean).join(" "),
    cameraMove: semantics?.cameraMove,
    shotSize: semantics?.shotSize,
    lines: shot.lines,
    sound: shot.sound,
    durationSec,
    storyboardPictureIndex: 1,
    characters,
    scene,
    voiceMood: input.voiceMood,
  }, policy);
  assertPlannedTextVerbatimGate(shot, policy, prompt.prompt);
  const label = shotLabel(shot.index);
  const imageName = input.imageName ?? `my-shot-h3-${safeImageId(shot.id)}.jpg`;

  const saveVideo = getNode(template, 4, "SaveVideo");
  const firstFrame = getNode(template, 9, "LoadImage");
  const promptNode = getNode(template, 14, "PrimitiveStringMultiline");
  const secondsNode = getNode(template, 20, "PrimitiveFloat");
  const prefix = `video/漫影/${input.chapterId}/${shot.id}/ref-${policy}`;
  setFirstWidget(saveVideo, prefix);
  setNamedWidget(saveVideo, "filename_prefix", prefix);
  setFirstWidget(firstFrame, imageName);
  setNamedWidget(firstFrame, "image", imageName);
  firstFrame.mode = 0;
  setFirstWidget(promptNode, prompt.prompt);
  setNamedWidget(promptNode, "text", prompt.prompt);
  setFirstWidget(secondsNode, prompt.seconds);
  setNamedWidget(secondsNode, "value", prompt.seconds);
  REF_IMAGE_NODE_IDS.forEach((nodeId, position) => {
    const ref = refs[position];
    if (!ref) return; // 未用的占位槽保持模板旁路
    const node = getNode(template, nodeId, "LoadImage");
    setFirstWidget(node, ref.imageName);
    setNamedWidget(node, "image", ref.imageName);
    node.mode = 0;
  });

  const anchor = getNode(template, 100, "MyShot");
  anchor.widgets_values = [shot.id, label, description, "图✓"];
  anchor.properties = { ...(anchor.properties ?? {}), myPreview: imageName, myOriginProjectId: input.originProjectId ?? "", myOriginEpisodeId: input.chapterId };

  const name = `MY-单镜视频Ref2VA · ${input.chapterLabel} · ${label}`;
  return {
    ui: template as unknown as Record<string, unknown>,
    name,
    report: { shot: shot.index, seconds: prompt.seconds, frames: prompt.lengthFrames, policy },
  };
}
