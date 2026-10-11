import { isNarratorSpeaker, normalizeTtsSpokenText } from "@/lib/studio/chapter-voiceover";

export type H3AudioPolicy = "ambient" | "full" | "bare";

export interface H3PromptInput {
  videoDesc: string;
  action?: string;
  cameraMove?: string;
  shotSize?: string;
  lines?: string;
  /** D1 音色锚(10-11 音频分工):full 政策 says 行渲染为
   * "says in a ${voiceMood} tone";缺省省略(=现状无锚)。dispatch 直通
   * storyboard.emotion;实弹证明 H3 无视音色指令即撤(无害试错)。 */
  voiceMood?: string;
  sound?: string;
  durationSec: number;
}

export interface H3PromptResult {
  prompt: string;
  seconds: number;
  lengthFrames: number;
}

/** 文案逐字自检门(docs/comfyui-kb/参考_文案逐字自检门.md §一)结果:
 * ok=全部在场;missing=缺席的计划文案(trim 后原文,供大白话错误指名)。 */
export interface PlannedTextVerbatimResult {
  ok: boolean;
  missing: string[];
}

/** 文案逐字自检门:派发前把「计划文案清单」逐条与最终 prompt 比对——
 * 每条必须作为**连续子串一字不差**(含标点)在场;查询集=计划清单,
 * 不以 prompt 反推;空清单/空白清单=ok(无文案镜不拦);不做宽松匹配。
 * 纯函数,不抛错,阻断决策由派发点按 missing 做。 */
export function verifyPlannedTextVerbatim(prompt: string, plannedTexts: string[]): PlannedTextVerbatimResult {
  const missing = (plannedTexts ?? [])
    .map((text) => (text ?? "").trim())
    .filter(Boolean)
    .filter((text) => !prompt.includes(text));
  return { ok: missing.length === 0, missing };
}

/** 台词行(10-11 音频分工统一判定源拆行)。 */
export interface DialogueLine {
  speaker: string;
  text: string;
}

/** 统一旁白判定源拆行:台词列 lines 是唯一真源,角色/旁白归属在此单点裁决
 * (design.md 技术设计二)。口径=chapter-voiceover 宽集(旁白/vo/画外音/解说)
 * + 无冒号整行=旁白;角色行=有冒号且说话人非旁白标签。 */
export function splitDialogueLines(lines?: string): {
  character: DialogueLine[];
  narrator: DialogueLine[];
} {
  const character: DialogueLine[] = [];
  const narrator: DialogueLine[] = [];
  for (const line of parseDialogueLines(lines)) {
    if (line.narrator) narrator.push({ speaker: line.speaker, text: line.text });
    else character.push({ speaker: line.speaker, text: line.text });
  }
  return { character, narrator };
}

/** 逐镜音频政策(10-11 音频分工 R3a):有角色行→"full"(台词烧镜内+口型),
 * 否则"ambient"(音效床,lips stay closed)。纯函数,dispatch 逐镜注入。 */
export function dialogueAudioPolicy(lines?: string): "full" | "ambient" {
  return splitDialogueLines(lines).character.length > 0 ? "full" : "ambient";
}

/** 外挂 TTS 合成文本(派生不存储,R3b):full 镜=旁白行正文按
 * normalizeTtsSpokenText 同规整拼接(纯对白镜=空串=零外挂音频);
 * 非 full 镜=原样返回 fullSpokenText(ttsSpokenText 恒全文,三消费面零波及)。 */
export function externalNarratorSpokenText(lines: string | undefined, fullSpokenText: string): string {
  const split = splitDialogueLines(lines);
  if (split.character.length === 0) return fullSpokenText;
  return normalizeTtsSpokenText(split.narrator.map((line) => line.text).join("\n"));
}

/** 计划文案清单来源(台词列):与 renderDialogue 同一解析(单一解析源,
 * 防清单与注入的传导断点)——只取角色行正文(10-11 口径:full 政策 prompt
 * 只注角色行,旁白行归外挂 TTS 不入清单);屏幕可见文字字段将来入模型时
 * 同权追加进清单。 */
