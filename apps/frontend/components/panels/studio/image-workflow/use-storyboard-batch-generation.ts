import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createBatchFailureReporter } from "../batch-failure-toast";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { buildStoryboardImageWorkflowPatch } from "@/lib/studio/image-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import {
  createStoryboardBatchSessionId,
  useStoryboardBatchSessionStore,
} from "@/stores/studio/storyboard-batch-session-store";
import {
  createStoryboardBatchPromptIdTracker,
  diffNewPendingPromptIds,
  stopStoryboardBatchQueuedJobs,
  type StoryboardBatchEngineQueueChannel,
} from "@/lib/assist/image-studio/storyboard-batch-engine-queue";
import {
  STORYBOARD_BATCH_DEGRADED_RESOLUTION,
  STORYBOARD_BATCH_SHOT_INTERVAL_MS,
  createStoryboardBatchInterruptibleDelay,
  resolveStoryboardBatchQueueChannel,
  runStoryboardBatchLadder,
} from "./storyboard-batch-protocols";
import type { StoryboardItem } from "@/types/studio";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import { buildStoryboardItemOpenContext } from "../storyboard-open-context";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import {
  createOpenImageWorkflowGraph,
  ensureStoryboardAssetReferences,
  healStoryboardPromptForCast,
  findStoryboardWorkflowForContext,
  resolveOpenContextGeneratedNodeId,
} from "./image-workflow-graph-utils";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";
import { landStoryboardContinuity } from "./land-continuity";

export interface StoryboardBatchGenerationState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** 当前正在生成的镜序号(index),null=未在运行 */
  currentShotIndex: number | null;
  /** M3a:当前帧标签(多帧镜如 "S12-KF2"),单帧镜缺省 */
  currentFrameLabel?: string;
}

/** 中断续跑候选(持久化会话命中当前章,UI 显示「继续生图」)。 */
export interface StoryboardBatchResumeInfo {
  /** 游标镜号(从该镜起继续)。 */
  shotIndex: number;
  /** 游标之后仍缺图的帧数。 */
  remainingFrames: number;
}

const IDLE_BATCH_STATE: StoryboardBatchGenerationState = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  currentShotIndex: null,
};

/**
 * 批量存活标记(模块级):面板重挂载会重置 hook 内 runningRef,但批量闭包
 * 仍在跑(store 直写不依赖挂载)——模块级标记挡住重挂实例的二次启动。
 */
let liveBatchRunning = false;

/**
 * 分镜面板「一键生图」串行批量(Trellis 08-24-storyboard-panel-batch-generate):
 * 未生成镜(mediaRef 非 image)按 index 升序逐镜执行——找/建分镜工作流
 * (黄金公式全装配,与单镜打开同口径)→生图核心→回写分镜 mediaRef。
 *
 * 09-15 P3 批量队列四协议(TRE-MAN 吸收,仿设计零拷贝):
 * 1. 断点续跑——镜号游标随批量推进落盘(storyboard-batch-session-store),
 *    中断(用户停止/应用退出)后重入=从游标镜继续,已完成镜按既有
 *    mediaRef 幂等口径跳过(指纹命中),游标前的失败镜不重试;
 * 2. 间隔节流——逐镜提交间隔 STORYBOARD_BATCH_SHOT_INTERVAL_MS(可注入),
 *    停止时立即取消延时,零残留 timer;
 * 3. 精确停队——每次提交前后差分引擎 /queue 快照归因本会话 prompt_id,
 *    停止/收尾时仅 DELETE 本会话仍在排队的项,他人任务零触碰;
 * 4. 失败回退阶梯——原样 → 原样重试 → 降载降分辨率(1K) → 放弃,
 *    三败才记一次失败并入汇总 toast(重试过程不打扰用户)。
 *
 * 长任务纪律不变:无模态、失败汇总不轰炸、面板卸载不中止。
 */
