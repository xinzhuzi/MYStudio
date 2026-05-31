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
  /** 导演手册正文（色调/镜头/情绪/构图指导），改编与剧本阶段注入，对齐 ToonFlow read_skill_file */
  directorContext?: string;
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

// 单次生成：直接输出 Markdown 正文，不用 XML/JSON 包裹（放进 system，对齐 ToonFlow 把 formatPrompt 置于 system）。
const MD_FMT =
  "## 输出格式（最高优先级）\n直接输出该阶段的完整正文，使用 Markdown。不要使用任何 XML 标签包裹（如 <storySkeleton>/<adaptationStrategy>/<scriptItem> 等），不要用 JSON 包裹，不要用代码围栏包裹整篇，不要寒暄或解释，不要调用任何工具/函数。在本次回复中一次性输出全部内容。";

/** 取某阶段 skill 手册全文（供 UI 展示）。 */
export function getStageSkillContent(stage: ScriptStageKey): string {
  return getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
}

/** 构建某阶段发送给 AI 的消息：skill 全文作 system，章节/上一步产出作 user。 */
export function buildStageMessages(stage: ScriptStageKey, ctx: ScriptStageContext): ScriptStageMessages {
  const skill = getAgentSkillPreset(SCRIPT_STAGE_SKILL[stage])?.content ?? "";
  const system = [skill, MD_FMT].filter(Boolean).join("\n\n---\n\n");
  const lines: string[] = [];
  if (ctx.manualContext) lines.push(ctx.manualContext);
  if ((stage === "adaptationStrategy" || stage === "scriptDraft") && ctx.directorContext) {
    lines.push(`## 导演手法参考（按画风/导演手册）\n${ctx.directorContext}`);
  }
  lines.push(`## 本集信息（1 章 = 1 集）\n章节：${ctx.chapterTitle}`);
  if (ctx.eventState) lines.push(`本章事件分析：\n${ctx.eventState}`);
  if (stage !== "storySkeleton" && ctx.skeleton) lines.push(`故事骨架：\n${ctx.skeleton}`);
  if ((stage === "scriptDraft" || stage === "supervisionReport") && ctx.strategy) {
    lines.push(`改编策略：\n${ctx.strategy}`);
  }
  if (stage === "supervisionReport" && ctx.scriptDraft) lines.push(`剧本：\n${ctx.scriptDraft}`);
  if (stage === "storySkeleton" || stage === "adaptationStrategy" || stage === "scriptDraft") lines.push(`本章正文：\n${ctx.chapterText}`);
  if (stage === "supervisionReport") {
    lines.push("请执行「剧本审核」：以上方【剧本】为审核主体，对照【故事骨架】【改编策略】，审核对象已随文提供、无需调用工具，按输出格式返回审核报告。");
  } else {
    lines.push(`请基于以上信息完成「${SCRIPT_STAGE_LABEL[stage]}」，并按输出格式返回。`);
  }
  return { system, user: lines.join("\n\n") };
}

/** 取阶段正文：剥离推理模型的 <think> 段，去掉整篇代码围栏并 trim。 */
export function parseStageOutput(output: string): string {
  return output
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
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
