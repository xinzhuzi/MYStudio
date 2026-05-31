import { getAgentSkillPreset } from "@/lib/studio/manuals";

/** 逐章编剧链（1 章 = 1 集）：故事骨架 → 改编策略 → 剧本 → 审核。 */
export type ScriptStageKey = "storySkeleton" | "adaptationStrategy" | "scriptDraft" | "supervisionReport";

export interface ScriptStageMessages {
  system: string;
  user: string;
}

export interface ScriptStageContext {
  /** 项目信息/画风/导演手册上下文（buildStudioManualContext 产出），对齐 ToonFlow 的项目信息注入 */
  manualContext?: string;
  chapterTitle: string;
  chapterText: string;
  eventState?: string;
  skeleton?: string;
  strategy?: string;
  scriptDraft?: string;
}

/** 各阶段对应的 skill 手册（作 system，模仿 ToonFlow）。 */
export const SCRIPT_STAGE_SKILL: Record<ScriptStageKey, string> = {
  storySkeleton: "script_execution_skeleton",
  adaptationStrategy: "script_execution_adaptation",
  scriptDraft: "script_execution_script",
  supervisionReport: "script_agent_supervision",
};

export const SCRIPT_STAGE_LABEL: Record<ScriptStageKey, string> = {
  storySkeleton: "故事骨架",
  adaptationStrategy: "改编策略",
  scriptDraft: "剧本",
  supervisionReport: "审核",
};

// 对齐 ToonFlow：输出格式要求放进 system（其 formatPrompt 即在 system）；XML 换成 JSON。
const JSON_FMT =
  '## 输出格式（最高优先级）\n只返回一个 JSON 对象：{"content":"<该阶段完整正文，可含换行的 Markdown>"}。不要输出 JSON 以外的任何字符，不要用代码围栏，不要调用任何工具/函数。';

/** 取某阶段 skill 手册全文（供 UI 展示）。 */
export function getStageSkillContent(stage: ScriptStageKey): string {
  return getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
}

/** 构建某阶段发送给 AI 的消息：skill 全文作 system，章节/上一步产出作 user。 */
export function buildStageMessages(stage: ScriptStageKey, ctx: ScriptStageContext): ScriptStageMessages {
  const skill = getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
  const system = [skill, JSON_FMT].filter(Boolean).join("\n\n---\n\n");
  const lines: string[] = [];
  if (ctx.manualContext) lines.push(ctx.manualContext);
  lines.push(`## 本集信息（1 章 = 1 集）\n章节：${ctx.chapterTitle}`);
  if (ctx.eventState) lines.push(`本章事件分析：\n${ctx.eventState}`);
  if (stage !== "storySkeleton" && ctx.skeleton) lines.push(`故事骨架：\n${ctx.skeleton}`);
  if ((stage === "scriptDraft" || stage === "supervisionReport") && ctx.strategy) {
    lines.push(`改编策略：\n${ctx.strategy}`);
  }
  if (stage === "supervisionReport" && ctx.scriptDraft) lines.push(`剧本：\n${ctx.scriptDraft}`);
  if (stage === "storySkeleton" || stage === "scriptDraft") lines.push(`本章正文：\n${ctx.chapterText}`);
  lines.push(`请基于以上信息完成「${SCRIPT_STAGE_LABEL[stage]}」，并按输出格式返回。`);
  return { system, user: lines.join("\n\n") };
}

/** 解析阶段输出：取 JSON 的 content；非法/无 JSON 时回退去围栏的原文。 */
export function parseStageJson(output: string): string {
  const cleaned = output.replace(/```json/gi, "").replace(/```/g, "").trim();
  const candidates = [cleaned];
  const braced = cleaned.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate) as unknown;
      if (obj && typeof obj === "object" && typeof (obj as { content?: unknown }).content === "string") {
        return (obj as { content: string }).content.trim();
      }
    } catch {
      // try next candidate
    }
  }
  return cleaned;
}

/**
 * 流式中从「残缺 JSON」精确增量提取 content 值（用于实时渲染）。
 * - 处理 JSON 转义（\n \t \r \" \\ \/ \b \f \uXXXX）；
 * - 末尾悬挂的不完整转义（如末尾单个反斜杠、不完整 \u）丢弃，避免渲染出错；
 * - 尚未出现 content 值时返回空串；非 JSON（模型直接返回正文）则原样返回。
 */
export function extractPartialContent(raw: string): string {
  const keyIdx = raw.indexOf('"content"');
  if (keyIdx === -1) {
    const t = raw.replace(/```json/gi, "").replace(/```/g, "").trimStart();
    return t.startsWith("{") ? "" : raw;
  }
  let i = raw.indexOf('"', keyIdx + 9);
  if (i === -1) return "";
  i += 1;
  let out = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') break;
    if (c === "\\") {
      const next = raw[i + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        break;
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f" };
      out += map[next] ?? next;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