export function useStoryboardBatchGeneration(input: {
  storyboards: StoryboardItem[];
  projectName: string;
  /** 逐镜提交间隔毫秒(缺省=保守常量;测试注入 0 跳过)。 */
  submitIntervalMs?: number;
  /** 引擎队列通道注入(缺省=生产解析;测试 mock 用)。 */
  queueChannel?: StoryboardBatchEngineQueueChannel;
}) {
  const [state, setState] = useState<StoryboardBatchGenerationState>(IDLE_BATCH_STATE);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const delayRef = useRef<ReturnType<typeof createStoryboardBatchInterruptibleDelay> | null>(null);
  const { storyboards, projectName } = input;

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRequestedRef.current = true;
    // 间隔节流立即中断(等待中的延时取消,零残留 timer);
    // 重试阶梯在段间自行退出;当前镜生成完成本身后收尾。
    delayRef.current?.cancel();
    toast.info("停止中:当前分镜完成后停下");
  }, []);

  const start = useCallback(() => {
    if (runningRef.current || liveBatchRunning) return;
    // 队列快照:执行期不重算(中途已生成的不重复;外部并发写入按镜级幂等收敛)。
    // M3a:计数单位改帧——单帧镜(无 keyframes)=1 帧缺图即入队;多帧镜按缺图帧数计
    //
    // 断点续跑:持久化会话命中当前项目+章(上一轮停止/应用退出遗留,含 running
    // 态——进程终止没机会落 interrupted,重挂后一律视为可续)→ 从游标镜起排队;
    // 游标之前缺图的镜(上轮已三败放弃)不再重试。
    const episodeId = storyboards.find((item) => item.episodeId)?.episodeId ?? "";
    const projectId = useProjectStore.getState().activeProjectId ?? "";
    const persisted = useStoryboardBatchSessionStore.getState().session;
    const resumeRecord = persisted
      && persisted.episodeId === episodeId
      && persisted.projectId === projectId
      ? persisted
      : null;
    const fromShotIndex = resumeRecord ? resumeRecord.cursorShotIndex : 1;
    const frameQueue = storyboards
      .filter((item) => item.index >= fromShotIndex)
      .map((item) => ({ shot: item, missingFrames: countMissingFrames(item) }))
      .filter((entry) => entry.missingFrames > 0)
      .sort((a, b) => a.shot.index - b.shot.index);
    const priorDone = resumeRecord ? resumeRecord.doneFrames : 0;
    const totalFrames = priorDone + frameQueue.reduce((sum, entry) => sum + entry.missingFrames, 0);
    if (frameQueue.length === 0) {
      if (resumeRecord) useStoryboardBatchSessionStore.getState().clearStoryboardBatchSession();
      toast.info("所有分镜画面均已齐备");
      return;
    }
    runningRef.current = true;
    liveBatchRunning = true;
    stopRequestedRef.current = false;
    setState({ running: true, total: totalFrames, done: priorDone, failed: 0, currentShotIndex: frameQueue[0]!.shot.index });
    const sessionId = resumeRecord?.sessionId ?? createStoryboardBatchSessionId();
    useStoryboardBatchSessionStore.getState().beginStoryboardBatchSession({
      sessionId,
      projectId,
      episodeId,
      cursorShotIndex: frameQueue[0]!.shot.index,
      totalFrames,
      doneFrames: priorDone,
      failedFrames: 0,
      status: "running",
    });
    // 批量生命周期入诊断日志(2026-08-25 补齐: 此前只有 4s 即逝的 toast,单镜失败
    // 原因/批量汇总对 diagnostics 完全不可见,排障只能 CDP 抓 DOM——实弹踩坑)
    const batchOperationId = createOperationId("storyboard-batch-generate");
    void logEvent({
      level: "info",
      category: "ai",
      operationId: batchOperationId,
      message: "Storyboard batch generation started",
      context: {
        queueShots: frameQueue.length,
        totalFrames,
        firstShotIndex: frameQueue[0]!.shot.index,
        resumedFromShotIndex: resumeRecord ? fromShotIndex : null,
        sessionId,
      },
    });
    const submitIntervalMs = input.submitIntervalMs ?? STORYBOARD_BATCH_SHOT_INTERVAL_MS;

    void (async () => {
      // 精确停队通道:注入优先,生产解析(引擎未跑/非桌面 → undefined,协议降级)
      let queueChannel: StoryboardBatchEngineQueueChannel | undefined;
      try {
        queueChannel = input.queueChannel ?? await resolveStoryboardBatchQueueChannel();
      } catch {
        queueChannel = undefined;
      }
      // 间隔节流(可中断):停止时 cancel,等待立即返回 false
      const delay = createStoryboardBatchInterruptibleDelay(() => stopRequestedRef.current);
      delayRef.current = delay;
      let done = priorDone;
      let failed = 0;
      // 同因失败合并计数(同一 toast 刷新「N 个分镜失败」),避免批量失败弹一摞复读弹窗;
      // 仅阶梯走满的三败才上报——重试过程不出声
      const failureReporter = createBatchFailureReporter("分镜");
      // 本会话 prompt_id 集合(差分归因记录,停止时精确撤回)
      const promptIdTracker = createStoryboardBatchPromptIdTracker();

      for (let queuePosition = 0; queuePosition < frameQueue.length; queuePosition += 1) {
        const entry = frameQueue[queuePosition]!;
        if (stopRequestedRef.current) break;
        // 间隔节流:镜与镜之间等间隔(首镜直发);停止=立即中断不残留
        if (queuePosition > 0) {
          const elapsed = await delay.wait(submitIntervalMs);
          if (!elapsed) break;
        }
        const shot = entry.shot;
        setState((previous) => ({ ...previous, currentShotIndex: shot.index }));
        const ladder = await runStoryboardBatchLadder({
          shouldAbort: () => stopRequestedRef.current,
          attempt: async (stage) => {
            try {
              await withPromptIdCapture(queueChannel, promptIdTracker, () =>
                generateOneShot(shot, projectName, {
                  onFrameStart: (label) => setState((previous) => ({ ...previous, currentFrameLabel: label })),
                  degradedResolution: stage === "degraded" ? STORYBOARD_BATCH_DEGRADED_RESOLUTION : undefined,
                }));
            } catch (error) {
              // 阶梯段失败入诊断日志(重试不出声打扰用户,但排障要可见)
              void logEvent({
                level: "warn",
                category: "ai",
                operationId: batchOperationId,
                message: "Storyboard batch ladder attempt failed",
                context: {
                  shotIndex: shot.index,
                  stage,
                  reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
                },
              });
              throw error;
            }
          },
        });
        if (ladder.ok) {
          done += entry.missingFrames;
          void logEvent({
            level: "info",
            category: "ai",
            operationId: batchOperationId,
            message: "Storyboard batch shot generated",
            context: { shotIndex: shot.index, frames: entry.missingFrames, done, failed, storyboardId: shot.id },
          });
        } else if (ladder.aborted && ladder.stagesRun.length === 0) {
          // 停止落在间隔后、首段前:本镜零尝试,纯退出
          break;
        } else {
          failed += 1;
          const reason = ladder.error instanceof Error ? ladder.error.message : "生成失败";
          void logEvent({
            level: "warn",
            category: "ai",
            operationId: batchOperationId,
            message: "Storyboard batch shot failed",
            context: { shotIndex: shot.index, done, failed, reason: reason.slice(0, 300), stagesRun: ladder.stagesRun },
          });
          // 三败才报告:中止退出(用户停止)不上报,只在停止汇总里计剩余
          if (!ladder.aborted) {
            failureReporter.report(`分镜 ${shot.index}`, reason);
          }
        }
        // 游标推进:下一队列镜(尾镜后=本镜+1,续跑即空→清会话)
        const nextCursor = frameQueue[queuePosition + 1]?.shot.index ?? shot.index + 1;
        useStoryboardBatchSessionStore.getState().advanceStoryboardBatchSession({
          cursorShotIndex: nextCursor,
          doneFrames: done,
          failedFrames: failed,
        });
        setState((previous) => ({ ...previous, done: done + failed, failed, currentFrameLabel: undefined }));
      }
      // 收尾:间隔窗残留防御性清理(停止恰好落在等待返回之后)
      delay.cancel();
      delayRef.current = null;
      // 精确停队:只 DELETE 本会话记录过且仍在排队的项(他人任务零触碰);
      // 自然完成也收尾——超时遗留的本会话僵尸排队项一并撤回
      let recalledCount = 0;
      if (queueChannel) {
        const stopOutcome = await stopStoryboardBatchQueuedJobs(promptIdTracker, queueChannel);
        recalledCount = stopOutcome.deletedPromptIds.length;
        if (recalledCount > 0 || stopOutcome.error) {
          void logEvent({
            level: stopOutcome.error ? "warn" : "info",
            category: "ai",
            operationId: batchOperationId,
            message: "Storyboard batch precise queue stop",
            context: {
              deletedPromptIds: stopOutcome.deletedPromptIds,
              runningPromptIds: stopOutcome.runningPromptIds,
              error: stopOutcome.error ?? null,
            },
          });
        }
      }
      runningRef.current = false;
      liveBatchRunning = false;
      setState((previous) => ({ ...previous, running: false, currentShotIndex: null }));
      const stopped = stopRequestedRef.current;
      if (stopped) {
        useStoryboardBatchSessionStore.getState().interruptStoryboardBatchSession();
      } else {
        useStoryboardBatchSessionStore.getState().clearStoryboardBatchSession();
      }
      void logEvent({
        level: failed > 0 ? "warn" : "info",
        category: "ai",
        operationId: batchOperationId,
        message: "Storyboard batch generation finished",
        context: {
          succeeded: done,
          failed,
          remaining: totalFrames - done - failed,
          stopped,
          recalledQueueItems: recalledCount,
        },
      });
      if (stopped) {
        toast.info(
          `已停止：成功 ${done} 帧 · 失败 ${failed} · 剩余 ${totalFrames - done - failed} 帧`
          + (recalledCount > 0 ? ` · 已撤回排队 ${recalledCount} 张` : ""),
        );
      } else {
        toast.success(`一键生图完成：成功 ${done} 帧${failed ? ` · 失败 ${failed}` : ""}`);
      }
    })();
  }, [projectName, storyboards, input.submitIntervalMs, input.queueChannel]);

  // 断点续跑候选:持久化中断会话命中当前项目+章且游标后仍有缺图帧
  const persistedSession = useStoryboardBatchSessionStore((store) => store.session);
  const resumable = useMemo<StoryboardBatchResumeInfo | null>(() => {
    if (state.running || !persistedSession) return null;
    const episodeId = storyboards.find((item) => item.episodeId)?.episodeId;
    if (!episodeId || persistedSession.episodeId !== episodeId) return null;
    if (persistedSession.projectId !== (useProjectStore.getState().activeProjectId ?? "")) return null;
    const remainingFrames = storyboards
      .filter((item) => item.index >= persistedSession.cursorShotIndex)
      .reduce((sum, item) => sum + countMissingFrames(item), 0);
    if (remainingFrames <= 0) return null;
    return { shotIndex: persistedSession.cursorShotIndex, remainingFrames };
  }, [persistedSession, storyboards, state.running]);

  return { state, start, stop, resumable };
}

