import { getAgentSkillPreset } from "@/lib/studio/manuals";
import type { AgentWorkKey } from "@/types/studio";

/** 逐章编剧链（1 章 = 1 集，B+ 单次生成）：剧本(含规划) → 审核。 */
export type ScriptStageKey = "scriptDraft" | "supervisionReport";

export interface ScriptStageMessages {
  system: string;
  user: string;
}

export interface ScriptStageContext {
  /** 项目信息/画风/导演手册上下文（buildStudioManualContext 产出），对齐 ToonFlow 的项目信息注入 */
  manualContext?: string;
  /** 导演手册正文（色调/镜头/情绪/构图指导），剧本阶段注入，对齐 ToonFlow read_skill_file */
  directorContext?: string;
  chapterTitle: string;
  chapterText: string;
  eventState?: string;
  eventMemoryContext?: string;
  /** 本章既有剧本：供本章判定（有定稿=零方法文档注入）与审核主体使用 */
  scriptDraft?: string;
  /** 上一集（前一章）剧本：剧本阶段衔接剧情与角色状态用；未生成时省略 */
  previousEpisodeScript?: string;
  /** 上一轮审核报告：阶段若存在则带上「上一版产出+审核意见」进入修订模式（对齐 ToonFlow 审核→修复闭环） */
  reviewFeedback?: string;
  /** 修订模式下的「上一版本阶段产出」 */
  previousOutput?: string;
  /** 项目级事件图/记忆的范围检索结果，按 project + episode 隔离后注入。 */
  projectMemoryContext?: string;
  /** 原著圣经注入块（formatSourceBibleContext 产出）；空圣经时省略，零影响。 */
  originalBibleContext?: string;
}

/** 各阶段对应的 skill 手册（作 system，模仿 ToonFlow）。 */
export const SCRIPT_STAGE_SKILL: Record<ScriptStageKey, string> = {
  scriptDraft: "script_execution_script",
  supervisionReport: "script_agent_supervision",
};

export const SCRIPT_STAGE_LABEL: Record<ScriptStageKey, string> = {
  scriptDraft: "剧本(含规划)",
  supervisionReport: "审核",
};

/** 可独立审核的生成阶段 → 其审核结果存储 key。 */
export const SCRIPT_STAGE_REVIEW_KEY = {
  scriptDraft: "scriptDraftReview",
} as const satisfies Record<string, AgentWorkKey>;

export type ReviewableStage = keyof typeof SCRIPT_STAGE_REVIEW_KEY;

// ── 本章判定（B+ 单次生成：方法文档按需注入,G4 自动三态判定） ─────────────
/** 章节数据形态三态:决定剧本生成时注入哪份方法文档(每次 ≤1 份;定稿零注入)。 */
export type ChapterScriptMode = "novel_adaptation" | "original" | "finalized";

/**
 * 按章数据形态判定生成模式(判定错了修章数据 sourceText,不修判定器——G12):
 * - 无本章原文 → 原创(注故事开发方法)
 * - 有原文且已有定稿剧本 → 定稿(零注入;重生成走用户显式)
 * - 有原文无剧本 → 小说改编(注改编方法)
 */
export function determineChapterMode(
  chapter: { sourceText?: string; eventState?: string },
  hasExistingScript: boolean,
): ChapterScriptMode {
  if (!chapter.sourceText?.trim()) return "original";
  if (hasExistingScript) return "finalized";
  return "novel_adaptation";
}

/** 注入矩阵:模式 → 方法文档 skill id(finalized 不注入)。 */
export const METHOD_DOCS: Record<ChapterScriptMode, string | null> = {
  novel_adaptation: "method_screen_adaptation",
  original: "method_story_development",
  finalized: null,
};

/** G12 预览页只读判定标注:「本章判定:小说改编 → 已注入改编方法文档」——只读,判定错修章数据不修判定器。 */
export function describeChapterModeAnnotation(
  chapter: { sourceText?: string },
  hasExistingScript: boolean,
): string {
  switch (determineChapterMode(chapter, hasExistingScript)) {
    case "novel_adaptation":
      return "本章判定：小说改编 → 已注入改编方法文档";
    case "original":
      return "本章判定：原创 → 已注入故事开发方法文档";
    case "finalized":
      return "本章判定：已有定稿剧本 → 未注入方法文档";
  }
}

// 单次生成：直接输出 Markdown 正文，不用 XML/JSON 包裹（放进 system，对齐 ToonFlow 把 formatPrompt 置于 system）。
const MD_FMT =
  "## 输出格式（最高优先级）\n直接输出该阶段的完整正文，使用 Markdown。不要使用任何 XML 标签包裹（如 <scriptItem>/<scriptPlan> 等），不要用 JSON 包裹，不要用代码围栏包裹整篇，不要寒暄或解释，不要调用任何工具/函数。在本次回复中一次性输出全部内容。";

/** 取某阶段 skill 手册全文（供 UI 展示）。 */
export function getStageSkillContent(stage: ScriptStageKey): string {
  return getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
}

