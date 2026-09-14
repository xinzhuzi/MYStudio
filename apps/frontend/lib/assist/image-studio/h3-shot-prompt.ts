export type H3AudioPolicy = "ambient" | "full" | "bare";

export interface H3PromptInput {
  videoDesc: string;
  action?: string;
  cameraMove?: string;
  shotSize?: string;
  lines?: string;
  sound?: string;
  durationSec: number;
}

export interface H3PromptResult {
  prompt: string;
  seconds: number;
  lengthFrames: number;
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
      if (!match) return { speaker: "", text: line, narrator: false };
      const speaker = match[1].trim();
      return { speaker, text: match[2].trim(), narrator: speaker === "旁白" };
    });
}

function renderDialogue(lines: string | undefined, seconds: number): string {
  const parsed = parseDialogueLines(lines);
  if (parsed.length === 0) return "";
  const speakerIds = new Map<string, number>();
  let nextSpeakerId = 1;
  const rendered = parsed.map((line) => {
    const key = line.narrator ? "旁白" : line.speaker || `S${nextSpeakerId}`;
    if (!speakerIds.has(key)) speakerIds.set(key, nextSpeakerId++);
    const speakerId = speakerIds.get(key)!;
    if (line.narrator) {
      return `The narrator (S${speakerId}) says in an off-screen voiceover: <d>[Chinese] ${line.text}</d> and no lips move on screen.`;
    }
    const speaker = line.speaker || "The speaker";
    return `${speaker} (S${speakerId}) says: <d>[Chinese] ${line.text}</d>`;
  });
  const eventSeconds = Math.max(0, Math.ceil(seconds * 0.4));
  return `${rendered.join(" ")} At 00:${String(eventSeconds).padStart(2, "0")}.000.`;
}

function formatDescription(input: H3PromptInput, policy: H3AudioPolicy, seconds: number): string {
  const parts = [input.shotSize?.trim(), input.videoDesc.trim(), input.action?.trim()].filter(Boolean);
  const camera = mapH3CameraMove(input.cameraMove);
  if (camera) parts.push(`The camera uses a ${camera}.`);
  const dialogue = policy === "full" ? renderDialogue(input.lines, seconds) : "";
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
