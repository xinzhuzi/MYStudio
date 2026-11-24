import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { createBatchFailureReporter } from "../batch-failure-toast";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
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
} from "@/lib/comfyui/storyboard/storyboard-batch-engine-queue";
import {
  STORYBOARD_BATCH_DEGRADED_RESOLUTION,
  STORYBOARD_BATCH_SHOT_INTERVAL_MS,
  createStoryboardBatchInterruptibleDelay,
  resolveStoryboardBatchQueueChannel,
  runStoryboardBatchLadder,
} from "./storyboard-batch-protocols";
import type { StoryboardItem } from "@/types/studio";
import {
  countMissingFrames,
  finalizeRecoveredShot,
  BatchSourceChangedError,
  createBatchSourceGuards,
  generateOneShot,
} from "./storyboard-batch-generation-engine";
export { countShotsNeedingBatchGeneration } from "./storyboard-batch-generation-engine";

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

  const start = useCallback((options?: { forceRegenerate?: boolean; onlyShotId?: string }) => {
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
    // 1120 单镜重出桥(kind=generate-shot-image,note=shotId):onlyShotId 把
    // 队列收敛到单镜,该镜按 force 语义重出(现画面入库为历史版本),其余镜零沾。
    // 与批量会话恒解耦(1120 复核⑤⑥修):①不受断点续跑游标裁剪——点名镜在
    // 游标之前也是合法重出对象(此前先按 cursor 裁再滤 onlyShotId,游标前的
    // 点名镜恒队空=误诊「镜不在当前章分镜」+僵尸会话跨重启永久阻塞);②不吞
    // 中断会话(不继承 priorDone/不覆写/不清场)——停批后重出一镜不再销毁余批
    // 的「继续生图」候选,进度/汇总 toast 只计本镜实际生成帧数。
    const forceRegenerate = options?.forceRegenerate === true;
    const onlyShotId = (options?.onlyShotId ?? "").trim() || null;
    const resumeRecord = persisted
      && persisted.episodeId === episodeId
      && persisted.projectId === projectId
      ? persisted
      : null;
    const fromShotIndex = resumeRecord && !onlyShotId ? resumeRecord.cursorShotIndex : 1;
    const eligible = storyboards.filter((item) => item.index >= fromShotIndex)
      .map((item) => useStudioStore.getState().storyboards.find((current) => current.id === item.id) ?? item);
    for (const shot of eligible) finalizeRecoveredShot(shot);
    // 1116 force-regen(全量重出):绕过缺帧过滤,已齐备镜也整队重生成——
    // missingFrames 记全帧数(与实际生成帧数一致,进度口径不虚)。
    const shotForce = forceRegenerate || Boolean(onlyShotId);
    const frameQueue = eligible
      .filter((item) => !onlyShotId || item.id === onlyShotId)
      .map((item) => ({
        shot: item,
        missingFrames: shotForce ? (item.keyframes?.length ?? 1) : countMissingFrames(item),
      }))
      .filter((entry) => shotForce || entry.missingFrames > 0)
      .sort((a, b) => a.shot.index - b.shot.index);
    const guards = createBatchSourceGuards(frameQueue.map(({ shot }) => shot));
    const priorDone = resumeRecord && !onlyShotId ? resumeRecord.doneFrames : 0;
    const totalFrames = priorDone + frameQueue.reduce((sum, entry) => sum + entry.missingFrames, 0);
    if (frameQueue.length === 0) {
      if (onlyShotId) {
        toast.error("单镜重出:镜不在当前章分镜(章/分片换代?请重开工作流)");
        return;
      }
      if (resumeRecord) useStoryboardBatchSessionStore.getState().clearStoryboardBatchSession();
      toast.info("所有分镜画面均已齐备");
      return;
    }
    runningRef.current = true;
    liveBatchRunning = true;
    stopRequestedRef.current = false;
    setState({ running: true, total: totalFrames, done: priorDone, failed: 0, currentShotIndex: frameQueue[0]!.shot.index });
    const sessionId = resumeRecord && !onlyShotId ? resumeRecord.sessionId : createStoryboardBatchSessionId();
    // 单镜重出零会话(1120 复核⑥修):不覆写持久化会话——旧 sessionId 复用+
    // done=priorDone 覆写会吞掉中断批量的续跑状态,自然完成清场=「继续生图」
    // 候选被销毁;游标推进/收尾清场同免(advance/interrupt/clear 全跳过)。
    if (!onlyShotId) {
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
    }
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
        const doneAtShotStart = done;
        const ladder = await runStoryboardBatchLadder({
          shouldAbort: () => stopRequestedRef.current,
          attempt: async (stage) => {
            try {
              guards.get(shot.id)!.assertCurrent();
                  await withPromptIdCapture(queueChannel, promptIdTracker, () =>
                    generateOneShot(shot, projectName, {
                      guard: guards.get(shot.id)!,
                      onFrameStart: (label) => setState((previous) => ({ ...previous, currentFrameLabel: label })),
                      onFrameDone: () => { done += 1; setState((previous) => ({ ...previous, done: done + failed })); },
                      degradedResolution: stage === "degraded" ? STORYBOARD_BATCH_DEGRADED_RESOLUTION : undefined,
                      // 1120 复核⑦修:实参改 shotForce(onlyShotId-only 调用原本
                      // 传 false)——计数层按全帧数入队而生成层按 frameNeedsGeneration
                      // 过滤,已有图帧不重出+done 补差到全帧数=toast 虚报;force
                      // 语义(现画面入库为历史版本)与桥/钩注释承诺对齐。
                      forceRegenerate: shotForce,
                    }));
            } catch (error) {
              if (error instanceof BatchSourceChangedError) stopRequestedRef.current = true;
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
          // 1117 残项④:onFrameDone 已逐帧 +1,整镜聚合改为补差防双计
          // (阶梯重试场景帧回调可能缺席;补差= max(0, missing-已计))。
          const counted = done - doneAtShotStart;
          if (counted < entry.missingFrames) done += entry.missingFrames - counted;
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
        // 游标推进:下一队列镜(尾镜后=本镜+1,续跑即空→清会话);单镜重出零会话
        // (1120 复核⑥修)——游标倒退到点名镜会污染中断批量的续跑起点。
        if (!onlyShotId) {
          const nextCursor = ladder.aborted && !ladder.ok
            ? shot.index
            : frameQueue[queuePosition + 1]?.shot.index ?? shot.index + 1;
          useStoryboardBatchSessionStore.getState().advanceStoryboardBatchSession({
            cursorShotIndex: nextCursor,
            doneFrames: done,
            failedFrames: failed,
          });
        }
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
      // 单镜重出零会话(1120 复核⑥):interrupt/clear 全跳过——自然完成清场会
      // 销毁中断批量的续跑状态,中断落盘会污染批量游标。
      if (!onlyShotId) {
        if (stopped) {
          useStoryboardBatchSessionStore.getState().interruptStoryboardBatchSession();
        } else {
          useStoryboardBatchSessionStore.getState().clearStoryboardBatchSession();
        }
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

/** Execute one shot through the same source guards and frame finalization as batch.
 * Does not enter the batch retry ladder or queue lifecycle. Per-frame production
 * review/retry gates remain intact; callers enforce any narrower request budget.
 */
export async function runStoryboardSingleShotOnce(shot: StoryboardItem, projectName: string): Promise<void> {
  if (liveBatchRunning) throw new Error("分镜生成正在执行");
  const guard = createBatchSourceGuards([shot]).get(shot.id)!;
  guard.assertCurrent();
  liveBatchRunning = true;
  try {
    await generateOneShot(shot, projectName, { guard });
  } finally {
    liveBatchRunning = false;
  }
}