export function extractPlannedDialogueTexts(lines?: string): string[] {
  return splitDialogueLines(lines).character.map((line) => line.text);
}

const FIXED_I2V_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

export function snapH3LengthFrames(durationSec: number): number {
  const safeDuration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const rawFrames = Math.ceil(safeDuration * 24);
  const snapped = 17 * Math.ceil(Math.max(0, rawFrames - 5) / 17) + 5;
  return Math.min(362, Math.max(124, snapped));
}

export function mapH3CameraMove(value?: string): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  if (/push\s*in|pull\s*out|pan\s+(left|right)|truck(?:\s+(left|right))?|tracking\s+shot|pedestal\s+(up|down)|tilt\s+(up|down)|arc\s+shot|zoom\s+(in|out)/i.test(raw)) return raw;
  if (/变焦/.test(raw)) return /拉远|出/.test(raw) ? "Zoom Out" : "Zoom In";
  if (/推|推进/.test(raw)) return "Push In";
  if (/拉|拉远/.test(raw)) return "Pull Out";
  if (/摇/.test(raw)) return /左/.test(raw) ? "Pan Left" : /右/.test(raw) ? "Pan Right" : "Pan";
  if (/横移|移/.test(raw)) return /左/.test(raw) ? "Truck Left" : /右/.test(raw) ? "Truck Right" : "Truck";
  if (/跟拍|跟/.test(raw)) return "Tracking Shot";
  if (/升/.test(raw)) return "Pedestal Up";
  if (/降/.test(raw)) return "Pedestal Down";
  if (/俯/.test(raw)) return "Tilt Down";
  if (/仰/.test(raw)) return "Tilt Up";
  if (/环绕|弧/.test(raw)) return "Arc Shot";
  return raw;
}

function parseDialogueLines(lines?: string): Array<{ speaker: string; text: string; narrator: boolean }> {
  return (lines ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([^：:]+)[：:](.+)$/.exec(line);
      if (!match) return { speaker: "", text: line, narrator: true };
      const speaker = match[1].trim();
      // 10-11 统一判定源:无冒号整行=旁白 + 旁白标签宽集(旁白/vo/画外音/解说),
      // 与 chapter-voiceover.isNarratorSpeaker 同口径。
      return { speaker, text: match[2].trim(), narrator: speaker === "" || isNarratorSpeaker(speaker) };
    });
}

function renderDialogue(lines: string | undefined, seconds: number, voiceMood?: string): string {
  // 10-11 音频分工:full 政策只注角色行(旁白归外挂 TTS,不进 prompt)。
  const character = splitDialogueLines(lines).character;
  if (character.length === 0) return "";
  const speakerIds = new Map<string, number>();
  let nextSpeakerId = 1;
  const mood = voiceMood?.trim();
  const rendered = character.map((line) => {
    const key = line.speaker || `S${nextSpeakerId}`;
    if (!speakerIds.has(key)) speakerIds.set(key, nextSpeakerId++);
    const speakerId = speakerIds.get(key)!;
    const speaker = line.speaker || "The speaker";
    const moodAnchor = mood ? ` in a ${mood} tone` : "";
    return `${speaker} (S${speakerId}) says${moodAnchor}: <d>[Chinese] ${line.text}</d>`;
  });
  const eventSeconds = Math.max(0, Math.ceil(seconds * 0.4));
  return `${rendered.join(" ")} At 00:${String(eventSeconds).padStart(2, "0")}.000.`;
}

function formatDescription(input: H3PromptInput, policy: H3AudioPolicy, seconds: number): string {
  const parts = [input.shotSize?.trim(), input.videoDesc.trim(), input.action?.trim()].filter(Boolean);
  const camera = mapH3CameraMove(input.cameraMove);
  if (camera) parts.push(`The camera uses a ${camera}.`);
  const dialogue = policy === "full" ? renderDialogue(input.lines, seconds, input.voiceMood) : "";
  if (dialogue) parts.push(dialogue);
  else parts.push("No dialogue in this clip; the characters' lips stay closed.");
  parts.push(`At 00:${String(Math.max(0, Math.ceil(seconds * 0.4))).padStart(2, "0")}.000, the described action is visible.`);
  return parts.join(" ");
}

