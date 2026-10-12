import { useCallback } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildEntityExtractionMessages,
  dedupeEntities,
  parseAliasesFromNotes,
  parseEntityExtraction,
  type KnownEntity,
} from "@/lib/studio/entity-extraction";
import {
  diffScriptEntityHints,
  extractScriptEntityHints,
  formatHintGapList,
} from "@/lib/studio/script-entity-hints";
import { captureError, logEvent } from "@/lib/diagnostics/logger";
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
  parseBibleCharacters,
  validateCharactersAgainstBible,
} from "@/lib/studio/source-bible";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
import { parseAssetNames } from "@/lib/studio/asset-names";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { NovelChapter } from "@/types/studio";
import { toast } from "sonner";
import {
  resolveProductionEpisodeId,
  resolveScriptTextForEpisode,
  scriptPlanSourceFingerprint,
} from "./workflow-helpers";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

/** 事件分析在途标记：同一时刻只跑一批，重复点击并入在途批次（loading 提示常驻不重弹、不并发）。 */
let novelEventAnalysisInFlight = false;
/** 全批次共用一条提示：loading 逐章刷进度 → 完成时原地收口为成功/失败汇总。 */
const NOVEL_EVENT_ANALYSIS_TOAST_ID = "novel-event-analysis";

// ── 1013 修 RC-9:模型原始输出分段落盘 helper(诊断专用) ────────────────────
// 按行边界累积 ≤1000 字/段(单行超限独占一段),段数上限 20(20×1000≈2 万字
// 覆盖典型提取输出,防 diagnostics jsonl 随提取次数膨胀无界;超出丢弃尾部,
// rawOutputLength 留全量可判截断)。每段 ≤1000 字 < sanitize MAX_STRING_LENGTH
// =1024;键名避开 PROMPT_KEY_PATTERN(prompt|messages|content|referenceText)。
const DIAGNOSTIC_CHUNK_CHAR_LIMIT = 1000;
const DIAGNOSTIC_CHUNK_MAX = 20;

