// 09-14 晚间用户裁定(research/0914-late-rulings.md):超分不进工作流——
// 单段直出模板(h3-shot-template,31 节点,无 LatentUpscaler/LTXV,仅节点 9 首帧槽;1004 深夜用户裁定去 MY- 前缀改名)
import templateJson from "./h3-shot-template.json";
import apiTemplateJson from "./h3-shot-template.api.json";
import templateRefJson from "./h3-shot-template-ref2va.json";
import type { StoryboardItem } from "@/types/studio";
import { buildShotH3Prompt, buildShotH3RefPrompt, extractPlannedDialogueTexts, verifyPlannedTextVerbatim, type H3AudioPolicy } from "./h3-shot-prompt";
import type { H3ResolutionTier } from "./h3-workflow-recipes";

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

function cloneTemplate(): H3WorkflowTemplate {
  return JSON.parse(JSON.stringify(templateJson)) as H3WorkflowTemplate;
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
  const template = cloneTemplate();
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

/** API 档输入(§5.2 C3):画布档输入 + 首帧 b64(走 execute images 通道上传)+ 分辨率档。 */
export interface ShotH3ApiWorkflowInput extends ShotH3WorkflowInput {
  /** 首帧图 base64(execute images 通道后端代上传);缺省=9 节点只填派生名不带上传(引擎 input 须已有同名文件)。 */
  firstFrameB64?: string;
  /** 分辨率档(D5 批量默认 960P 生产);960p=1344×768、480p=608×352(N11)。 */
  resolutionTier?: H3ResolutionTier;
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
 *  提示词链与画布档完全同源——先跑 buildShotH3Workflow(内含 buildShotH3Prompt+文案逐字自检门
 *  +dialogueAudioPolicy+voiceMood+MyShot properties 三键),再从同源 UI 图读值直填 apiGraph,
 *  两形态逐字一致;自检门失败时大白话错误在此抛出。 */
export function buildShotH3ApiWorkflow(input: ShotH3ApiWorkflowInput): ShotH3ApiWorkflowResult {
  const tier = input.resolutionTier ?? "960p";
  const base = buildShotH3Workflow(input);
  const nodes = base.ui.nodes as WorkflowNode[];
  const widgets = (id: number, type: string): unknown[] => {
    const node = getNode({ nodes } as H3WorkflowTemplate, id, type);
    if (!Array.isArray(node.widgets_values)) throw new Error(`h3-shot-template drift: node ${id} widgets_values missing`);
    return node.widgets_values;
  };
  const widget = (id: number, type: string): unknown => widgets(id, type)[0];

  const apiGraph = JSON.parse(JSON.stringify(apiTemplateJson)) as ApiGraph;
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