/** 审核报告是否含待修复问题（问题清单用 🔴/🟡/⚪ 标注严重程度，审核通过的项不出现）。 */
export function hasReviewIssues(report?: string): boolean {
  return !!report && /🔴|🟡|⚪/.test(report);
}

function toMarkdownQuote(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

/** 构建某阶段发送给 AI 的消息：skill 全文作 system，章节/上一步产出作 user。 */
export function buildStageMessages(stage: ScriptStageKey, ctx: ScriptStageContext): ScriptStageMessages {
  const skill = getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
  // B+ 单次生成:剧本阶段按本章判定注入 ≤1 份方法文档(系统段 skill 之后,--- 分隔;定稿零注入)
  const methodDocId =
    stage === "scriptDraft"
      ? METHOD_DOCS[
          determineChapterMode(
            { sourceText: ctx.chapterText, eventState: ctx.eventState },
            Boolean(ctx.scriptDraft),
          )
        ]
      : null;
  const methodDoc = methodDocId ? (getAgentSkillPreset(methodDocId)?.content ?? "") : "";
  const system = [skill, methodDoc, MD_FMT].filter(Boolean).join("\n\n---\n\n");
  const lines: string[] = [];
  if (ctx.manualContext) lines.push(ctx.manualContext);
  if (ctx.originalBibleContext) lines.push(ctx.originalBibleContext);
  if (ctx.directorContext) {
    lines.push(`## 导演手法参考（按画风/导演手册）\n${ctx.directorContext}`);
  }
  lines.push(`## 本集信息（1 章 = 1 集）\n章节：${ctx.chapterTitle}`);
  if (ctx.eventState) lines.push(`本章事件分析：\n${ctx.eventState}`);
  if (ctx.projectMemoryContext) lines.push(ctx.projectMemoryContext);
  if (ctx.eventMemoryContext) lines.push(ctx.eventMemoryContext);
  if (ctx.previousEpisodeScript) {
    lines.push(
      `## 上一集剧本（仅用于衔接：承接其时间线与角色状态，禁止复述或改写其内容）\n${ctx.previousEpisodeScript}`,
    );
  }
  lines.push(`## 本章正文（重点原文）\n\n${toMarkdownQuote(ctx.chapterText)}`);
  if (ctx.reviewFeedback) {
    if (ctx.previousOutput) lines.push(`## 上一版${SCRIPT_STAGE_LABEL[stage]}（在此基础上修订，保留已合格内容）\n${ctx.previousOutput}`);
    lines.push(`## 审核意见（逐条修复以下问题，不要重写已合格部分）\n${ctx.reviewFeedback}`);
  }
  lines.push(
    `> 【重点执行要求】\n> 请基于以上信息完成「${SCRIPT_STAGE_LABEL[stage]}」${ctx.originalBibleContext ? "，遵守原著圣经" : ""}，并按输出格式返回。`,
  );
  return { system, user: lines.join("\n\n") };
}

/** 构建剧本阶段的「审核」消息：supervision skill 作 system，审核主体=新格式剧本（B+ 收口后单主体）。 */
export function buildStageReviewMessages(_stage: ReviewableStage, ctx: ScriptStageContext): ScriptStageMessages {
  const skill = getAgentSkillPreset("script_agent_supervision")?.content ?? "";
  const system = [skill, MD_FMT].filter(Boolean).join("\n\n---\n\n");
  const lines: string[] = [];
  if (ctx.manualContext) lines.push(ctx.manualContext);
  if (ctx.originalBibleContext) lines.push(ctx.originalBibleContext);
  lines.push(`## 本集信息（1 章 = 1 集）\n章节：${ctx.chapterTitle}`);
  if (ctx.eventState) lines.push(`本章事件分析（对照）：\n${ctx.eventState}`);
  if (ctx.chapterText.trim()) {
    lines.push(`本章正文（删减合理性对照，小说改编章适用）：\n\n${toMarkdownQuote(ctx.chapterText)}`);
  }
  lines.push(`剧本（审核主体）：\n${ctx.scriptDraft ?? ""}`);
  lines.push(
    "请执行「剧本审核」：以上方【剧本】为审核主体（新格式：头部三行+剧情梗概+场次正文+改编追踪表[如为小说改编章]），对照【本章事件分析】与【本章正文】，审核对象已随文提供、无需调用工具，按输出格式返回审核报告。",
  );
  return { system, user: lines.join("\n\n") };
}

/** 取阶段正文：剥离推理模型的 <think> 段（含未闭合），去掉整篇代码围栏并 trim。 */
export function parseStageOutput(output: string): string {
  let t = output.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = t.lastIndexOf("<think>");
  if (open !== -1) t = t.slice(0, open);
  return t
    .replace(/^\s*```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/** 流式实时渲染：剥离推理 <think> 段（未闭合时隐藏其后内容），去起始围栏后返回。 */
export function extractPartialContent(raw: string): string {
  let t = raw.replace(/^\s*```(?:markdown|md)?\s*\n?/i, "");
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = t.lastIndexOf("<think>");
  if (open !== -1) t = t.slice(0, open);
  return t;
}