function chunkTextForDiagnostics(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (chunks.length >= DIAGNOSTIC_CHUNK_MAX) return chunks;
    if (line.length >= DIAGNOSTIC_CHUNK_CHAR_LIMIT) {
      // 单行超限:独占一段(先冲刷在累积中的段)
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(line);
      continue;
    }
    const withLine = current ? `${current}\n${line}` : line;
    if (withLine.length > DIAGNOSTIC_CHUNK_CHAR_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = withLine;
    }
  }
  if (current && chunks.length < DIAGNOSTIC_CHUNK_MAX) chunks.push(current);
  return chunks;
}

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
      // 防重入：在途批次的 loading 提示还在顶部常驻，重复点击直接并入，不另起一批
      if (novelEventAnalysisInFlight) return;
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

      novelEventAnalysisInFlight = true;
      try {
        let successCount = 0;
        let failedCount = 0;
        let warningChapterCount = 0;
        // 按 index 排序后滚动注入上一章事件行；调用方传入乱序选择时仍保持章节顺序。
        const sortedChapters = [...chapters].sort((left, right) => left.index - right.index);
        toast.loading(`AI 正在分析（0/${sortedChapters.length}）`, {
          id: NOVEL_EVENT_ANALYSIS_TOAST_ID,
        });
        const memory = await readSourceMemoryActionContext({
          projectId: activeProjectId,
          archiveQuery: sortedChapters
            .map((chapter) => `${chapter.title} ${chapter.eventSummary ?? ""}`)
            .join(" ")
            .slice(0, 200),
          archiveLimit: 4,
        });
        if (!memory.success) {
          toast.error(memory.error, { id: NOVEL_EVENT_ANALYSIS_TOAST_ID });
          return;
        }
        const bibleCharacters = parseBibleCharacters(memory.residentMemory ?? "");
        // 项目角色库已登记名(含 notes 别名,如「监工赵四/赵四」)=经实体提取确认的
        // 工作角色(NPC 在内),不按圣经误写报警
        const knownCharacterNames = new Set<string>();
        for (const character of useCharacterLibraryStore.getState().characters) {
          knownCharacterNames.add(character.name.trim());
          const aliasNote = (character.notes ?? "").replace(/^别名[：:]/, "").trim();
          for (const alias of parseAssetNames(aliasNote, "").allNames) {
            if (alias && alias !== "未命名素材") knownCharacterNames.add(alias.trim());
          }
        }
        let prevEventLine: string | undefined;
        for (const [chapterIndex, chapter] of sortedChapters.entries()) {
          toast.loading(
            `AI 正在分析（${chapterIndex + 1}/${sortedChapters.length}）：${chapter.title}`,
            { id: NOVEL_EVENT_ANALYSIS_TOAST_ID },
          );
          updateNovelChapter(chapter.id, {
            eventTaskState: "running",
            eventErrorReason: undefined,
          });
          const messages = buildNovelEventAnalysisMessages(chapter, {
            bibleContext: memory.context,
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
              // 1013 修:max_tokens ≥16384 铁律(旧 1024)+结构化任务关思考
              // (思考型会把输出吞进思考通道,正文空返)
              maxTokens: 16384,
              disableThinking: true,
            });
            if (!result.success || !result.text) {
              throw new Error(result.error || "事件分析失败");
            }
            const analysis = parseNovelEventAnalysisLine(result.text, {
              sourceId: chapter.sourceId ?? chapter.id,
              revision: chapter.revision ?? 1,
            });
            const nameWarnings = validateCharactersAgainstBible(
              analysis.characters,
              bibleCharacters,
              knownCharacterNames,
            );
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

        // 单一收口：成功/失败/人名校验警告全部汇入同一条提示，不另弹
        const warningDescription = warningChapterCount
          ? `原著圣经人物校验：${warningChapterCount} 章出现疑似误写人名（与圣经登记名差一字），请检查事件摘要列的警告标记`
          : undefined;
        const summary = `事件分析完成：成功 ${successCount} 章，失败 ${failedCount} 章。`;
        saveAgentWorkData(
          "eventAnalysis",
          summary,
          // 汇总记录归属到本批首章，而不是写死 episode-1——产物盘点按
          // episodeId 分章，写死会在章节树里分裂出第二个“第 1 章”桶。
          chapters[0]?.id,
        );
        if (failedCount) {
          toast.error(summary, {
            id: NOVEL_EVENT_ANALYSIS_TOAST_ID,
            description: warningDescription,
          });
        } else {
          toast.success(`事件分析完成，共 ${successCount} 章`, {
            id: NOVEL_EVENT_ANALYSIS_TOAST_ID,
            description: warningDescription,
          });
        }
      } finally {
        novelEventAnalysisInFlight = false;
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
            // 库角色别名真源在 notes 首行「别名：…」(entity-sync 写入侧),守门解析
            // 打通「监工赵四↔赵四」类匹配(1013 修 RC-4;不读不存在的 c.aliases 字段)
            aliases: parseAliasesFromNotes(c.notes),
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
            // 场景库别名同走 notes 守门解析(「悦来客栈↔客栈」类匹配);props 无 notes 通道保持 []
            aliases: parseAliasesFromNotes(s.notes),
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

      const memory = await readSourceMemoryActionContext({
        projectId: activeProjectId,
        archiveQuery: scriptText.slice(0, 200),
        archiveLimit: 4,
      });
      if (!memory.success) {
        toast.error(memory.error);
        return;
      }
      // 剧本自报实体清单(确定性兜底):机械抽取注入 prompt 供模型逐项判定;非场次格式(小说体)为双空,注入块自动省略
      const scriptHints = extractScriptEntityHints(scriptText);
      const messages = buildEntityExtractionMessages({
        episodeId: targetEpisodeId,
        scriptText,
        knownEntities,
        bibleContext: memory.context,
        scriptHints,
      });
      try {
        const result = await aiManager.text({
          binding: { agent: "entityExtraction" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
          temperature: 0.2,
          // 1013 修:max_tokens ≥16384 铁律(旧 2048)+结构化任务关思考——
          // glm-5.3 思考型非流式在 2048 下把输出全吞进思考通道,正文空返
          maxTokens: 16384,
          disableThinking: true,
        });
        if (!result.success || !result.text) {
          throw new Error(result.error || "实体提取失败");
        }

        const parsed = parseEntityExtraction(result.text, targetEpisodeId);
        // 1013 修 RC-9:模型原始输出+解析错误持久化 diagnostics jsonl——排障
        // 不再靠 toast 间接推断;键名避开 PROMPT_KEY_PATTERN(prompt|messages|
        // content|referenceText),每段 ≤1000 字过 sanitize 不被摘要
        void logEvent({
          level: parsed.errors.length ? "warn" : "info",
          category: "workflow",
          message: "entityExtraction.modelOutput",
          context: {
            episodeId: targetEpisodeId,
            rawOutputLength: result.text.length,
            rawOutputChunks: chunkTextForDiagnostics(result.text),
            parseErrors: parsed.errors,
            extractedCounts: {
              character: parsed.entities.filter((entity) => entity.kind === "character").length,
              scene: parsed.entities.filter((entity) => entity.kind === "scene").length,
              prop: parsed.entities.filter((entity) => entity.kind === "prop").length,
            },
          },
        });
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
          // 提取盖戳(1011):一键生成前与现势剧本指纹比对,剧本重写后提示先重新提取
          scriptFingerprint: scriptPlanSourceFingerprint(targetEpisodeId, scriptText),
        });

        const detail = `角色 ${batch.characters.length} / 场景 ${batch.scenes.length} / 道具 ${batch.props.length}`;
        const completionBase = parsed.errors.length
          ? `资产提取完成（忽略非法行 ${parsed.errors.length}）：${detail}`
          : `资产提取完成：${detail}`;

        // 确定性落差告警(1013 修):机械清单与实际输出 diff,漏了必可见;不自动写库(防误判)。
        // hints 双空数组(非场次格式/空文本)时 diff 恒双空,自然走原收口
        const diff = diffScriptEntityHints(scriptHints, parsed.entities);
        const gapParts: string[] = [];
        if (diff.missingCharacters.length) {
          gapParts.push(`角色缺：${formatHintGapList(diff.missingCharacters)}`);
        }
        if (diff.missingScenes.length) {
          gapParts.push(`场景缺：${formatHintGapList(diff.missingScenes)}`);
        }
        if (gapParts.length) {
          toast.warning(
            `${completionBase}；以下剧本人物行具名者/场次地点未见于提取结果——${gapParts.join("；")}（可能是有意略过的群演，也可能是漏提；未自动补录，请按剧本人物行/场次标题核对）`,
          );
          void logEvent({
            level: "warn",
            category: "workflow",
            message: "entityExtraction.hints.missing",
            context: {
              episodeId: targetEpisodeId,
              missingCharacters: diff.missingCharacters,
              missingScenes: diff.missingScenes,
              parseErrors: parsed.errors,
            },
          });
        } else if (parsed.errors.length) {
          toast.warning(completionBase);
        } else {
          toast.success(`资产提取完成：${detail}`);
        }
      } catch (error) {
        // 1013 修 RC-9:提取失败连错误本体落 diagnostics(含模型调用层异常)
        void logEvent({
          level: "error",
          category: "workflow",
          message: "entityExtraction.failed",
          context: { episodeId: targetEpisodeId },
          error: captureError(error),
        });
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