/**
 * 提交前后引擎 /queue 快照差分:新增 pending 编号归因本会话并记录(精确
 * 停队的集合来源)。仅失败提交做后置快照——成功意味着任务已离队,无需记录。
 * 快照失败静默跳过(队列观测不打断生图主链)。
 */
async function withPromptIdCapture(
  channel: StoryboardBatchEngineQueueChannel | undefined,
  tracker: ReturnType<typeof createStoryboardBatchPromptIdTracker>,
  run: () => Promise<void>,
): Promise<void> {
  if (!channel) return run();
  const before = await channel.getQueue().catch(() => null);
  try {
    await run();
  } catch (error) {
    const after = await channel.getQueue().catch(() => null);
    if (before && after) {
      const newIds = diffNewPendingPromptIds(before, after);
      if (newIds.length > 0) tracker.record(newIds);
    }
    throw error;
  }
}

/** M3a:缺帧计数——单帧镜无图=1;多帧镜=空槽帧数(mediaRef 缺图视为首帧空) */
function countMissingFrames(shot: StoryboardItem): number {
  if (!shot.keyframes?.length) {
    return shot.mediaRef?.kind === "image" && shot.mediaRef.path ? 0 : 1;
  }
  return shot.keyframes.filter((frame) => !frame.mediaRef?.path).length;
}


