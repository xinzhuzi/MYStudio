// 09-14 晚间用户裁定(research/0914-late-rulings.md):超分不进工作流——
// 单段直出模板(h3-shot-template,31 节点,无 LatentUpscaler/LTXV,仅节点 9 首帧槽;1004 深夜用户裁定去 MY- 前缀改名)
// 10-27 二期 multiseg(PRD §14.1):h3-multiseg-template{,.api}.json=repo 原件四针适配产物(脚本 --preset multiseg)
import templateJson from "./h3-shot-template.json";
import apiTemplateJson from "./h3-shot-template.api.json";
import fasth3TemplateJson from "./fasth3-shot-template.json";
import fasth3ApiTemplateJson from "./fasth3-shot-template.api.json";
import templateRefJson from "./h3-shot-template-ref2va.json";
import multisegTemplateJson from "./h3-multiseg-template.json";
import pikaTemplateJson from "./pika-shot-template.json";
import pikaApiTemplateJson from "./pika-shot-template.api.json";
import pikaRefTemplateJson from "./pika-ref-shot-template.json";
import pikaRefApiTemplateJson from "./pika-ref-shot-template.api.json";
import multisegApiTemplateJson from "./h3-multiseg-template.api.json";
// 1112 recavsr-mainline:三采主线模板对——GUI 档=repo 主线件原样拷贝语义
// (103 节点含 TESSERA ③组/300-301 旁路);API 母体=Win 实弹验证过的 59 节点
// 塑形图(九节点签名塑形:220 削口/260-267 sol-attn/206 target-dim/214-130 auto/266 taeh3)。
import sancaiTemplateJson from "./h3-three-stage-template.json";
import sancaiApiTemplateJson from "./h3-three-stage-template.api.json";
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
  "my-pika-fl2v-24": { ui: pikaTemplateJson as unknown as H3WorkflowTemplate, api: pikaApiTemplateJson as unknown as ApiGraph },
  // 1101 pika-ref2va-mainline:r2v 族走专用组装器 buildShotH3RefApiWorkflow(分派器按
  // inputMode 路由,不经 buildShotH3ApiWorkflow);本对供可派发集/注册表↔bundle 一致性口径。
  "my-pika-ref2v-20": { ui: pikaRefTemplateJson as unknown as H3WorkflowTemplate, api: pikaRefApiTemplateJson as unknown as ApiGraph },
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
  // 生成器节点按 class 动态锚(1112 深读实雷修):i2v 族 API 图里唯一的 MiniMaxH3ImageToVideo 即生成器——
  // pika 对生成器是 131(非 16),硬编码号会让 my-pika-fl2v-24 派发当场 drift 抛错。
  const generatorIds = Object.keys(apiGraph).filter((id) => apiGraph[id]?.class_type === "MiniMaxH3ImageToVideo");
  if (generatorIds.length !== 1) {
    throw new Error(`h3-shot-template.api.json drift: MiniMaxH3ImageToVideo 生成器应恰一个(${recipeId}),实得 [${generatorIds.join(",")}]`);
  }
  const generator = getApiNode(apiGraph, generatorIds[0]!, "MiniMaxH3ImageToVideo");
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

/** 注册表分派组装器(§14.1.4;1101 pika-ref2va-mainline 增 r2v 分支;1112 recavsr-mainline
 *  增三采分支):按 H3_WORKFLOW_RECIPES 查 inputMode——sancai 族→buildShotH3SancaiApiWorkflow
 *  (两段拆链,r2v/i2v 共用真身,219 布尔置位);multiseg→buildShotH3MultisegApiWorkflow;
 *  r2v→buildShotH3RefApiWorkflow(Pika ref2va 参考线专用,refs 注入);i2v 族→
 *  buildShotH3ApiWorkflow(W10 配方化模板对);未知 id 抛错(禁静默回缺省)。 */
