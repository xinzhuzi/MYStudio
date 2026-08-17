import { useCallback } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildEntityExtractionMessages,
  dedupeEntities,
  parseEntityExtraction,
  type KnownEntity,
} from "@/lib/studio/entity-extraction";
import {
  createMystudioSinks,
  syncExtractedEntities,
} from "@/lib/studio/entity-sync";
import {
  buildNovelEventAnalysisMessages,
  formatNovelEventState,
  formatNovelEventSummary,
  parseNovelEventAnalysisLine,
} from "@/lib/studio/event-analysis";
import {
  formatSourceBibleContext,
  parseBibleCharacters,
  readResidentBible,
  validateCharactersAgainstBible,
} from "@/lib/studio/source-bible";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { NovelChapter } from "@/types/studio";
import { toast } from "sonner";
import {
  resolveProductionEpisodeId,
  resolveScriptTextForEpisode,
} from "./workflow-helpers";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

export function useNovelPipelineActions({
  activeProjectId,
  projectName,
  saveAgentWorkData,
  saveEntityExtraction,
  updateNovelChapter,
}: {
  activeProjectId?: string;
  projectName: string;
  saveAgentWorkData: StudioStore["saveAgentWorkData"];
  saveEntityExtraction: StudioStore["saveEntityExtraction"];
  updateNovelChapter: StudioStore["updateNovelChapter"];
}) {
  const handleNovelEventAnalysis = useCallback(
    async (chapters: NovelChapter[]) => {
      if (!chapters.length) return;
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      if (
        !aiManager.resolve({ agent: "eventAnalysisAgent" }) &&
        !aiManager.resolve({ agent: "universalAi" })
      ) {
        toast.error(
          "未配置事件分析模型，请先到设置的云端AI中绑定事件分析Agent或通用AI",
        );
        return;
      }

      let successCount = 0;
      let failedCount = 0;
      let warningChapterCount = 0;
      // 单一常驻层：动作开始现读一次（批次内一致、跨批次新鲜），文件为唯一事实源
      const residentBible = await readResidentBible({
        projectId: activeProjectId,
        readText: getProjectFilesBridge()?.readText,
        storeFallback: useStudioStore.getState().sourceBible,
      });
      const bibleContext = formatSourceBibleContext(residentBible) || undefined;
      const bibleCharacters = parseBibleCharacters(residentBible);
      // 按 index 排序后滚动注入上一章事件行；调用方传入乱序选择时仍保持章节顺序。
      const sortedChapters = [...chapters].sort((left, right) => left.index - right.index);
      let prevEventLine: string | undefined;
      for (const chapter of sortedChapters) {
        updateNovelChapter(chapter.id, {
          eventTaskState: "running",
          eventErrorReason: undefined,
        });
        const messages = buildNovelEventAnalysisMessages(chapter, {
          bibleContext,
          prevEventContext: prevEventLine,
        });
        try {
          const result = await aiManager.text({
            binding: { agent: "eventAnalysisAgent" },
            messages: [
              { role: "system", content: messages.system },
              { role: "user", content: messages.user },
            ],
            temperature: 0.2,
            maxTokens: 1024,
          });
          if (!result.success || !result.text) {
            throw new Error(result.error || "事件分析失败");
          }
          const analysis = parseNovelEventAnalysisLine(result.text, {
            sourceId: chapter.sourceId ?? chapter.id,
            revision: chapter.revision ?? 1,
          });
          const nameWarnings = validateCharactersAgainstBible(analysis.characters, bibleCharacters);
          if (nameWarnings.length) warningChapterCount += 1;
          updateNovelChapter(chapter.id, {
            eventTaskState: "success",
            eventAnalysis: analysis,
            eventSummary: formatNovelEventSummary(analysis),
            eventState: formatNovelEventState(analysis),
            eventRawOutput: result.text,
            eventErrorReason: undefined,
            eventNameWarnings: nameWarnings.length ? nameWarnings : undefined,
          });
          prevEventLine = analysis.rawLine;
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          updateNovelChapter(chapter.id, {
            eventTaskState: "failed",
            eventErrorReason:
              error instanceof Error ? error.message : String(error),
            eventNameWarnings: undefined,
          });
        }
      }

      if (warningChapterCount) {
        toast.warning(
          `原著圣经人物校验：${warningChapterCount} 章出现未登记人名，请检查事件摘要列的警告标记`,
        );
      }
      saveAgentWorkData(
        "eventAnalysis",
        `事件分析完成：成功 ${successCount} 章，失败 ${failedCount} 章。`,
        // 汇总记录归属到本批首章，而不是写死 episode-1——产物盘点按
        // episodeId 分章，写死会在章节树里分裂出第二个“第 1 章”桶。
        chapters[0]?.id,
      );
      if (failedCount) {
        toast.error(`事件分析完成，失败 ${failedCount} 章`);
      } else {
        toast.success(`事件分析完成，共 ${successCount} 章`);
      }
    },
    [activeProjectId, saveAgentWorkData, updateNovelChapter],
  );

  const handleEntityExtraction = useCallback(
    async (episodeId = "episode-1") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveProductionEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可提取的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      const libChars = useCharacterLibraryStore
        .getState()
        .characters.filter(
          (item) => !activeProjectId || item.projectId === activeProjectId,
        );
      const libScenes = useSceneStore
        .getState()
        .scenes.filter(
          (item) => !activeProjectId || item.projectId === activeProjectId,
        );
      const libProps = usePropsLibraryStore
        .getState()
        .items.filter(
          (item) => !activeProjectId || item.projectId === activeProjectId,
        );

      const knownEntities: KnownEntity[] = [
        ...store.entityExtractions.flatMap((batch) => [
          ...batch.characters.map((item) => ({
            id: item.characterId,
            kind: "character" as const,
            name: item.name,
            aliases: item.aliases,
          })),
          ...batch.scenes.map((item) => ({
            id: item.sceneId,
            kind: "scene" as const,
            name: item.name,
            aliases: [],
          })),
          ...batch.props.map((item) => ({
            id: item.assetId,
            kind: "prop" as const,
            name: item.name,
            aliases: [],
          })),
        ]),
        ...libChars
          .filter(
            (c) =>
              !store.entityExtractions.some((b) =>
                b.characters.some((bc) => bc.characterId === c.id),
              ),
          )
          .map((c) => ({
            id: c.id,
            kind: "character" as const,
            name: c.name,
            aliases:
              ((c as unknown as Record<string, unknown>).aliases as string[]) ??
              [],
          })),
        ...libScenes
          .filter(
            (s) =>
              !store.entityExtractions.some((b) =>
                b.scenes.some((bs) => bs.sceneId === s.id),
              ),
          )
          .map((s) => ({
            id: s.id,
            kind: "scene" as const,
            name: s.name,
            aliases: [],
          })),
        ...libProps
          .filter(
            (p) =>
              !store.entityExtractions.some((b) =>
                b.props.some((bp) => bp.assetId === p.id),
              ),
          )
          .map((p) => ({
            id: p.id,
            kind: "prop" as const,
            name: p.name,
            aliases: [],
          })),
      ];

      const residentBible = await readResidentBible({
        projectId: activeProjectId,
        readText: getProjectFilesBridge()?.readText,
        storeFallback: useStudioStore.getState().sourceBible,
      });
      const messages = buildEntityExtractionMessages({
        episodeId: targetEpisodeId,
        scriptText,
        knownEntities,
        bibleContext: formatSourceBibleContext(residentBible) || undefined,
      });
      try {
        const result = await aiManager.text({
          binding: { agent: "entityExtraction" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
          temperature: 0.2,
          maxTokens: 2048,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "实体提取失败");
        }

        const parsed = parseEntityExtraction(result.text, targetEpisodeId);
        const { entities } = dedupeEntities(parsed.entities, knownEntities);
        if (!entities.length) {
          toast.error("未解析出任何实体，请检查模型输出格式");
          return;
        }

        const sinks = createMystudioSinks();
        const { result: batch } = syncExtractedEntities(
          {
            episodeId: targetEpisodeId,
            entities,
            projectId: activeProjectId ?? "",
            projectName,
          },
          sinks,
        );
        const chapterIdentity = store.novelChapters.find((chapter) => chapter.id === targetEpisodeId);
        saveEntityExtraction({
          ...batch,
          sourceId: chapterIdentity?.sourceId ?? targetEpisodeId,
          revision: chapterIdentity?.revision ?? 1,
        });

        const detail = `角色 ${batch.characters.length} / 场景 ${batch.scenes.length} / 道具 ${batch.props.length}`;
        if (parsed.errors.length) {
          toast.warning(
            `资产提取完成（忽略非法行 ${parsed.errors.length}）：${detail}`,
          );
        } else {
          toast.success(`资产提取完成：${detail}`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectId, projectName, saveEntityExtraction],
  );

  return {
    handleNovelEventAnalysis,
    handleEntityExtraction,
  };
}
