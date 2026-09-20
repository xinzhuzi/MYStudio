// 09-14 晚间用户裁定(research/0914-late-rulings.md):超分不进工作流——
// 单段直出模板(MY-h3-shot-template,31 节点,无 LatentUpscaler/LTXV,仅节点 9 首帧槽)
import templateJson from "./MY-h3-shot-template.json";
import templateRefJson from "./MY-h3-shot-template_ref2va.json";
import type { StoryboardItem } from "@/types/studio";
import { buildShotH3Prompt, buildShotH3RefPrompt, type H3AudioPolicy } from "./h3-shot-prompt";

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
  }, policy);
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
  }, policy);
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