export function buildShotH3ApiWorkflowForRecipe(
  recipeId: string,
  input: ShotH3ApiWorkflowInput & Partial<Pick<ShotH3SancaiApiWorkflowInput, "r2v" | "refs" | "frameWidth" | "frameHeight">>,
): ShotH3ApiWorkflowResult {
  const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === recipeId);
  if (!recipe) {
    throw new Error(`未知 H3 工作流配方:${recipeId}(注册表在册:${H3_WORKFLOW_RECIPES.map((item) => item.id).join(" / ")})`);
  }
  if (recipe.inputMode === "sancai-r2v" || recipe.inputMode === "sancai-i2v") {
    const sancaiInput = input as ShotH3SancaiApiWorkflowInput;
    if (typeof sancaiInput.frameWidth !== "number" || typeof sancaiInput.frameHeight !== "number") {
      throw new Error("三采配方派发需要首帧像素宽高(frameWidth/frameHeight——AR 阶梯推导源,可用 parseImageSizeFromB64 从 b64 解出)");
    }
    return buildShotH3SancaiApiWorkflow({
      ...input,
      r2v: recipe.inputMode === "sancai-r2v",
      refs: sancaiInput.refs,
      frameWidth: sancaiInput.frameWidth,
      frameHeight: sancaiInput.frameHeight,
    });
  }
  if (recipe.inputMode === "multiseg") return buildShotH3MultisegApiWorkflow(input);
  if (recipe.inputMode === "r2v") return buildShotH3RefApiWorkflow({ ...input, refs: (input as ShotH3RefApiWorkflowInput).refs ?? [] });
  return buildShotH3ApiWorkflow({ ...input, recipeId });
}

/** 批量可派发配方 id 集(§14.1.4,W10 配方化与 multiseg 并轨;1112 增三采):bundle
 *  模板对(i2v 族)+ 注册表 ready 的 multiseg/sancai 件(走专用组装器,不进模板对表)。
 *  发车前双门之一:注册表 ready 门(batchDispatchableH3Recipes)在前,本集在后。 */
export function h3BatchDispatchableRecipeIds(): string[] {
  return [
    ...Object.keys(H3_API_TEMPLATE_PAIRS),
    ...H3_WORKFLOW_RECIPES.filter(
      (item) => item.status === "ready" && (item.inputMode === "multiseg" || item.inputMode === "sancai-r2v" || item.inputMode === "sancai-i2v"),
    ).map((item) => item.id),
  ];
}

/** i2v 族档位执行超时秒(PRD D2:480P 全链≈334s 留裕量;960P 21min+冷启 4min;现状不动)。 */
const H3_I2V_TIER_TIMEOUT_S: Record<H3ResolutionTier, number> = { "480p": 900, "960p": 2700 };
/** multiseg 执行超时公式基数:600s 冷启/装载余量+每秒 300s(§14.1.4;40s 960p≈12600s+余量)。 */
const MULTISEG_TIMEOUT_BASE_S = 600;
const MULTISEG_TIMEOUT_PER_SECOND_S = 300;
/** multiseg 超时上限(§14.1.5 M2:40s 960p≈12600s+冷启+余量;与 execute.py MAX_EXECUTE_TIMEOUT_S=14400 对齐)。 */
export const MULTISEG_TIMEOUT_CAP_S = 14400;
/** 三采两段档超时(Note103 法则③实测:1:1 方图 10s=一二采 472.5s+三采 70.3s;
 *  段A(一二采)900s/段B(三采)300s 留裕量,冷启含加载)。 */
export const SANCAI_STAGE_A_TIMEOUT_S = 900;
export const SANCAI_STAGE_B_TIMEOUT_S = 300;

/** 三采两段档超时表(1112 recavsr-mainline):段A=一二采 900s、段B=三采 300s。 */
export function resolveSancaiStageTimeoutS(): { stageA: number; stageB: number } {
  return { stageA: SANCAI_STAGE_A_TIMEOUT_S, stageB: SANCAI_STAGE_B_TIMEOUT_S };
}