/** VLM 视觉一致性审核:成图 vs 资产参考图(fail-open,模型未装=null 跳过)。 */
async function reviewFrame(
  imageUrl: string,
  shot: StoryboardItem,
): Promise<VlmReviewArtifactV1 | null> {
  const bridge = typeof window !== "undefined" ? window.vlmReview : undefined;
  if (!bridge?.run) return null;
  try {
    const probe = await bridge.probe();
    if (probe.status !== "ready") return null;
    const referenceImages = (shot.orderedReferenceManifest ?? [])
      .filter((ref) => ref.imagePath)
      .map((ref) => ({
        path: ref.imagePath!,
        role: ((ref.assetKind as string) ?? "character") as "scene" | "character" | "prop",
        assetName: ref.assetName ?? ref.assetId,
      }));
    if (referenceImages.length === 0) return null;
    const artifact = await bridge.run({
      schemaVersion: 1,
      projectId: useProjectStore.getState().activeProjectId ?? "unknown",
      shotId: shot.id,
      generatedImagePath: imageUrl,
      referenceImages,
      expectedContent: shot.videoDesc || shot.prompt || "",
      expectedCharacters: shot.associateAssetsNames ?? [],
    });
    // R20 盲区可视化(08-28):VLM 只查「挂了参考的角色」,无参考角色(群演/孩童/
    // 妇人等无资产条目者)静默放行。计算未覆盖名单写入工件随 vlmReview 落库
    // (审核面板可见)+ diagnostics 留痕——不改 fail-open 语义,只把盲区变可见。
    const uncoveredCharacters = (shot.associateAssetsNames ?? []).filter(
      (name) => name && !referenceImages.some((ref) => {
        const refName = ref.assetName ?? "";
        return refName.includes(name) || name.includes(refName.split(/[;；]/)[0] ?? "");
      }),
    );
    if (uncoveredCharacters.length > 0) {
      void logEvent({
        level: "warn",
        category: "ai",
        operationId: createOperationId("vlm-review-uncovered"),
        message: "VLM 审核存在无参考角色盲区(该角色不在校验范围)",
        context: { shotId: shot.id, uncoveredCharacters },
      });
    }
    return { ...artifact, uncoveredCharacters };
  } catch {
    return null;
  }
}

