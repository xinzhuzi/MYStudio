import { getAgentSkillPreset } from "@/lib/studio/manuals";
import { daojieFidelityBoundary } from "./daojie-generation-audit";
import type { AgentWorkKey, StudioReviewTarget } from "@/types/studio";

/** 逐章编剧链（1 章 = 1 集，B+ 单次生成）：剧本(含规划) → 审核。 */
export type ScriptStageKey = "scriptDraft" | "supervisionReport";

export interface ScriptStageMessages {
  system: string;
  user: string;
}

export interface ScriptStageContext {
  strictDaojieAdaptation?: boolean;
  /** hook 的 scriptStyleSummary memo 产出(项目信息摘要行) */
  manualContext?: string;
  /** 题材剧本规则节正文(buildScriptManualContext 产出,自带『## 题材剧本规则（包名）』标题,父 I3;不再收旧导演手册) */
  directorContext?: string;
  chapterTitle: string;
  chapterText: string;
  eventState?: string;
  eventMemoryContext?: string;
  /** 本章既有剧本：仅供审核主体使用（审核消息的剧本主体）；本章判定已改走 reviewFeedback
   *  （R1/G8：仅「带审核反馈的修订」判 finalized），不再以「有剧本」判定稿 */
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
  /** 剧本确定性自检指标（analyzeScriptDraft+formatScriptDraftMetrics 产出，父 I5 标题）；审核阶段注入 user 段剧本主体之后，空/缺省零注入。 */
  selfCheckMetrics?: string;
  /** 题材剧本规则节（buildScriptManualContext 产物，自带父 I3 标题）；G33 审核阶段注入
   *  user 段审核主体之后、自检指标之前，空/缺省零注入（与生成侧 directorContext 同源不同位）。 */
  directorNarrative?: string;
  /** H9 集序:本集在章序中的 1 基序号(集序 k)——原创章方法文档(method_story_development.md:13
   *  「按总集数 N 确定本集坐标」)的运行前提,须随请求注入且不得被 episodeCount 设置门控;
   *  缺省(无章序列表)零注入。 */
  episodeOrdinal?: number;
  /** H9 集序:总集数 N(1 章 = 1 集,取章序列表长度),与 episodeOrdinal 成对注入。 */
  episodeTotal?: number;
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

/**
 * G5:组装期占位串(ScriptTab livePrompt===null 且接了 hook 预览时的 promptSource 文案)。
 * 单源导出供两侧防线共用:①ScriptTab「可编辑」禁用+title 自释与 userDraft 保存守卫;
 * ②useScriptStageActions 实发边界拒绝该字面串作为 userOverride(防固化进请求)。
 */
export const SCRIPT_STAGE_PROMPT_PLACEHOLDER = "（正在组装提示词…）";

/** 可独立审核的生成阶段 → 其审核结果存储 key。 */
export const SCRIPT_STAGE_REVIEW_KEY = {
  scriptDraft: "scriptDraftReview",
} as const satisfies Record<string, AgentWorkKey>;

export type ReviewableStage = keyof typeof SCRIPT_STAGE_REVIEW_KEY;

// ── 本章判定（B+ 单次生成：方法文档按需注入,自动三态判定,父 I4/G8 修订语义） ─────
/** 章节数据形态三态:决定剧本生成时注入哪份方法文档(每次 ≤1 份;定稿零注入)。 */
export type ChapterScriptMode = "novel_adaptation" | "original" | "finalized";

/**
 * 按章数据形态判定生成模式(判定错了修章数据 sourceText,不修判定器——G12):
 * - 带审核反馈修订 → 定稿(零注入;修订=带审核反馈,R1/G8/F5 用户裁定 10-12:不限章型——原创章修订同样走修订路径)
 * - 无本章原文(非修订) → 原创(注故事开发方法)
 * - 有原文非修订(含已有剧本的普通重生成) → 小说改编(注改编方法)
 */
export function determineChapterMode(
  chapter: { sourceText?: string; eventState?: string },
  isRevision: boolean,
): ChapterScriptMode {
  // F5:修订优先于判空——手册判定表「按审核意见修订(带审核反馈)→ 不注入」无章型限定,对齐之
  if (isRevision) return "finalized";
  if (!chapter.sourceText?.trim()) return "original";
  return "novel_adaptation";
}

/** 注入矩阵:模式 → 方法文档 skill id(finalized 不注入)。 */
export const METHOD_DOCS: Record<ChapterScriptMode, string | null> = {
  novel_adaptation: "method_screen_adaptation",
  original: "method_story_development",
  finalized: null,
};

/** 预览页只读判定标注:「本章判定:小说改编 → 已注入改编方法文档」——只读,判定错修章数据不修判定器。 */
export function describeChapterModeAnnotation(
  chapter: { sourceText?: string },
  isRevision: boolean,
): string {
  switch (determineChapterMode(chapter, isRevision)) {
    case "novel_adaptation":
      return "本章判定：小说改编 → 已注入改编方法文档";
    case "original":
      return "本章判定：原创 → 已注入故事开发方法文档";
    case "finalized":
      return "本章判定：修订模式 → 按审核意见修订，未注入方法文档";
  }
}

// 单次生成：直接输出 Markdown 正文，不用 XML/JSON 包裹（放进 system，对齐 ToonFlow 把 formatPrompt 置于 system）。
const MD_FMT =
  "## 输出格式（最高优先级）\n直接输出该阶段的完整正文，使用 Markdown。不要使用任何 XML 标签包裹（如 <scriptItem>/<scriptPlan> 等），不要用 JSON 包裹，不要用代码围栏包裹整篇，不要寒暄或解释，不要调用任何工具/函数。在本次回复中一次性输出全部内容。";

// 严格改编只复用既有输出协议；不携带通用补场、OS及强制布光的创作许可。
const DAOJIE_ADAPTATION_FORMAT = [
  "你是道劫原文改编编剧。把给定片段转成可拍剧本，只沿用原文已有事实；不执行通用自由创作方法。",
  "头部三行固定：# {作品名} EP{集序}：{集标题}；# 范围与目标：{本次范围} | 时长：{分钟}分钟；# 已确定要求：{项目信息中的画风/画幅/语言/配音要求，未知写未设}。其后依次为## 剧情梗概、场次正文、## 改编追踪。",
  "场头：{场号} {场景名} {时间}/{内外} ·约{秒数}秒；时间原文未定写未定。下一行人物：{本场实际人物}。场内镜头N：{原文支持的环境/动作/状态}，每场从1编号。对白用人物名：原话。场间用---分隔。",
  "改编追踪用表格：原文位置 | 是否采用 | 视听表达 | 待确认。按原文顺序逐段核对数量/动作/原话，未发生的事不得先写进剧本。不得把原文叙述转成OS/旁白，原文没有发声的地方就保持无台词。",
  "场次和总时长据原文内容估算，单集上限180秒，可短于目标。头部必须用分钟，各场必须用秒；头部换算秒数与逐场秒数合计四舍五入到整数秒后须一致，不得用目标时长冒充合计。原文未给光源/天象/声源/空间方位/身体反应，不必补齐；不以氛围、镜头细节为由新增。既有声音不能改为无声，数量及序数保留。",
].join("\n\n");

/** 取某阶段 skill 手册全文（供 UI 展示）。 */
export function getStageSkillContent(stage: ScriptStageKey): string {
  return getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
}

/** 审核报告是否含待修复问题（问题清单用 🔴/🟡/⚪ 标注严重程度，审核通过的项不出现）。 */
export function hasReviewIssues(report?: string): boolean {
  return !!report && /🔴|🟡|⚪/.test(report);
}

/**
 * F3 审核时效(G3·裁定⑤ 10-14 改制):版本比对优先——审核条目带 reviewTarget 指纹(被审剧本
 * 条目 id+updatedAt,审核发起时点捕获,runScriptStage 落库时随 identity 附着)时,指纹与最新
 * 剧本条目 id+updatedAt 双等=「针对当前版本」;任一不等=过期(v2 判「未审」,审核 v1 流式期间
 * 保存 v2 的时间窗口不再被 createdAt 先后误判)。旧数据无指纹(reviewTarget 缺失)→ 回落
 * createdAt 严格晚于比较,存量审核条目行为逐位不变。
 * ScriptTab 的 reviseMode 与 useScriptStageActions 的修订注入/文案旗标共用本函数,不两处各写。
 * 任一条目缺失或(回落态)createdAt 非数一律判不新鲜(无法证明审核针对当前版本,保守不修订)。
 */
export function isReviewFresh(
  reviewEntry?: { createdAt?: number; reviewTarget?: StudioReviewTarget | null } | null,
  latestScriptEntry?: { id?: string; createdAt?: number; updatedAt?: number } | null,
): boolean {
  if (!reviewEntry || !latestScriptEntry) return false;
  const reviewTarget = reviewEntry.reviewTarget;
  if (reviewTarget) {
    // 裁定⑤:两侧指纹齐备 → 版本比对优先于 createdAt 先后
    return (
      latestScriptEntry.id === reviewTarget.entryId &&
      latestScriptEntry.updatedAt === reviewTarget.updatedAt
    );
  }
  const reviewAt = reviewEntry.createdAt;
  const scriptAt = latestScriptEntry.createdAt;
  if (typeof reviewAt !== "number" || typeof scriptAt !== "number") return false;
  return reviewAt > scriptAt;
}

/** 「针对当前版本的修订审核」完整判定=含未修复问题 且 针对当前版本(收拢三处手写组合,防漏改重演 F3 类不一致)。 */
export function hasFreshReviewIssues(
  reviewEntry?: { data?: string; createdAt?: number; reviewTarget?: StudioReviewTarget | null } | null,
  latestScriptEntry?: { id?: string; createdAt?: number; updatedAt?: number } | null,
): boolean {
  return hasReviewIssues(reviewEntry?.data) && isReviewFresh(reviewEntry, latestScriptEntry);
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
  // R1/G8:仅「带审核反馈的修订」判 finalized——有原文的普通重生成仍注改编方法文档
  const methodDocId =
    stage === "scriptDraft"
      ? METHOD_DOCS[
          determineChapterMode(
            { sourceText: ctx.chapterText, eventState: ctx.eventState },
            Boolean(ctx.reviewFeedback),
          )
        ]
      : null;
  const methodDoc = methodDocId ? (getAgentSkillPreset(methodDocId)?.content ?? "") : "";
  const strict = stage === "scriptDraft" && ctx.strictDaojieAdaptation && ctx.chapterText.trim();
  const system = [strict ? DAOJIE_ADAPTATION_FORMAT : skill, strict ? ctx.directorContext : methodDoc, MD_FMT, strict ? daojieFidelityBoundary("script") : ""].filter(Boolean).join("\n\n---\n\n");
  const lines: string[] = [];
  if (ctx.manualContext) lines.push(ctx.manualContext);
  if (ctx.originalBibleContext) lines.push(ctx.originalBibleContext);
  // R2/G12:剧本阶段手册上下文只注所选导演包 script_narrative(buildScriptManualContext 产出,
  // 标题=父 I3 由该函数自带),此处原样推入——不再包「导演手法参考」标题、无 README/视觉手册
  if (ctx.directorContext) {
    lines.push(ctx.directorContext);
  }
  // H9 集序:序号行紧随章节行,仅两侧齐备时注入(缺省零注入,不破既有快照口径)
  const episodeOrdinalLine =
    ctx.episodeOrdinal !== undefined && ctx.episodeTotal !== undefined
      ? `\n本集序号：${ctx.episodeOrdinal}/${ctx.episodeTotal}`
      : "";
  lines.push(`## 本集信息（1 章 = 1 集）\n章节：${ctx.chapterTitle}${episodeOrdinalLine}`);
  if (ctx.eventState) lines.push(`本章事件分析：\n${ctx.eventState}`);
  if (ctx.projectMemoryContext) lines.push(ctx.projectMemoryContext);
  if (ctx.eventMemoryContext) lines.push(ctx.eventMemoryContext);
  if (ctx.previousEpisodeScript) {
    lines.push(
      `## 上一集剧本（仅用于衔接：承接其时间线与角色状态，禁止复述或改写其内容）\n${ctx.previousEpisodeScript}`,
    );
  }
  // 原创章无原文:跳过该节(与 :174 审核侧 trim 守卫同款,不注入空标题+空引用)
  if (ctx.chapterText.trim()) {
    lines.push(`## 本章正文（重点原文）\n\n${toMarkdownQuote(ctx.chapterText)}`);
  }
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
  // G33:题材剧本规则节(buildScriptManualContext 产物,节标题同父 I3 形态由其自带)
  // 紧随审核主体、先于自检指标注入;缺省零注入
  if (ctx.directorNarrative) lines.push(ctx.directorNarrative);
  // R4/G9:确定性自检指标紧随审核主体——审核以其数值为准,不自行计数(v3 审核手册同口径)
  if (ctx.selfCheckMetrics) lines.push(ctx.selfCheckMetrics);
  lines.push(
    "请执行「剧本审核」：以上方【剧本】为审核主体（新格式：头部三行+剧情梗概+场次正文+改编追踪表[如为小说改编章]），对照【本章事件分析】与【本章正文（如注入；原创章无此节）】，审核对象已随文提供、无需调用工具，按输出格式返回审核报告。",
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