/** 执行超时秒解析(§14.1.4;1112 三采分支):i2v 族=档位表(900/2700,现状不动);
 *  multiseg=600+ceil(seconds)×300(960p 单档),clamp≤14400;
 *  sancai 族=段A 档 900s(单值口径——编排器段B 用 resolveSancaiStageTimeoutS)。
 *  前端轮询 pollTimeoutMs=timeoutS×1000+30s 既有公式自动随宽。 */
export function resolveH3ShotTimeoutS(recipeId: string, seconds: number, tier: H3ResolutionTier = "960p"): number {
  const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === recipeId);
  if (!recipe) {
    throw new Error(`未知 H3 工作流配方:${recipeId}(注册表在册:${H3_WORKFLOW_RECIPES.map((item) => item.id).join(" / ")})`);
  }
  if (recipe.inputMode === "multiseg") {
    return Math.min(MULTISEG_TIMEOUT_CAP_S, MULTISEG_TIMEOUT_BASE_S + Math.ceil(seconds) * MULTISEG_TIMEOUT_PER_SECOND_S);
  }
  if (recipe.inputMode === "sancai-r2v" || recipe.inputMode === "sancai-i2v") {
    return SANCAI_STAGE_A_TIMEOUT_S;
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

/** 三采线参考槽(1113 火力扩展):110-113+341-344 = ref_image_1..8 → <Picture 2..9>;
 * 引擎 MiniMaxH3ReferenceToVideo.ref_images AUTOGROW max=9(ref_image_0..8,0=分镜帧)。
 * pika 线模板无 341+,仍用 REF_IMAGE_NODE_IDS(4 槽祖传口径)。 */
const SANCAI_REF_IDS = [110, 111, 112, 113, 341, 342, 343, 344] as const;

export function buildShotH3RefWorkflow(input: ShotH3RefWorkflowInput): ShotH3WorkflowResult {
  return buildShotRefWorkflowFromTemplate(templateRefJson, input);
}

/** 画布档 R2V 组装真身(1101 pika-ref2va-mainline 参数化,对齐 buildShotWorkflowFromTemplate
 *  先例):buildShotH3RefWorkflow 保留为 Mac 自研档旧模板薄壳=旧行为零变;Pika ref2va API
 *  组装器走同真身但母体=pika-ref-shot-template.json(Pika 官方契约档,两母体锚点契约同构:
 *  16 号 MiniMaxH3ReferenceToVideo + 9/110-113 参考槽 + 14/20/4/100 锚)。 */
function buildShotRefWorkflowFromTemplate(source: H3WorkflowTemplate, input: ShotH3RefWorkflowInput, refIds: readonly number[] = REF_IMAGE_NODE_IDS): ShotH3WorkflowResult {
  const template = JSON.parse(JSON.stringify(source)) as H3WorkflowTemplate;
  assertH3TemplateIntegrity(template);
  connectVideoWriteback(template);
  getNode(template, 16, "MiniMaxH3ReferenceToVideo");
  const policy = input.policy ?? "ambient";
  const shot = input.shot;
  const semantics = shot.shotSemantics as ShotSemanticsForH3;
  const description = shot.videoDesc.trim() || shot.prompt.trim();
  const durationSec = shot.durationTarget ?? shot.duration;
  const refs = input.refs.slice(0, refIds.length);
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
  refIds.forEach((nodeId, position) => {
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

// ── Pika ref2va API 档(1101 pika-ref2va-mainline;my-pika-ref2v-20 专用组装器)─────────────────────

/** Pika ref2va API 档输入:画布档输入 + 首帧 b64 + 分辨率档 + 参考资产(≤4,按序占
 *  ref_image_1..4=Picture 2..5;分镜帧恒占 ref_image_0=Picture 1)。refs 按名引用——
 *  资产上传由宿主批量器负责(引擎 input 须已有同名文件),本组装器只带首帧 b64 走 images 通道。 */
export interface ShotH3RefApiWorkflowInput extends ShotH3ApiWorkflowInput {
  refs: ShotH3RefAssetInput[];
}

/** Pika ref2va API 档组装器(仿 buildShotH3ApiWorkflow「一份组装产两形态」范式):
 *  ① UI 克隆组装(六段式提示词 buildShotH3RefPrompt + 文案逐字自检门 + refs 激活
 *  110-113 + MyShot properties 三键)——母体=pika-ref-shot-template.json(Pika 官方契约档,
 *  与 Mac 自研 templateRefJson 同锚点骨架但模型链=ref2va int8 底模+Pika LoRA 契约);
 *  ② 读值直填 apiGraph(锚=object_info 实锚:14.value/20.value/9.image/4.filename_prefix/
 *  16.width+height 档位直填),两形态逐字一致;
 *  ③ 16 号 class 断言 MiniMaxH3ReferenceToVideo(与 i2v 族分叉点:输入键=
 *  ref_images.ref_image_N,无 first_frame 口);
 *  ④ 1101 直投禁令:API 图出厂不含 MyShot/占位节点(直投无 extraPngInfo)——110-113
 *  参考槽按 refs 实数动态注入 LoadImage 节点+挂 ref_images.ref_image_1..4,未用槽
 *  保持缺省(占位名禁进 API 图直投炸引擎);回收走五段前缀+execute result 回流,
 *  画布档保留 100 MyShot 写回。 */
export function buildShotH3RefApiWorkflow(input: ShotH3RefApiWorkflowInput): ShotH3ApiWorkflowResult {
  const refs = input.refs.slice(0, REF_IMAGE_NODE_IDS.length);
  const base = buildShotRefWorkflowFromTemplate(pikaRefTemplateJson as unknown as H3WorkflowTemplate, { ...input, refs });
  const nodes = base.ui.nodes as WorkflowNode[];
  const widget = (id: number, type: string): unknown => {
    const node = getNode({ nodes } as H3WorkflowTemplate, id, type);
    if (!Array.isArray(node.widgets_values)) throw new Error(`pika-ref-shot-template drift: node ${id} widgets_values missing`);
    return node.widgets_values[0];
  };

  const apiGraph = JSON.parse(JSON.stringify(pikaRefApiTemplateJson)) as ApiGraph;
  getApiNode(apiGraph, "14", "PrimitiveStringMultiline").inputs.value = widget(14, "PrimitiveStringMultiline");
  getApiNode(apiGraph, "20", "PrimitiveFloat").inputs.value = widget(20, "PrimitiveFloat");
  getApiNode(apiGraph, "4", "SaveVideo").inputs.filename_prefix = widget(4, "SaveVideo");
  getApiNode(apiGraph, "9", "LoadImage").inputs.image = widget(9, "LoadImage");
  const generator = getApiNode(apiGraph, "16", "MiniMaxH3ReferenceToVideo");
  const tier = input.resolutionTier ?? "480p"; // Pika 契约档出厂 480p(未实弹禁上 960p 档)
  const [width, height] = H3_RESOLUTION_TIERS[tier];
  generator.inputs.width = width;
  generator.inputs.height = height;
  // refs 按序动态注入 110-113(直投禁令:占位槽不进 API 图;未用槽保持缺省)
  REF_IMAGE_NODE_IDS.forEach((nodeId, position) => {
    const ref = refs[position];
    if (!ref) return;
    apiGraph[String(nodeId)] = { class_type: "LoadImage", inputs: { image: ref.imageName } };
    generator.inputs[`ref_images.ref_image_${position + 1}`] = [String(nodeId), 0];
  });

  const images = input.firstFrameB64 ? [{ key: "9.image", name: String(widget(9, "LoadImage")), b64: input.firstFrameB64 }] : [];
  return { apiGraph, uiWorkflow: base.ui, images, report: base.report };
}

// ── 三采两段档(1112 recavsr-mainline;Note103 运行法则:拆链+/free/独立一发)──────────────────────

/** AR 阶梯(Note103 法则②:一采~0.52MP/二采~1.2MP 按输入图 AR 开方、全 32 对齐;
 *  判例 16:9=960×544→1440×832、1:1=736²→1088²、竖图镜像;改 16/220/208/206 四处)。
 *  对齐口径=引擎 ResolutionSelector 同款 round(nodes_resolution.py execute:
 *  round(w_ratio*scale/multiple)*multiple);二采档 AR 从一采已对齐值再推
 *  (960/544→1440×832 判例口径——用原始 16:9 直推会得 1472×832 偏一档)。 */
export interface SancaiResolutionLadder {
  /** 一采档宽(16/220 注入) */
  w1: number;
  /** 一采档高 */
  h1: number;
  /** 二采档宽(208/206 注入) */
  w2: number;
  /** 二采档高 */
  h2: number;
}

const SANCAI_STAGE1_PIXELS = 520_000;
const SANCAI_STAGE2_PIXELS = 1_200_000;

export function computeSancaiResolutionLadder(width: number, height: number): SancaiResolutionLadder {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("三采 AR 阶梯需要有效的首帧像素宽高(W×H 均须为正数)");
  }
  const align32 = (value: number) => Math.round(value / 32) * 32;
  const ar = width / height;
  const w1 = align32(Math.sqrt(SANCAI_STAGE1_PIXELS * ar));
  const h1 = align32(Math.sqrt(SANCAI_STAGE1_PIXELS / ar));
  const ar2 = w1 / h1;
  const w2 = align32(Math.sqrt(SANCAI_STAGE2_PIXELS * ar2));
  const h2 = align32(Math.sqrt(SANCAI_STAGE2_PIXELS / ar2));
  return { w1, h1, w2, h2 };
}

/** 段A(一二采)节点集=59 塑形图全链减三采链(Win 实弹 ar10s_stage12 同款 56 节点)。 */
const SANCAI_STAGE_B_NODE_IDS = ["338", "339", "340"] as const;

/** 三采 API 档输入:画布档输入 + 两段档扩展(r2v 臂选择/refs/首帧像素——AR 阶梯源)。 */
export interface ShotH3SancaiApiWorkflowInput extends ShotH3ApiWorkflowInput {
  /** true=r2v 多参考臂(219=false→16 号 MiniMaxH3ReferenceToVideo,提示词六段式);
   *  false=i2v 首帧锚定臂(219=true→220 号,Win 实弹 ar10s 同款;注意 219 语义
   *  以 wire 为准:ComfySwitchNode switch?on_true:on_false,on_true=220)。缺省 true。 */
  r2v?: boolean;
  /** 参考资产(r2v 臂;≤8 按序占 110-113/341-344=ref_image_1..8=<Picture 2..9,
   * 1113 火力满配,引擎 AUTOGROW max=9;按名引用,资产上传归宿主) */
  refs?: ShotH3RefAssetInput[];
  /** i2v 尾帧资产名(可选;[345]→220.last_frame 首尾双锚 FL2VA 语义,
   *  提示词须描述首→尾连续路径;缺省=API 图摘 345 与 last_frame 槽零空喂) */
  endFrame?: string;
  /** 参考视频文件名(可选;r2v 臂 [346]→16.ref_videos.ref_video_0=<Video 1>,
   *  动作/风格参考;引擎约束 24fps、2-15s;缺省=API 图摘 346 与该槽零空喂) */
  videoRef?: string;
  /** 首帧像素宽(AR 阶梯推导源;parseImageSizeFromB64 可解) */
  frameWidth: number;
  /** 首帧像素高 */
  frameHeight: number;
}

/** 三采两段档组装结果:apiGraph=段A(一二采),stageBGraph=段B(三采)。 */
export interface ShotH3SancaiApiWorkflowResult extends ShotH3ApiWorkflowResult {
  /** 段B(三采)API 图:300 LoadVideo 的 file 出厂为空串,编排器在段A complete
   *  后用 applySancaiStageBSource 回填终档注解名(零拷贝 [output] 通道)。 */
  stageBGraph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
}

/** 段A 终档产物 → 引擎注解名(零拷贝通道:folder_paths.annotated_filepath 原生认
 *  「<subfolder>/<filename> [output]」,LoadVideo 直读输出目录,不经上传不落 input)。 */
/** b64 首帧 → 像素宽高(三采 AR 阶梯推导源;纯函数单测覆盖)。
 *  PNG=固定偏移 IHDR(16-23 字节);JPEG=扫 SOF0/1/2/… 帧 marker(高在先宽在后)。
 *  其余格式/损坏流 → null(调用方拒派发,禁猜尺寸)。 */
export function parseImageSizeFromB64(b64: string): { width: number; height: number } | null {
  const clean = b64.replace(/^data:[^,]*,/, "").replace(/[\r\n]/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const readUInt32BE = (offset: number) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  const readUInt16BE = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
  // PNG:89 50 4E 47 + IHDR(宽高各 4 字节大端,偏移 16/20)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = readUInt32BE(16);
    const height = readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  // JPEG:FF D8,逐段扫 SOF marker(C0-CF 除 C4/C8/CC)
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = readUInt16BE(offset + 5);
        const width = readUInt16BE(offset + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      offset += 2 + length;
    }
  }
  return null;
}

export function sancaiAnnotatedVideoRef(video: { filename: string; subfolder?: string }): string {
  const sub = (video.subfolder ?? "").replace(/\/+$/, "");
  return sub ? `${sub}/${video.filename} [output]` : `${video.filename} [output]`;
}

/** 段B 视频源回填(编排器专用:段A result.videos 里 nodeId=4 的终档条目)。 */
export function applySancaiStageBSource(
  stageBGraph: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
  video: { filename: string; subfolder?: string },
): void {
  getApiNode(stageBGraph, "300", "LoadVideo").inputs.file = sancaiAnnotatedVideoRef(video);
}

/** 画布档三采薄壳(1112 模板换血登记:母体=h3-three-stage-template.json=repo 主线件
 *  原样拷贝语义;画布直开链按 recipe 分派到本壳——旧行为走 buildShotH3Workflow 零变)。 */
export function buildShotH3ThreeStageWorkflow(
  input: ShotH3WorkflowInput & { r2v?: boolean; refs?: ShotH3RefAssetInput[] },
): ShotH3WorkflowResult {
  return input.r2v === false
    ? buildShotWorkflowFromTemplate(sancaiTemplateJson as unknown as H3WorkflowTemplate, input)
    : buildShotRefWorkflowFromTemplate(sancaiTemplateJson as unknown as H3WorkflowTemplate, { ...input, refs: input.refs ?? [] });
}

/** 三采 API 档组装器(1112 recavsr-mainline 真身;r2v/i2v 共用):
 *  ① 提示词链复用既有真身(r2v=buildShotRefWorkflowFromTemplate 六段式 /
 *  i2v=buildShotWorkflowFromTemplate,内含文案逐字自检门+MyShot properties 三键
 *  +connectVideoWriteback;旧断言集对新母体天然兼容——4/9/14/20/100/101 全在场);
 *  ② 段A=59 塑形图克隆 − 三采链(Win 实弹 56 节点同款),锚注入(14/20/9/4/204/
 *  110-113/219)+AR 阶梯直填 16/220/208/206(覆盖 22 号 link,22 删除=按需旁路);
 *  ③ 段B=300 LoadVideo(file 待编排器回填)+338/339/340 克隆(339.video 改接 300)
 *  +MyShot 100 连 340(终档落账:五段前缀+extraPngInfo 复用段A uiWorkflow——
 *  MyShot.run 只读 API 图连线与 pnginfo 里的 properties,UI 图连线不参与);
 *  ④ images 通道只带首帧 b64(110-113 按名引用;i2v 臂以分镜帧补位满槽——208
 *  二采恒消费 ref_image_1..4,占位名禁进 API 图直投)。 */
export function buildShotH3SancaiApiWorkflow(input: ShotH3SancaiApiWorkflowInput): ShotH3SancaiApiWorkflowResult {
  const r2v = input.r2v ?? true;
  const refs = (input.refs ?? []).slice(0, SANCAI_REF_IDS.length);
  const ladder = computeSancaiResolutionLadder(input.frameWidth, input.frameHeight);

  // ① 画布档同源组装(提示词+自检门+MyShot 三键+9/110-113/341-344 激活,1113 火力满配 8 槽)
  const base = r2v
    ? buildShotRefWorkflowFromTemplate(sancaiTemplateJson as unknown as H3WorkflowTemplate, { ...input, refs }, SANCAI_REF_IDS)
    : buildShotWorkflowFromTemplate(sancaiTemplateJson as unknown as H3WorkflowTemplate, input);
  const nodes = base.ui.nodes as WorkflowNode[];
  const widgetOf = (id: number, type: string): unknown => {
    const node = getNode({ nodes } as H3WorkflowTemplate, id, type);
    if (!Array.isArray(node.widgets_values)) throw new Error(`h3-three-stage-template drift: node ${id} widgets_values missing`);
    return node.widgets_values[0];
  };

  const apiGraph = JSON.parse(JSON.stringify(sancaiApiTemplateJson)) as ApiGraph;
  const promptText = widgetOf(14, "PrimitiveStringMultiline");
  const seconds = widgetOf(20, "PrimitiveFloat");
  const imageName = String(widgetOf(9, "LoadImage"));
  const myShotWidgets = (nodes.find((node) => node.id === 100) as WorkflowNode | undefined)?.widgets_values;
  if (!Array.isArray(myShotWidgets) || myShotWidgets.length < 4) throw new Error("h3-three-stage-template drift: node 100 widgets_values missing");
  const [shotId, label, description, mediaStatus] = myShotWidgets;

  // ② 段A 注入(锚=object_info 实锚;前缀口径=同源真身已注入的 4 号五段前缀
  // ——r2v 臂 ref-{policy}/i2v 臂 {policy},与既有单段线完全同构;204={prefix}-p1
  // 一采预览;段B 340=同 prefix 终档落账,subfolder 恒四段过 consumer 白名单)
  const prefix = String(widgetOf(4, "SaveVideo"));
  for (const id of SANCAI_STAGE_B_NODE_IDS) {
    if (!apiGraph[id]) throw new Error(`h3-three-stage-template.api.json drift: node ${id} missing`);
    delete apiGraph[id];
  }
  getApiNode(apiGraph, "14", "PrimitiveStringMultiline").inputs.value = promptText;
  getApiNode(apiGraph, "20", "PrimitiveFloat").inputs.value = seconds;
  getApiNode(apiGraph, "4", "SaveVideo").inputs.filename_prefix = prefix;
  getApiNode(apiGraph, "204", "SaveVideo").inputs.filename_prefix = `${prefix}-p1`;
  getApiNode(apiGraph, "9", "LoadImage").inputs.image = imageName;
  // 219 布尔置位(wire 真相:true→on_true=220 i2v 臂;false→on_false=16 r2v 臂)
  getApiNode(apiGraph, "219", "PrimitiveBoolean").inputs.value = !r2v;
  // AR 阶梯直填(Note103 法则②四处;覆盖 22 号 link 后删除 22=按需旁路)
  const stage1 = getApiNode(apiGraph, "16", "MiniMaxH3ReferenceToVideo");
  stage1.inputs.width = ladder.w1;
  stage1.inputs.height = ladder.h1;
  const stage1I2v = getApiNode(apiGraph, "220", "MiniMaxH3ImageToVideo");
  stage1I2v.inputs.width = ladder.w1;
  stage1I2v.inputs.height = ladder.h1;
  const stage2 = getApiNode(apiGraph, "208", "MiniMaxH3ReferenceToVideo");
  stage2.inputs.width = ladder.w2;
  stage2.inputs.height = ladder.h2;
  const upscaler = getApiNode(apiGraph, "206", "MinimaxH3LatentUpscaler3D");
  upscaler.inputs["mode.width"] = ladder.w2;
  upscaler.inputs["mode.height"] = ladder.h2;
  delete apiGraph["22"];
  // 110-113/341-344 满槽注入(208 二采恒消费全部图槽;r2v=refs 按序+分镜帧补位,
  // i2v=分镜帧补位——Win 实弹同图多槽先例;占位名禁进 API 图直投;1113 火力 8 槽)
  SANCAI_REF_IDS.forEach((nodeId, position) => {
    const ref = refs[position];
    const name = r2v && ref ? ref.imageName : imageName;
    getApiNode(apiGraph, String(nodeId), "LoadImage").inputs.image = name;
  });
  // ④ 尾帧(i2v 首尾双锚;缺省摘 345+220.last_frame,禁空喂占位)
  if (input.endFrame) {
    getApiNode(apiGraph, "345", "LoadImage").inputs.image = input.endFrame;
  } else {
    delete apiGraph["345"];
    delete getApiNode(apiGraph, "220", "MiniMaxH3ImageToVideo").inputs.last_frame;
  }
  // ⑤ 参考视频(r2v <Video 1>;缺省摘 346+16.ref_videos 槽,禁空喂占位)
  if (input.videoRef) {
    getApiNode(apiGraph, "346", "LoadVideo").inputs.file = input.videoRef;
  } else {
    delete apiGraph["346"];
    delete apiGraph["347"]; // GetVideoComponents 桥(LoadVideo吐VIDEO,槽吃IMAGE帧)
    delete getApiNode(apiGraph, "16", "MiniMaxH3ReferenceToVideo").inputs["ref_videos.ref_video_0"];
  }

  // ③ 段B 构造(300 LoadVideo + 338/339/340 克隆 + MyShot 100 连 340)
  const stageBGraph = JSON.parse(JSON.stringify(sancaiApiTemplateJson)) as ApiGraph;
  for (const id of Object.keys(stageBGraph)) {
    if (!SANCAI_STAGE_B_NODE_IDS.includes(id as (typeof SANCAI_STAGE_B_NODE_IDS)[number])) delete stageBGraph[id];
  }
  stageBGraph["300"] = { class_type: "LoadVideo", inputs: { file: "" } };
  const loader = getApiNode(stageBGraph, "338", "ReCaVSRLoader");
  const upscale = getApiNode(stageBGraph, "339", "ReCaVSRUpscale");
  const saveVideoB = getApiNode(stageBGraph, "340", "SaveVideo");
  loader.inputs.transformer = loader.inputs.transformer ?? "transformer_int8_convrot.safetensors";
  upscale.inputs.model = ["338", 0];
  upscale.inputs.video = ["300", 0];
  saveVideoB.inputs.video = ["339", 0];
  saveVideoB.inputs.filename_prefix = prefix;
  stageBGraph["100"] = {
    class_type: "MyShot",
    inputs: { shot_id: shotId, label, description, media_status: mediaStatus, video: ["340", 0] },
  };

  const images = input.firstFrameB64 ? [{ key: "9.image", name: imageName, b64: input.firstFrameB64 }] : [];
  return { apiGraph, uiWorkflow: base.ui, images, stageBGraph, report: base.report };
}