const VLM_MAX_RETRIES = 1;

/** 生成+VLM审核循环:通过=返回 / rejected=重生一次 / 两次rejected=抛错。 */
async function generateWithVlmReview(
  graph: NonNullable<ReturnType<typeof findStoryboardWorkflowForContext>>,
  targetNodeId: string,
  shot: StoryboardItem,
  opts: {
    addMaterial: ReturnType<typeof useStudioStore.getState>["addMaterial"];
    /** 失败回退阶梯第三段:降载降分辨率(缺省=不降)。 */
    degradedResolution?: string;
  },
): Promise<{ imageUrl: string; vlmStatus: string | null; vlmArtifact?: VlmReviewArtifactV1 }> {
  for (let attempt = 0; attempt <= VLM_MAX_RETRIES; attempt++) {
    const { imageUrl } = await runImageWorkflowNodeGeneration(graph, targetNodeId, {
      addMaterial: opts.addMaterial,
      degradedResolution: opts.degradedResolution,
    });
    if (!imageUrl) throw new Error("生成结果为空");
    const artifact = await reviewFrame(imageUrl, shot);
    if (!artifact || artifact.status !== "rejected") {
      return { imageUrl, vlmStatus: artifact?.status ?? null, vlmArtifact: artifact ?? undefined };
    }
    if (attempt === VLM_MAX_RETRIES) {
      throw new Error(`VLM 审核不通过:${(artifact.reasons ?? []).join(";").slice(0, 120)}`);
    }
  }
  throw new Error("VLM 审核不通过");
}

