import { isDaojieAdaptation, reviewDaojieGeneration } from "@/lib/studio/daojie-generation-audit";
// W0 剧本检查门(10-29 script-rootcure-clearance design §1.4):strict/通用分别按 195/180 帽
import { DAOJIE_STRICT_DURATION_SECONDS, GENERIC_DURATION_SECONDS } from "@/lib/studio/daojie-duration-policy";
import { extractScriptVoiceLines } from "@/lib/studio/script-draft-metrics";
import { runScriptPrecheck } from "@/lib/studio/script-precheck";
import { useCallback, useRef } from "react";
import {
  auditDirectorPlanStructure,
  buildDirectorPlanRepairUserMessage,
  buildDirectorPlanMessages,
  formatDirectorPlanAuditError,
  summarizeDirectorPlanAudit,
} from "@/lib/studio/director-plan";
import { createProductionAgentToolRegistry } from "@/lib/studio/production-agent-tools";
import { captureError, createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { buildSeriesBible } from "@/lib/studio/series-bible";
import {
  buildStoryboardTableMessages,
  parseStoryboardTable,
  toStoryboardItems,
} from "@/lib/studio/storyboard-table";
import { aiManager } from "@/lib/ai/ai-manager";
import { hasReviewIssues, isReviewFresh } from "@/lib/studio/script-planning";
import { SCRIPT_STAGE_STREAM_TIMEOUT_MS, STORYBOARD_TABLE_STREAM_TIMEOUT_MS } from "./useScriptStageActions";
import {
  buildStoryboardTableManualContext,
  buildStudioManualContext,
  type StudioManualCatalog,
} from "@/lib/studio/manuals";
import {
  buildProjectMemoryRecords,
  formatProjectMemoryContext,
  retrieveProjectMemory,
} from "@/lib/studio/project-memory";
import { EXTENDED_VISUAL_MANUAL_SEED_ID } from "@/lib/studio/visual-manual-classification";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
import type { AssetGenerationTask } from "@/lib/studio/asset-generation-orchestrator";
import type { EntityResolver } from "@/lib/studio/derived-asset-sync";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { toast } from "sonner";
import {
  formatScriptPlanContext,
  latestScriptDraftEntry,
  resolveProductionEpisodeId,
  resolveScriptPlanEpisodeId,
  resolveScriptTextForEpisode,
  scriptPlanSourceFingerprint,
  stableRunFingerprint,
} from "./workflow-helpers";
import { storyboardSourceStale } from "./chapter-pipeline-stale";
 
import type { ScriptPlan } from "@/types/studio";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

function productionWritebackVersion(episodeId: string): string {
  const store = useStudioStore.getState();
  return JSON.stringify({
    projectId: useProjectStore.getState().activeProjectId,
    chapter: store.novelChapters.find((item) => item.id === episodeId),
    workflowConfig: store.workflowConfig,
    bible: store.seriesBible,
    script: latestScriptDraftEntry(store, episodeId),
    plan: store.scriptPlans.find((item) => item.episodeId === episodeId),
    assets: store.entityExtractions.filter((item) => item.episodeId === episodeId),
  });
}

export function useProductionPlanningActions({
  activeProjectId,
  manualCatalog,
  productionEpisodeId,
  handleStageChange,
  saveAgentWorkData,
  saveScriptPlan,
  saveSeriesBible,
}: {
  activeProjectId?: string;
  manualCatalog: StudioManualCatalog;
  productionEpisodeId: string;
  handleStageChange: (value: string) => void;
  saveAgentWorkData: StudioStore["saveAgentWorkData"];
  saveScriptPlan: StudioStore["saveScriptPlan"];
  saveSeriesBible: StudioStore["saveSeriesBible"];
}) {
  // 道劫两种生成共用一槽；延长到审核后的全部写回结束。
  const strictGenerationLock = useRef(false);
  const handleDirectorPlan = useCallback(
    async (episodeId = "episode-1", userInstruction = "") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveProductionEpisodeId(store, episodeId);
      const chapterIdentity = store.novelChapters.find((chapter) => chapter.id === targetEpisodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可规划的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }
      // D4(10-13-audit4-downstream,design §2):导演规划门禁补「本章资产已提取」——
      // 无提取的章规划出来的 ⑦ 预划没有真实资产可锚,下游派生/分镜全线空转;拦下并
      // 指路,不静默放行。异常经 handleProductionNodeAction 整体 catch 现形为 toast。
      if (!store.entityExtractions.some((item) => item.episodeId === targetEpisodeId)) {
        toast.error("本章无资产提取结果：请先执行资产提取，再生成导演规划");
        return;
      }

      const sourceText = chapterIdentity?.sourceText ?? "";
      const strict = isDaojieAdaptation(store.workflowConfig.directorManualId, sourceText);
      if (strict && strictGenerationLock.current) { toast.error("道劫生成/审核正在进行，请等待完成"); return; }
      if (strict) strictGenerationLock.current = true;
      const version = strict ? productionWritebackVersion(targetEpisodeId) : "";
      const projectAtStart = useProjectStore.getState().activeProjectId;
      let rejectedText = "";
      let reportSaved = false;
      try {
        if (strict && activeProjectId && activeProjectId !== projectAtStart) { toast.error("当前项目已变化，请刷新后重新生成"); return; }
        // riderB(H5/G36 全链 16:9):规划装配链此前零画幅信息(手册旧竖屏表述无从
        // 校正);对齐剧本阶段既有文案(useScriptStageActions.ts:74「目标画幅」)。
        const manualContext = [
          buildStudioManualContext(
            store.workflowConfig,
            manualCatalog,
            // G39(10-12 第8轮):导演规划阶段手册上下文全量注入,不截 4000 字
            { moduleCharCap: 0 },
          ),
          `目标画幅：${store.workflowConfig.platformSpec || "16:9"}`,
        ].join("\n");
        const projectId = activeProjectId ?? useProjectStore.getState().activeProjectId ?? "studio-current-project";
        const projectMemoryContext = formatProjectMemoryContext(retrieveProjectMemory({
          records: buildProjectMemoryRecords({
            projectId,
            chapters: store.novelChapters,
            entityExtractions: store.entityExtractions,
            seriesBible: store.seriesBible,
          }),
          projectId,
          episodeId: targetEpisodeId,
          query: scriptText.slice(0, 240),
        }));
        const memory = await readSourceMemoryActionContext({
          projectId,
          archiveQuery: scriptText.slice(0, 200),
        });
        if (!memory.success) {
          toast.error(memory.error);
          return;
        }
        const messages = buildDirectorPlanMessages({
          episodeId: targetEpisodeId,
          scriptText, sourceText, strictDaojieAdaptation: strict,
          manualContext: [manualContext, projectMemoryContext].filter(Boolean).join("\n\n---\n\n"),
          bibleContext: memory.context,
        });
        const userContent = userInstruction.trim()
          ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
          : messages.user;
        const operationId = createOperationId("director-plan");
        const runId = store.startAgentRun({
          key: "directorPlan",
          phase: "scriptPlan",
          inputSummary: `directorPlan:${targetEpisodeId}:${scriptText.length}`,
          inputFingerprint: stableRunFingerprint({
            targetEpisodeId,
            scriptText,
            manualContext,
            userInstruction,
          }),
          checkpointRef: operationId,
        });
        let blockedLogged = false;
        const logDirectorPlanAudit = async (
          message: "directorPlan.audit.first" | "directorPlan.audit.repair",
          audit: ReturnType<typeof auditDirectorPlanStructure>,
        ) => {
          await logEvent({
            level: audit.passed ? "info" : "warn",
            category: "workflow",
            operationId,
            message,
            context: {
              episodeId: targetEpisodeId,
              audit: summarizeDirectorPlanAudit(audit),
            },
          });
        };
        const logDirectorPlanWriteback = async (
          message: "directorPlan.writeback.saved" | "directorPlan.writeback.blocked",
          context: Record<string, unknown>,
        ) => {
          if (message === "directorPlan.writeback.blocked") blockedLogged = true;
          await logEvent({
            level: message === "directorPlan.writeback.saved" ? "info" : "error",
            category: "workflow",
            operationId,
            message,
            context: {
              episodeId: targetEpisodeId,
              ...context,
            },
          });
        };
        try {
          const result = await aiManager.textStream({
            binding: { agent: "productionAgent:directorPlanAgent" },
            messages: [
              { role: "system", content: messages.system },
              { role: "user", content: userContent },
            ],
            temperature: 0.4,
            // 1013 实弹:64K 地板后 glm-5.3 导演规划 思考4.2min+正文6212字@5min 被默认300s掐断(正文已流仍弃);对齐剧本阶段 600s 总预算
            timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS,
            // 1013 实弹定谳:GLM 思考型经 anthropic 口思考计入 max_tokens,4096 会被思考独占→正文零字节
            // 「模型响应中缺少文本内容」5 连败(useProductionPlanningActions 结构性阻塞);按用户常设令
            // maxTokens 不显式传——统一走 ai-manager maxTokensFloor(1013 终裁:最大输出 64K 单一真源)
          }, () => undefined);
          if (!result.success || !result.text) {
            throw new Error(result.error || "导演规划失败");
          }

          let finalText = result.text;
          rejectedText = finalText;
          let audit = auditDirectorPlanStructure(finalText);
          await logDirectorPlanAudit("directorPlan.audit.first", audit);
          let repairAttempted = false;
          if (!audit.passed) {
            repairAttempted = true;
            const repairResult = await aiManager.textStream({
              binding: { agent: "productionAgent:directorPlanAgent" },
              messages: [
                { role: "system", content: messages.system },
                {
                  role: "user",
                  content: buildDirectorPlanRepairUserMessage({
                    originalUserContent: userContent,
                    invalidOutput: finalText,
                    issues: audit.issues,
                  }),
                },
              ],
              temperature: 0.25,
              timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS,
              // 同上:maxTokens 走 ai-manager 统一兜底
              // 同上:maxTokens 走 ai-manager 统一兜底
            }, () => undefined);
            if (!repairResult.success || !repairResult.text) {
              await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
                phase: "repair_request",
                firstAudit: summarizeDirectorPlanAudit(audit),
                repairError: repairResult.error || "empty repair output",
              });
              throw new Error(repairResult.error || "导演规划结构修复失败");
            }
            finalText = repairResult.text;
            rejectedText = finalText;
            audit = auditDirectorPlanStructure(finalText);
            await logDirectorPlanAudit("directorPlan.audit.repair", audit);
          }
          if (!audit.passed) {
            await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
              phase: "final_audit",
              repairAttempted,
              audit: summarizeDirectorPlanAudit(audit),
            });
            throw new Error(formatDirectorPlanAuditError(audit));
          }

          if (strict) {
            const review = await reviewDaojieGeneration({ stage: "planning", sourceText, bibleContext: memory.context, scriptText, outputText: finalText }, (reviewMessages) => aiManager.textStream({
              binding: { agent: "productionAgent:directorPlanAgent" }, timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS, temperature: 0.2,
              messages: [{ role: "system", content: reviewMessages.system }, { role: "user", content: reviewMessages.user }],
            }, () => undefined));
            if (productionWritebackVersion(targetEpisodeId) !== version) throw new Error("审核期间项目、原文或上游已更新，本次规划未写回");
            saveAgentWorkData("supervisionReport", review.report, targetEpisodeId, { sourceId: chapterIdentity?.sourceId ?? targetEpisodeId, revision: chapterIdentity?.revision ?? 1 });
            reportSaved = true;
            if (!review.passed) throw new Error("道劫规划未通过原文审核，已保留上一有效版本；详见审核报告");
          }
          const tools = createProductionAgentToolRegistry();
          // 08-27 二期 R1 预划剧本锚:落库前闭包盖「该章剧本正文」指纹(不含
          // manual/user 指令)。初跑与重跑同走本调用点,重跑后新指纹落库,
          // 面板「预划已过期」提示自然消失。不改 writeDirectorPlan 签名。
          const planScriptFingerprint = scriptPlanSourceFingerprint(targetEpisodeId, scriptText);
          // D2(裁定⑤,10-13-audit4-downstream):同点记来源剧本条目指纹(条目
          // id+updatedAt,与 G3 reviewTarget 同形态)——分镜表门禁据此识别「规划
          // 所基于的剧本版本」,改剧本后旧规划出分镜表走软提示。
          const planSourceScriptEntry = latestScriptDraftEntry(store, targetEpisodeId);
          const writeResult = tools.writeDirectorPlan({
            text: finalText,
            episodeId: targetEpisodeId,
            identity: {
              sourceId: chapterIdentity?.sourceId ?? targetEpisodeId,
              revision: chapterIdentity?.revision ?? 1,
            },
            saveAgentWorkData,
            saveScriptPlan: (plan) =>
              saveScriptPlan({
                ...plan,
                scriptFingerprint: planScriptFingerprint,
                ...(planSourceScriptEntry?.id
                  ? { sourceScript: { entryId: planSourceScriptEntry.id, updatedAt: planSourceScriptEntry.updatedAt } }
                  : {}),
              }),
          });
          if (!writeResult.approved || !writeResult.plan) {
            await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
              phase: "tool_supervision",
              repairAttempted,
              audit: writeResult.audit,
              issues: writeResult.issues,
              error: writeResult.error,
            });
            throw new Error(writeResult.error || "导演规划工具写回未通过监督");
          }
          useStudioStore.getState().finishAgentRun(runId, {
            outputRef: writeResult.workId,
            outputRefs: [writeResult.workId, writeResult.plan.id].filter((ref): ref is string => Boolean(ref)),
            checkpointRef: operationId,
          });
          await logDirectorPlanWriteback("directorPlan.writeback.saved", {
            repairAttempted,
            audit: writeResult.audit,
            derivedAssetPlanCount: writeResult.plan.derivedAssetPlan.length,
            sceneIntentCount: writeResult.plan.sceneIntents.length,
          });

          const detail = `6段规划，场景 ${writeResult.audit.metrics.sceneSections} 段，衍生预划 ${writeResult.plan.derivedAssetPlan.length} 条`;
          const repairDetail = repairAttempted ? "；已自动修复结构" : "";
          if (writeResult.warnings.length) {
            toast.warning(
              `导演规划完成（${detail}${repairDetail}；光影提示 ${writeResult.warnings.length} 处已剔除）`,
            );
          } else {
            toast.success(`导演规划完成（${detail}${repairDetail}）`);
          }
        } catch (error) {
          if (strict && rejectedText && !reportSaved && productionWritebackVersion(targetEpisodeId) === version) {
            saveAgentWorkData("supervisionReport", `# 道劫planning拒绝写回\n${captureError(error).message}\n\n## 被审产出\n${rejectedText}`, targetEpisodeId, { sourceId: chapterIdentity?.sourceId ?? targetEpisodeId, revision: chapterIdentity?.revision ?? 1 });
          }
          if (!strict || useProjectStore.getState().activeProjectId === projectAtStart) useStudioStore.getState().failAgentRun(runId, captureError(error).message, operationId);
          if (!blockedLogged) {
            await logDirectorPlanWriteback("directorPlan.writeback.blocked", {
              phase: "exception",
              error: captureError(error),
            });
          }
          toast.error(error instanceof Error ? error.message : String(error));
        }
      } finally { if (strict) strictGenerationLock.current = false; }
    },
    [activeProjectId, manualCatalog, saveAgentWorkData, saveScriptPlan],
  );

  const handleStoryboardTable = useCallback(
    async (episodeId = "episode-1", userInstruction = "") => {
      if (!window.electronAPI?.textCompletion) {
        toast.error("当前环境不支持模型调用");
        return;
      }

      const store = useStudioStore.getState();
      const targetEpisodeId = resolveScriptPlanEpisodeId(store, episodeId);
      const scriptText = resolveScriptTextForEpisode(store, targetEpisodeId);
      if (!scriptText.trim()) {
        toast.error("没有可生成分镜表的剧本：请先保存剧本草稿或导入小说正文");
        return;
      }

      const plan = store.scriptPlans.find(
        (item) => item.episodeId === targetEpisodeId,
      );
      if (!plan) {
        toast.error("尚无导演规划：请先在分镜视频生成节点中生成导演规划");
        return;
      }

      // D3(10-13-audit4-downstream,design §2):资产清单不再跨章回退——本章无
      // 提取就明示先提取并中止,不把别章资产冒充本章在册清单喂给模型
      // (原 buildAssetsInventory 的 `?? store.entityExtractions[0]` 回退已删)。
      const latestDraftEntry = latestScriptDraftEntry(store, targetEpisodeId);
      if (!store.entityExtractions.some((item) => item.episodeId === targetEpisodeId)) {
        toast.error("本章无资产提取结果：请先执行资产提取，再生成分镜表");
        return;
      }
      // D2(裁定④⑤+R12 收口,10-14-audit4-residuals):既有「尚无导演规划」硬门
      // 之后叠过期软提示。判定优先读落库 sourceScript(条目 id+updatedAt,裁定⑤
      // 同款StoryboardItem.sourceScript 形态)与现势最新草稿条目比对——复用 D5
      // 同款 storyboardSourceStale(单源,禁两处各写一套 id+updatedAt 比对);
      // 旧数据(无 sourceScript 戳/现势无草稿条目=undefined)回落正文哈希比对。
      const sourceScriptStale = storyboardSourceStale({
        sourceScript: plan.sourceScript,
        latestScriptEntry: latestDraftEntry?.id
          ? { id: latestDraftEntry.id, updatedAt: latestDraftEntry.updatedAt }
          : undefined,
      });
      const planStale =
        sourceScriptStale !== undefined
          ? sourceScriptStale
          : plan.scriptFingerprint !== undefined
            && plan.scriptFingerprint !== scriptPlanSourceFingerprint(targetEpisodeId, scriptText);
      if (planStale) {
        toast.warning("剧本已更新：当前导演规划基于旧版剧本，建议重审/重规划后再生成分镜表；本次继续生成");
      }
      // D7(裁定④):下游不强制审核通过——入口对「未审/审不过」剧本软警示后继续。
      const reviewEntry = store.agentWorkData
        .filter((item) => item.key === "scriptDraftReview" && item.episodeId === targetEpisodeId)
        .slice()
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
      if (!isReviewFresh(reviewEntry, latestDraftEntry)) {
        toast.warning("本章剧本尚未通过审核（未审或审核已过期）：建议先完成剧本审核再生成分镜表；本次继续生成");
      } else if (hasReviewIssues(reviewEntry?.data)) {
        toast.warning("本章剧本审核未通过（存在未修复问题）：建议先修订剧本再生成分镜表；本次继续生成");
      }

      const sourceChapter = store.novelChapters.find((item) => item.id === targetEpisodeId);
      const sourceText = sourceChapter?.sourceText ?? "";
      const strict = isDaojieAdaptation(store.workflowConfig.directorManualId, sourceText);
      if (strict && strictGenerationLock.current) { toast.error("道劫生成/审核正在进行，请等待完成"); return; }
      if (strict) strictGenerationLock.current = true;
      const version = strict ? productionWritebackVersion(targetEpisodeId) : "";
      const projectAtStart = useProjectStore.getState().activeProjectId;
      let rejectedText = "";
      let reportSaved = false;
      // W0 机读门局部状态(design §1.4):machineGateRejection 非空=本次失败源自分镜机读
      // 检查门(通用模式机读 RED 落档判据);machineGateDetail=checks JSON 明细。
      // machineGateVersion:通用模式 version="" 无法与七元组 JSON 比对,另取生成起点的
      // 写回版本快照——落档条件用它比对(仅作项目/剧本在审核期间未被改写的防御,语义
      // 与 strict 档 :498/:545 的版本锁一致;strict 档直接复用 version 快照)。
      let machineGateRejection: string | null = null;
      let machineGateDetail: string | null = null;
      const machineGateVersion = strict ? version : productionWritebackVersion(targetEpisodeId);
      try {
        if (strict && activeProjectId && activeProjectId !== projectAtStart) { toast.error("当前项目已变化，请刷新后重新生成"); return; }
        const projectId = activeProjectId ?? useProjectStore.getState().activeProjectId ?? "studio-current-project";
        const memory = await readSourceMemoryActionContext({
          projectId,
          archiveQuery: scriptText.slice(0, 200),
        });
        if (!memory.success) {
          toast.error(memory.error);
          return;
        }
        const messages = buildStoryboardTableMessages({
          episodeId: targetEpisodeId,
          scriptText, sourceText, strictDaojieAdaptation: strict,
          scriptPlanContext: formatScriptPlanContext(plan),
          // riderB(H5/G36):分镜表装配链同注目标画幅(对齐 useScriptStageActions.ts:74 文案)
          manualContext: [
            buildStoryboardTableManualContext(store.workflowConfig, manualCatalog),
            `目标画幅：${store.workflowConfig.platformSpec || "16:9"}`,
          ].filter(Boolean).join("\n"),
          bibleContext: memory.context,
          assetsInventory: buildAssetsInventory(store, targetEpisodeId),
        });
        const userContent = userInstruction.trim()
          ? `${messages.user}\n\n【本次节点补充要求】\n${userInstruction.trim()}`
          : messages.user;
        const runId = store.startAgentRun({
          key: "storyboardTable",
          phase: "storyboardTable",
          inputSummary: `storyboardTable:${targetEpisodeId}:${scriptText.length}`,
          inputFingerprint: stableRunFingerprint({
            targetEpisodeId,
            scriptText,
            scriptPlanId: plan.id,
            userInstruction,
          }),
        });

        try {
          // 流式生成:整集分镜表输出量大(可达数分钟),非流式撞网关 524(~2 分钟切断);
          // 与导演规划同走 textStream 保活(2026-08-22 实证:非流式 127s 必 524)
          const result = await aiManager.textStream(
            {
              binding: { agent: "productionAgent:storyboardTableAgent" },
              messages: [
                { role: "system", content: messages.system },
                { role: "user", content: userContent },
              ],
              temperature: 0.35,
              // 10-14 livefire17 ch002 定谳:分镜表单独 1200s 判定性预算(期望总时长
              // 690-1215s,600s=人为墙);导演规划侧(上方 :188/:217)维持 600s 档不动
              timeoutMs: STORYBOARD_TABLE_STREAM_TIMEOUT_MS,
              // 同上:maxTokens 走 ai-manager 统一兜底
            },
            () => {},
          );
          if (!result.success || !result.text) {
            throw new Error(result.error || "分镜表生成失败");
          }

          rejectedText = result.text;
          const parsed = parseStoryboardTable(result.text, targetEpisodeId, {
            requireShotSemantics: true,
          });
          if (parsed.errors.length) {
            throw new Error(`分镜表结构无效：${parsed.errors.join("；")}`);
          }
          // W0 主门·分镜机读检查(design §1.4,全 additive):四项纯算术判定(时长帽/语速
          // 双口径/台词勾销账/OS 预算)先于 LLM 审核门——RED 短路省一次审核调用(对齐
          // daojie-generation-audit「196秒在模型调用前拒绝」精神);strict/通用分别按
          // 195/180 帽。下方 inline 审核门(strict 分支)零变化,机读门只在其前插入。
          const precheck = runScriptPrecheck({
            rows: parsed.rows.map((row) => ({ index: row.index, duration: row.duration, lines: row.lines })),
            scriptVoiceLines: extractScriptVoiceLines(scriptText),
            durationCapSeconds: strict ? DAOJIE_STRICT_DURATION_SECONDS : GENERIC_DURATION_SECONDS,
            ...(strict ? { sourceTextForExemption: sourceText } : {}),
          });
          if (!precheck.passed) {
            machineGateRejection = precheck.summary;
            machineGateDetail = JSON.stringify(precheck.checks, null, 2);
            throw new Error(`分镜机读检查未通过，已保留上一有效版本：${precheck.summary}`);
          }
          if (precheck.yellow.length || precheck.pending.length) {
            saveAgentWorkData("supervisionReport",
              `# 分镜机读检查黄线落档\n${precheck.summary}\n\n## 明细\n${JSON.stringify(precheck.checks, null, 2)}`,
              targetEpisodeId, { sourceId: sourceChapter?.sourceId ?? targetEpisodeId, revision: sourceChapter?.revision ?? 1 });
            // YELLOW/pending 一律不阻断、不置 reportSaved——strict 的 LLM 审核报告仍会
            // 再写一条 supervisionReport,agentWorkData 按时间序多条共存,最新优先读取
          }
          if (strict) {
            const review = await reviewDaojieGeneration({ stage: "storyboard", sourceText, bibleContext: memory.context, scriptText, planText: formatScriptPlanContext(plan), outputText: result.text, totalDurationSeconds: parsed.rows.reduce((total, row) => total + row.duration, 0) }, (reviewMessages) => aiManager.textStream({
              binding: { agent: "productionAgent:storyboardTableAgent" }, timeoutMs: STORYBOARD_TABLE_STREAM_TIMEOUT_MS, temperature: 0.2,
              messages: [{ role: "system", content: reviewMessages.system }, { role: "user", content: reviewMessages.user }],
            }, () => undefined));
            if (productionWritebackVersion(targetEpisodeId) !== version) throw new Error("审核期间项目、原文或上游已更新，本次分镜未写回");
            saveAgentWorkData("supervisionReport", review.report, targetEpisodeId, { sourceId: sourceChapter?.sourceId ?? targetEpisodeId, revision: sourceChapter?.revision ?? 1 });
            reportSaved = true;
            if (!review.passed) throw new Error("道劫分镜未通过原文审核，已保留上一有效版本；详见审核报告");
          }
          const chapter = store.novelChapters.find((item) => item.id === targetEpisodeId);
          const sourceIdentity = {
            sourceId: chapter?.sourceId ?? targetEpisodeId,
            revision: chapter?.revision ?? 1,
          };
          const workId = saveAgentWorkData("storyboardTable", result.text, targetEpisodeId, sourceIdentity);
          const workflowStore = useStudioStore.getState();
          const characters = workflowStore.entityExtractions.find(
            (item) => item.episodeId === targetEpisodeId,
          )?.characters ?? [];
          const speakerFallbacks: string[] = [];
          const items = toStoryboardItems(
            parsed.rows,
            targetEpisodeId,
            characters,
            sourceIdentity,
            {
              unknownSpeaker: "narrator",
              onSpeakerFallback: (storyboardId, speaker) => {
                speakerFallbacks.push(`${storyboardId} ${speaker}`);
              },
              // D5(裁定⑤):本批分镜记来源剧本条目指纹,chapter-pipeline-stale
              // 分镜层过期判定据此软标;无草稿条目(不可能,入口已保剧本非空)不落。
              ...(latestDraftEntry?.id
                ? { sourceScript: { entryId: latestDraftEntry.id, updatedAt: latestDraftEntry.updatedAt } }
                : {}),
            },
          );
          workflowStore.replaceStoryboardsForEpisode(targetEpisodeId, items);
          workflowStore.finishAgentRun(runId, {
            outputRef: workId,
            outputRefs: [workId, ...items.map((item) => item.id)],
          });

          const warningText = parsed.warnings.length
            ? `，提示 ${parsed.warnings.length} 条`
            : "";
          const fallbackText = speakerFallbacks.length
            ? `，${speakerFallbacks.length} 条群演台词归旁白(${speakerFallbacks.slice(0, 2).map((entry) => entry.split(" ")[1]).join("、")}${speakerFallbacks.length > 2 ? "等" : ""})`
            : "";
          toast.success(`分镜表完成：${items.length} 条分镜${warningText}${fallbackText}`);
        } catch (error) {
          if (strict && rejectedText && !reportSaved && productionWritebackVersion(targetEpisodeId) === version) {
            saveAgentWorkData("supervisionReport", `# 道劫storyboard拒绝写回\n${captureError(error).message}\n\n## 被审产出\n${rejectedText}`, targetEpisodeId, { sourceId: sourceChapter?.sourceId ?? targetEpisodeId, revision: sourceChapter?.revision ?? 1 });
          } else if (machineGateRejection && rejectedText && !reportSaved
            && productionWritebackVersion(targetEpisodeId) === machineGateVersion) {
            // W0 新增分支(design §1.4,additive):通用模式机读 RED 首次获得落档——既有
            // strict 分支(上方)一字不动;其余通用路径失败(machineGateRejection=null)行为不变
            saveAgentWorkData("supervisionReport",
              `# 分镜机读检查拒绝写回\n${captureError(error).message}\n\n## 明细\n${machineGateDetail ?? ""}\n\n## 被审产出\n${rejectedText}`,
              targetEpisodeId, { sourceId: sourceChapter?.sourceId ?? targetEpisodeId, revision: sourceChapter?.revision ?? 1 });
          }
          if (!strict || useProjectStore.getState().activeProjectId === projectAtStart) useStudioStore.getState().failAgentRun(runId, error instanceof Error ? error.message : String(error));
          toast.error(error instanceof Error ? error.message : String(error));
        }
      } finally { if (strict) strictGenerationLock.current = false; }
    },
    [activeProjectId, manualCatalog, saveAgentWorkData],
  );

  const handleRebuildWorkbenchTracks = useCallback(() => {
    const store = useStudioStore.getState();
    if (!store.storyboards.length) {
      toast.error("尚无分镜：请先生成分镜表");
      return;
    }
    store.rebuildTracks();
    handleStageChange("workbench");
    toast.success(`视频轨道已重建：${store.storyboards.length} 个分镜`);
  }, [handleStageChange]);

  const handleProductionNodeAction = useCallback(
    async (action: {
      id: string;
      targetStage: string;
      userInstruction?: string;
    }) => {
      // livefire9 实锤:画布节点动作经 index.tsx `void` 派发,async 链上未捕获异常
      // 会被无声吞掉(导演规划两次静默失败零指纹)。此处统一兜底:异常必须现形
      // 为 toast+console,禁止环节动作无声死亡。
      try {
        if (action.id === "generate-director-plan") {
          await handleDirectorPlan(
            productionEpisodeId,
            action.userInstruction ?? "",
          );
          return;
        }
        if (action.id === "generate-storyboard-table") {
          await handleStoryboardTable(
            productionEpisodeId,
            action.userInstruction ?? "",
          );
          return;
        }
        if (action.id === "rebuild-workbench-tracks") {
          handleRebuildWorkbenchTracks();
          return;
        }
      } catch (error) {
        console.error("[handleProductionNodeAction]", action.id, error);
        // App 日志留痕(livefire9 取证盲区:装机 console 无人订阅,toast 一闪
        // 即逝)——diagnostics 恒落盘,事后可取证「哪个环节动作在何处抛了什么」。
        await logEvent({
          level: "error",
          category: "workflow",
          message: "productionNodeAction.failed",
          context: { actionId: action.id, targetStage: action.targetStage },
          error: captureError(error),
        });
        toast.error(
          `环节动作失败(${action.id}):${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      handleStageChange(action.targetStage);
    },
    [
      handleDirectorPlan,
      handleStageChange,
      handleRebuildWorkbenchTracks,
      handleStoryboardTable,
      productionEpisodeId,
    ],
  );

  const handleBuildSeriesBible = useCallback(() => {
    const projectId = activeProjectId;
    if (!projectId) {
      toast.error("未选择项目，无法锁定剧集圣经");
      return;
    }

    const characters = useCharacterLibraryStore
      .getState()
      .characters.filter(
        (item) => item.projectId === projectId,
      );
    const scenes = useSceneStore
      .getState()
      .scenes.filter((item) => item.projectId === projectId);

    const config = useStudioStore.getState().workflowConfig;
    const bible = buildSeriesBible({
      projectId,
      characters: characters.map((item) => ({
        id: item.id,
        appearance: item.appearance,
        description: item.description,
      })),
      scenes: scenes.map((item) => ({ name: item.name })),
      config: {
        visualManualId: config.visualManualId,
        directorManualId: config.directorManualId,
        platformSpec: config.platformSpec,
        stylePositioning: config.stylePositioning,
      },
    });

    saveSeriesBible(bible);
    toast.success(
      `剧集圣经已锁定（角色 ${bible.characterLocks.length} / 场景 ${bible.sceneLocks.length}，画幅 ${bible.aspectRatio}）`,
    );
  }, [activeProjectId, saveSeriesBible]);

  return {
    handleDirectorPlan,
    handleStoryboardTable,
    handleProductionNodeAction,
    handleBuildSeriesBible,
  };
}

type CharacterVariationGenerationTask = {
  characterId: string;
  variationId: string;
  projectId: string;
  name: string;
  prompt: string;
  referenceImages?: string[];
  imageWorkflowId?: string;
};

function buildCharacterDerivativeImagePrompt(input: {
  characterName: string;
  variationName: string;
  basePrompt: string;
  reason: string;
  visualManualId: string;
}) {
  const basePrompt = input.basePrompt.trim() || `${input.variationName}：${input.reason}`.trim();
  const styleLock =
    input.visualManualId === EXTENDED_VISUAL_MANUAL_SEED_ID
      ? [
          "道劫彩色工笔水墨角色设定：媒介规则优先于父图的数字渲染，脸、手、发丝、衣褶与服饰结构先以连续白描和铁线描建立，再以矿物薄层分染与罩染；主体密、背景疏",
          "水墨为主、按角色与场景设定事实彩色点缀（色量仅作人工审稿观察，30%-70%不是生成硬门），只用石青、石绿、靛青、赭石、朱砂或旧金等2-3种低饱和点缀色，禁止整图灰白化或满幅鲜艳；浅净哑光平涂底、柔和均匀平光与纸面散射光",
          "低视觉噪点，denoised details，clear readable surfaces，smooth matte finish，controlled ink wash；衣袍完整可穿，整袖口整下摆闭合缝线",
          "负面约束：dirty/muddy texture，compression artifacts/jpeg artifacts，oversharpening halos，random stains，paper-wrinkle texture，crumpled-sheet folds，fiber streaks，tattered clothing，ragged hems",
          "禁止写实摄影，禁止3D写实渲染，CGI，赛璐璐平涂，高饱和霓虹，电影级体积雾，HDR高光，镜面湿面反光和全幅冷青或灰蓝渲染",
        ]
      : [
          "character reference sheet, character turnaround",
          "consistent identity, face consistency, outfit detail clarity",
        ];

  return [
    basePrompt,
    `角色衍生资产：${input.characterName} · ${input.variationName}`,
    "以父角色基础形象图为参考，保持同一角色身份、面容、体态、发型识别点不变，只叠加服化妆造与局部状态变化",
    "必须输出角色四视图设定图/三视图参考图，不要生成单张全身插画或说明卡",
    "同一画面左至右并排展示人像特写、正视图、侧视图、后视图，portrait closeup, front view, side view, back view, character reference sheet, character turnaround",
    "自然站立，宣纸白底色背景，均匀散光，无硬阴影，四视图服化妆造一致，图中不要有任何文字",
    ...styleLock,
  ].join("\n");
}

export function collectDerivedAssetGenerationTasks(
  plan: ScriptPlan["derivedAssetPlan"],
  resolver: EntityResolver,
  visualManualId: string,
  projectId: string,
  chapterId?: string,
): {
  characterVariationTasks: CharacterVariationGenerationTask[];
  storeTasks: AssetGenerationTask[];
  total: number;
  /** D4(design §2):resolver 匹配不到的计划条目明细——原 `if (!target) continue`
   * 静默丢,现计数+明细上报,调用方汇总提示「N 项派生资产未匹配到目标」。 */
  unmatched: Array<{ parentAssetId: string; state: string }>;
} {
  const characters = useCharacterLibraryStore.getState().characters;
  const scenes = useSceneStore.getState().scenes;
  const props = usePropsLibraryStore.getState().items;
  const characterVariationTasks: CharacterVariationGenerationTask[] = [];
  const storeTasks: AssetGenerationTask[] = [];
  const unmatched: Array<{ parentAssetId: string; state: string }> = [];

  for (const item of plan) {
    const target = resolver(item.parentAssetId);
    if (!target) {
      // D4:不再静默丢——留痕上报。
      unmatched.push({ parentAssetId: item.parentAssetId, state: item.state });
      continue;
    }

    if (target.kind === "character") {
      const character = characters.find((current) => current.id === target.id);
      const variation = character?.variations.find(
        (current) => current.name === item.state,
      );
      if (!character || !variation || variation.referenceImage) continue;
      characterVariationTasks.push({
        characterId: character.id,
        variationId: variation.id,
        projectId,
        name: `${character.name}-${variation.name}`,
        prompt: buildCharacterDerivativeImagePrompt({
          characterName: character.name,
          variationName: variation.name,
          basePrompt:
            variation.visualPromptZh ||
            variation.visualPrompt ||
            `${variation.name}：${item.reason}`,
          reason: item.reason,
          visualManualId,
        }),
        referenceImages: [
          character.thumbnailUrl,
          character.views[0]?.imageUrl,
        ].filter((image): image is string => Boolean(image)),
        imageWorkflowId: variation.imageWorkflowId,
      });
      continue;
    }

    if (target.kind === "scene") {
      const parentScene = scenes.find((current) => current.id === target.id);
      const scene = scenes.find(
        (current) =>
          current.parentSceneId === target.id &&
          current.viewpointName === item.state &&
          current.projectId === projectId,
      );
      if (!scene || scene.referenceImage) continue;
      const existingPrompt = scene.visualPrompt || `${item.state}：${item.reason}`;
      storeTasks.push({
        assetId: scene.id,
        assetType: "scene",
        projectId,
        chapterId,
        name: scene.name,
        description:
          [scene.location, scene.time, scene.atmosphere, scene.notes]
            .filter(Boolean)
            .join("，") || item.reason,
        isDerivative: true,
        visualManualId,
        skipPolish: Boolean(scene.visualPrompt),
        existingPrompt,
        referenceImages: [
          parentScene?.referenceImage,
          parentScene?.referenceImageBase64,
        ].filter((image): image is string => Boolean(image)),
        imageWorkflowId: scene.imageWorkflowId,
      });
      continue;
    }

    const parentProp = props.find((current) => current.id === target.id);
    const prop = props.find(
      (current) =>
        current.parentId === target.id &&
        current.category === item.state &&
        current.projectId === projectId,
    );
    if (!prop || prop.imageUrl) continue;
    const existingPrompt = prop.visualPrompt || `${item.state}：${item.reason}`;
    storeTasks.push({
      assetId: prop.id,
      assetType: "prop",
      projectId,
      chapterId,
      name: prop.name,
      description: prop.description || item.reason,
      isDerivative: true,
      visualManualId,
      skipPolish: Boolean(prop.visualPrompt),
      existingPrompt,
      referenceImages: [
        parentProp?.imageUrl,
        ...(parentProp?.referenceImages ?? []),
      ].filter((image): image is string => Boolean(image)),
      imageWorkflowId: prop.imageWorkflowId,
    });
  }

  return {
    characterVariationTasks,
    storeTasks,
    total: characterVariationTasks.length + storeTasks.length,
    unmatched,
  };
}

/**
 * 分镜表资产清单：角色/场景/道具实名+别名(entity-extraction 在册)。
 * 技能铁律「资产真实、不得编造名称/ID」要求可引用资产真实在册——本链路无 get_flowData
 * 工具,清单须随消息下发,否则模型按红线拒工(2026-08-22 实证:拒生成并索取 assets 数据)。
 */
function buildAssetsInventory(
  store: StudioStore,
  episodeId: string,
): string {
  // D3(10-13-audit4-downstream):删 `?? store.entityExtractions[0]` 跨章回退——
  // 别章资产冒充本章在册清单会让模型引用不存在的本章资产;调用方已加「本章无
  // 提取 → 提示先提取并中止」门禁,此处只认本章批次。
  const batch = store.entityExtractions.find((item) => item.episodeId === episodeId);
  if (!batch) return "";
  const lines: string[] = [];
  const roles = batch.characters.flatMap((item) => [item.name, ...item.aliases]).filter(Boolean);
  const scenes = batch.scenes.map((item) => item.name).filter(Boolean);
  const props = batch.props.map((item) => item.name).filter(Boolean);
  if (roles.length) lines.push(`- 角色：${[...new Set(roles)].join("；")}`);
  if (scenes.length) lines.push(`- 场景：${[...new Set(scenes)].join("；")}`);
  if (props.length) lines.push(`- 道具：${[...new Set(props)].join("；")}`);
  return lines.join("\n");
}