export function buildShotH3Prompt(input: H3PromptInput, policy: H3AudioPolicy = "ambient"): H3PromptResult {
  const resolvedPolicy: H3AudioPolicy = policy === "full" || policy === "bare" ? policy : "ambient";
  const lengthFrames = snapH3LengthFrames(input.durationSec);
  const seconds = lengthFrames / 24;
  const soundscape = resolvedPolicy === "bare"
    ? "Minimal ambient sound only."
    : input.sound?.trim() || "Quiet ambience matching the scene.";
  const description = formatDescription(input, resolvedPolicy, seconds);
  const prompt = [
    FIXED_I2V_LINE,
    "",
    `integrated_multimodal_description: [Shot 1] ${description}`,
    "",
    `overall_soundscape: ${soundscape}`,
    "",
    "non_diegetic_music: None.",
  ].join("\n");
  return { prompt, seconds, lengthFrames };
}

export interface H3RefSubject {
  name: string;
  /** 定妆照在参考槽中的 <Picture> 序号(1 基)。 */
  pictureIndex: number;
}

export interface H3RefPromptInput extends H3PromptInput {
  /** 分镜图在参考槽中的 <Picture> 序号(1 基,默认 1)。 */
  storyboardPictureIndex?: number;
  /** 出镜角色(外观绑定定妆照);纯场景/道具不建 Subject。 */
  characters?: H3RefSubject[];
  /** 场景参考图(环境保持)。 */
  scene?: { name: string; pictureIndex: number };
}

/** Ref2VA 六节结构(字段名/顺序逐字对齐官方 ref 指南,
 * .agents/skills/h3-prompt-writing/references/ref-en.txt)。 */
export function buildShotH3RefPrompt(input: H3RefPromptInput, policy: H3AudioPolicy = "ambient"): H3PromptResult {
  const resolvedPolicy: H3AudioPolicy = policy === "full" || policy === "bare" ? policy : "ambient";
  const lengthFrames = snapH3LengthFrames(input.durationSec);
  const seconds = lengthFrames / 24;
  const storyboardIndex = input.storyboardPictureIndex ?? 1;
  const characters = (input.characters ?? []).filter((item) => item.name.trim() && item.pictureIndex > 0);
  const subjectDefinitions = characters.length > 0
    ? `subject_definitions: ${characters
        .map((item) => `<Subject ${characters.indexOf(item) + 1}> is ${item.name.trim()}, whose appearance comes from <Picture ${item.pictureIndex}>.`)
        .join(" ")}`
    : "subject_definitions: <Subject 1> is the main character, whose appearance follows the storyboard frame.";
  const summary = `summary: Ref2VA task: a ${seconds}-second 16:9 animated clip in Chinese cinematic style. The storyboard frame <Picture ${storyboardIndex}> sets the composition and starting state; reference pictures carry identity and environment.`;
  const retentionParts = [
    `<Picture ${storyboardIndex}> (storyboard frame) is fully referenced for composition and framing`,
    ...characters.map((item) => `<Picture ${item.pictureIndex}> retains ${item.name.trim()}'s identity, face and outfit`),
  ];
  if (input.scene) {
    retentionParts.push(`<Picture ${input.scene.pictureIndex}> retains the ${input.scene.name.trim()} environment and lighting`);
  }
  const retention = `retention_analysis: ${retentionParts.join("; ")}.`;
  const soundscape = resolvedPolicy === "bare"
    ? "Minimal ambient sound only."
    : input.sound?.trim() || "Quiet ambience matching the scene.";
  const description = formatDescription(input, resolvedPolicy, seconds);
  const prompt = [
    subjectDefinitions,
    "",
    summary,
    "",
    retention,
    "",
    `detailed_description: [Shot 1] ${description}`,
    "",
    `overall_soundscape: ${soundscape}`,
    "",
    "non_diegetic_music: None.",
  ].join("\n");
  return { prompt, seconds, lengthFrames };
}