/**
 * 单镜执行:找既有分镜工作流(打开链同口径匹配)→无则全装配建流→生图→回写分镜。
 * M3a 多帧:按 frameId 序逐帧串行生成(帧间链 gen(k-1)→gen(k) 自动喂上一帧
 * 成图作连贯参考),每帧即时回写 keyframes(reason="generate");单帧镜走原路径。
 */
async function generateOneShot(
  shot: StoryboardItem,
  projectName: string,
  hooks?: {
    onFrameStart?: (label: string) => void;
    /** 失败回退阶梯第三段:降载降分辨率(缺省=不降)。 */
    degradedResolution?: string;
  },
): Promise<void> {
  const context = buildStoryboardItemOpenContext(shot);
  const store = useStudioStore.getState();
  // 身份防线:择优复用(有参考节点的旧代/新代并存时优先带参考者),
  // 选中者无参考而分镜带资产清单→重解析补挂(S08 实证:空参考会让
  // 模型自由发挥角色形象,监工被画成主角剑客相)
  let graph = findStoryboardWorkflowForContext(store.imageWorkflows, context);
  if (!graph) {
    const assetReferences = await resolveStoryboardAssetReferences(shot).catch(() => []);
    graph = createOpenImageWorkflowGraph({ ...context, assetReferences }, projectName);
    useStudioStore.getState().upsertImageWorkflow(graph);
  } else {
    // 存量流自愈(08-29):R21 复用机制下,修复前建的老流构图段仍是双人约束
    // (S07 实证 4 人镜被逼出 5 人)——重生前按画面人数补跑自适应,幂等
    const healed = healStoryboardPromptForCast(
      graph,
      (shot.shotSemantics?.visibleCharacters ?? []).map((character) => character.name),
      [shot.videoDesc, shot.prompt, shot.lines].filter(Boolean).join("\n"),
    );
    if (healed !== graph) {
      useStudioStore.getState().upsertImageWorkflow(healed);
      graph = healed;
    }
    if (!graph.nodes.some((node) => node.type === "reference")) {
      const references = await resolveStoryboardAssetReferences(shot).catch(() => []);
      const ensured = ensureStoryboardAssetReferences(graph, references);
      if (ensured !== graph) {
        useStudioStore.getState().upsertImageWorkflow(ensured);
        graph = ensured;
      }
    }
  }
  const targetNodeId = resolveOpenContextGeneratedNodeId(graph, context)
    ?? graph.nodes.find((node) => node.type === "generated")?.id;
  if (!targetNodeId) {
    throw new Error("工作流缺少成图节点");
  }
  // M3a 多帧:按帧串行生成并逐帧回写;帧间链要求顺序执行,中途失败抛错由批次层记录
  const emptyFrames = (shot.keyframes ?? []).filter((frame) => !frame.mediaRef?.path);
  if (emptyFrames.length > 0) {
    for (const frame of emptyFrames) {
      hooks?.onFrameStart?.(`S${String(shot.index).padStart(2, "0")}-${frame.frameId.slice(-3)}`);
      const frameNodeId = graph.nodes.find(
        (node) => node.type === "generated" && (node as { frameId?: string }).frameId === frame.frameId,
      )?.id;
      if (!frameNodeId) {
        throw new Error(`工作流缺少帧节点 ${frame.frameId}(请重新进入该镜图片工作流建流)`);
      }
      await runFrameGenerationAndWriteback(graph, shot, frame, frameNodeId, hooks?.degradedResolution);
    }
    return;
  }
  // 生成前预检(不烧配额,08-24 装配门禁链收口): ①file:// 参考探活——经资产桥
  // 轻读一次(读完即弃,不驻留 data: 防 OOM),断链(资产改名/文件损坏)在装配后
  // 秒级可见,而非生成中「参考图无法解码」烧一次等待;②长度门前置——正文超
  // 800 直接拒,提示精炼而非让编译器在网络前才拦
  const assetBridge = getStudioAssetsBridge();
  for (const node of graph.nodes) {
    if (node.type !== "reference") continue;
    const url = node.imageUrl ?? "";
    const assetId = node.source?.kind === "asset" ? node.source.id : undefined;
    if (!url.startsWith("file://") || !assetId || !assetBridge?.readImageDataUrl) continue;
    const alive = await assetBridge.readImageDataUrl(assetId).then(() => true).catch(() => false);
    if (!alive) {
      throw new Error(`参考图[${node.title ?? "未命名"}]无法读取(资产可能已改名或损坏),请重建参考`);
    }
  }
  const promptLength = graph.nodes.find((node) => node.type === "prompt")?.prompt?.length ?? 0;
  if (promptLength > 800) {
    throw new Error(`提示词 ${promptLength} 字符超 800 正文门,需精炼后再生成`);
  }
  const { imageUrl, vlmArtifact } = await generateWithVlmReview(graph, targetNodeId, shot, {
    addMaterial: useStudioStore.getState().addMaterial,
    degradedResolution: hooks?.degradedResolution,
  });
  if (!imageUrl) throw new Error("生成结果为空");
  // 分镜回写:核心函数已 upsert 含 resultUrl 的最新代图,直接组 patch
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  // 连续性接线(方案 2):媒体落库前先落三件套,图的 freshWrite 会顺带清
  // sourceChanged 的 stale 标记;前置不满足时静默跳过,不阻塞生图主链
  landStoryboardContinuity(shot.id, latest.id, targetNodeId);
  const patch = buildStoryboardImageWorkflowPatch(latest, targetNodeId);
  useStudioStore.getState().updateStoryboard(shot.id, patch);
  if (vlmArtifact) useStudioStore.getState().writeStoryboardVlmReview(shot.id, {
    ...vlmArtifact,
    generatedAt: vlmArtifact.generatedAt || Date.now(),
  }, imageUrl);
}


