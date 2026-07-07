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
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStudioStore } from "@/stores/studio-store";
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
          "未配置事件分析模型，请先到设置的 API 管理中绑定事件分析Agent或通用AI",
        );
        return;
      }

      let successCount = 0;
      let failedCount = 0;
      for (const chapter of chapters) {
        updateNovelChapter(chapter.id, {
          eventTaskState: "running",
          eventErrorReason: undefined,
        });
        const messages = buildNovelEventAnalysisMessages(chapter);
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
          const analysis = parseNovelEventAnalysisLine(result.text);
          updateNovelChapter(chapter.id, {
            eventTaskState: "success",
            eventAnalysis: analysis,
            eventSummary: formatNovelEventSummary(analysis),
            eventState: formatNovelEventState(analysis),
            eventRawOutput: result.text,
            eventErrorReason: undefined,
          });
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          updateNovelChapter(chapter.id, {
            eventTaskState: "failed",
            eventErrorReason:
              error instanceof Error ? error.message : String(error),
          });
        }
      }

      saveAgentWorkData(
        "eventAnalysis",
        `事件分析完成：成功 ${successCount} 章，失败 ${failedCount} 章。`,
        "episode-1",
      );
      if (failedCount) {
        toast.error(`事件分析完成，失败 ${failedCount} 章`);
      } else {
        toast.success(`事件分析完成，共 ${successCount} 章`);
      }
    },
    [saveAgentWorkData, updateNovelChapter],
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

      const messages = buildEntityExtractionMessages({
        episodeId: targetEpisodeId,
        scriptText,
        knownEntities,
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
        saveEntityExtraction(batch);

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
