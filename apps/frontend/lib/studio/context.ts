import { buildStudioManualContext, type StudioManualCatalog } from "@/lib/studio/manuals";
import type {
  AgentWorkData,
  AgentWorkKey,
  NovelChapter,
  SkillContextPackage,
  StudioWorkflowConfig,
} from "@/types/studio";

export interface BuildSkillContextPackageInput {
  projectName: string;
  taskKey: AgentWorkKey;
  chapters: NovelChapter[];
  agentWorkData: AgentWorkData[];
  workflowConfig?: Partial<StudioWorkflowConfig>;
  manualCatalog?: StudioManualCatalog;
  createdAt?: number;
}

export function buildSkillContextPackage(input: BuildSkillContextPackageInput): SkillContextPackage {
  const createdAt = input.createdAt ?? Date.now();
  const chapterBlocks = input.chapters.map((chapter) => {
    const eventLines = [
      chapter.eventSummary ? `事件摘要: ${chapter.eventSummary}` : "",
      chapter.eventState ? `事件状态: ${chapter.eventState}` : "",
    ].filter(Boolean);

    return [
      `## ${chapter.index}. ${chapter.title}`,
      ...eventLines,
      "原文:",
      chapter.sourceText,
    ].join("\n");
  });

  const workBlocks = input.agentWorkData.map((item) => [
    `## ${item.key}${item.episodeId ? ` / ${item.episodeId}` : ""}`,
    item.data,
  ].join("\n"));

  return {
    title: `${input.projectName} / ${input.taskKey}`,
    taskKey: input.taskKey,
    markdown: [
      `# ${input.projectName}`,
      `任务: ${input.taskKey}`,
      "模型执行: disabled",
      "",
      buildStudioManualContext(input.workflowConfig ?? {}, input.manualCatalog),
      "",
      "# 小说上下文",
      chapterBlocks.join("\n\n") || "无",
      "",
      "# 已有工作数据",
      workBlocks.join("\n\n") || "无",
    ].join("\n"),
    modelExecution: "disabled",
    createdAt,
  };
}