/** M3a:单帧生成+回写(多帧路径复用;预检同单帧口径) */
async function runFrameGenerationAndWriteback(
  graph: ReturnType<typeof findStoryboardWorkflowForContext> extends infer T ? NonNullable<T> : never,
  shot: StoryboardItem,
  frame: NonNullable<StoryboardItem["keyframes"]>[number],
  frameNodeId: string,
  degradedResolution?: string,
): Promise<void> {
  const { imageUrl, vlmArtifact } = await generateWithVlmReview(graph, frameNodeId, shot, {
    addMaterial: useStudioStore.getState().addMaterial,
    degradedResolution,
  });
  if (!imageUrl) throw new Error("生成结果为空");
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  landStoryboardContinuity(shot.id, latest.id, frameNodeId);
  const node = latest.nodes.find((item) => item.id === frameNodeId);
  const frameMediaRef = {
    kind: "image" as const,
    path: imageUrl,
    imageWorkflowId: latest.id,
    imageWorkflowNodeId: frameNodeId,
  };
  // 增量回写必须以 store 现势为基(批次快照里的 shot.keyframes 是旧值,
  // 直接在其上映射会丢掉前几帧已落的写入——多帧串行实测坑)
  const liveFrames = useStudioStore.getState().storyboards.find((item) => item.id === shot.id)?.keyframes
    ?? shot.keyframes
    ?? [];
  const updatedFrames = liveFrames.map((candidate) =>
    candidate.frameId === frame.frameId
      ? { ...candidate, mediaRef: frameMediaRef }
      : candidate,
  );
  useStudioStore.getState().setStoryboardKeyframes(shot.id, updatedFrames, "generate");
  if (vlmArtifact) useStudioStore.getState().writeStoryboardVlmReview(shot.id, {
    ...vlmArtifact,
    generatedAt: vlmArtifact.generatedAt || Date.now(),
  }, imageUrl);
  void node;
}
