// 10-27 分镜H3双通道 P2a(PRD 10-27-storyboard-h3-dual-channel §5.4/§5.5):
// 「H3 出片」批量器——串行逐镜(读首帧 b64→组装器 API 档→sidecar /comfy/execute
// →writeback 回收轮询落位),断点续跑跳过上轮失败镜(C4),失败二分类(引擎失败
// 不重掷/回收失败仅重试消费),软停(当前镜跑完并回收——已烧 GPU 不浪费;Q2 硬
// cancel 为实施偏离:渲染层直连引擎受 CORS 不定+sidecar 无 job cancel 转发,二期
// 随引擎直连通道补),防休眠桥在批量边界开停(N3),MPS 耗时漂移监测(N4),
// 发车摘要禁静默跳过(N2/C6),收尾 toast 指路预看验收(N10)。
// 单镜重生成(runStoryboardH3ShotVideo,D6)=同组装+执行+回收函数的 force 路径。
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { buildShotH3ApiWorkflow } from "@/lib/assist/image-studio/h3-shot-video-workflow";
import { batchDispatchableH3Recipes, type H3ResolutionTier } from "@/lib/assist/image-studio/h3-workflow-recipes";
import { dialogueAudioPolicy } from "@/lib/assist/image-studio/h3-shot-prompt";
import { comfySidecarJson, type ComfyExecuteJobReply } from "@/lib/assist/image-studio/comfy-execute";
import { consumeComfyBridgeWritebacks } from "@/lib/assist/image-studio/comfy-bridge-writeback-consumer";
import { readStoryboardImageB64 } from "@/lib/assist/image-studio/storyboard-overview-sync";
import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import {
  useStoryboardH3VideoSessionStore,
  createStoryboardH3VideoSessionId,
} from "@/stores/studio/storyboard-h3-video-session-store";
import type { StoryboardItem } from "@/types/studio";

export interface StoryboardH3VideoBatchState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** 当前正在生成的镜序号(index),null=未在运行 */
  currentShotIndex: number | null;
}

const IDLE_STATE: StoryboardH3VideoBatchState = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  currentShotIndex: null,
};

/** 批量存活标记(模块级):面板重挂载重置 hook 内 runningRef,批量闭包仍在跑——
 *  挡住重挂实例的二次启动(照批量生图线范式)。 */
let liveH3BatchRunning = false;

/** 档位执行超时秒(PRD D2:480P 全链≈334s 留裕量;960P 21min+冷启 4min)。 */
const TIER_TIMEOUT_S: Record<H3ResolutionTier, number> = { "480p": 900, "960p": 2700 };
/** job 轮询间隔/回收轮询窗(PRD §5.4:回收 60s 窗每 5s)。 */
const JOB_POLL_INTERVAL_MS = 5_000;
const RECLAIM_WINDOW_MS = 60_000;
const RECLAIM_POLL_INTERVAL_MS = 5_000;
/** 超 15s 镜按 362 帧封顶截断(§二 Q1)——发车摘要列示用。 */
const SHOT_SECONDS_CAP = 15;

export interface StoryboardH3VideoBatchPlan {
  /** 可派发镜(本章有首帧 mediaRef=image 且非 video),按 index 升序 */
  candidates: StoryboardItem[];
  /** 缺首帧镜数(候选排除,N2 摘要) */
  missingFrameCount: number;
  /** 超 15s 被截断的镜(index 列表,C6 摘要) */
  truncatedShotIndexes: number[];
  /** 已是 video 的镜(幂等跳过,不计缺帧) */
  alreadyVideoCount: number;
}

/** 发车计划纯函数(面板确认对话 N1/N2/C6 的数据源)。 */
export function planStoryboardH3VideoBatch(storyboards: StoryboardItem[]): StoryboardH3VideoBatchPlan {
  const candidates = storyboards
    .filter((item) => item.mediaRef?.kind === "image" && item.mediaRef.path)
    .sort((a, b) => a.index - b.index);
  const missingFrameCount = storyboards.filter((item) => item.mediaRef?.kind !== "video" && item.mediaRef?.kind !== "image").length;
  const alreadyVideoCount = storyboards.filter((item) => item.mediaRef?.kind === "video").length;
  const truncatedShotIndexes = candidates
    .filter((item) => (item.durationTarget ?? item.duration) > SHOT_SECONDS_CAP)
    .map((item) => item.index);
  return { candidates, missingFrameCount, alreadyVideoCount, truncatedShotIndexes };
}

/** 自实现执行+轮询(带软停检查;不外抛取消):job error 抛大白话由调用方分类。 */
async function executeShotWorkflow(input: {
  apiGraph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  extraPngInfo: Record<string, unknown>;
  images: Array<{ key: string; name: string; b64: string }>;
  timeoutS: number;
}): Promise<void> {
  const { jobId } = await comfySidecarJson<{ jobId: string }>("POST", "/comfy/execute", {
    body: {
      graph: input.apiGraph,
      inputs: { strings: {}, images: input.images },
      timeoutS: input.timeoutS,
      extraPngInfo: input.extraPngInfo,
    } as unknown as Record<string, unknown>,
    timeoutMs: 20_000,
  });
  const deadline = Date.now() + input.timeoutS * 1000 + 30_000;
  for (;;) {
    const job = await comfySidecarJson<ComfyExecuteJobReply>(
      "GET",
      `/comfy/jobs/${encodeURIComponent(jobId)}`,
      { timeoutMs: 10_000 },
    );
    if (job.status === "error") throw new Error(job.error || job.message || "ComfyUI 执行失败");
    if (job.status === "complete") return;
    if (Date.now() >= deadline) throw new Error(`ComfyUI 执行超时(${input.timeoutS} 秒),请检查引擎队列后重试`);
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

/** 回收轮询:60s 窗内反复消费收件箱,直到 store 到账(T5 判据=candidates 新增或
 *  outputVersion+1;禁只看 mediaRef kind——force 路径恒为 video 会假阳性)。 */
async function reclaimShotVideo(input: {
  shotId: string;
  baselineCandidateIds: Set<string>;
  baselineOutputVersion: number;
}): Promise<boolean> {
  const client = getComfyEngineClient();
  const deadline = Date.now() + RECLAIM_WINDOW_MS;
  while (Date.now() < deadline) {
    await consumeComfyBridgeWritebacks({ client });
    const state = useStudioStore.getState();
    const shot = state.storyboards.find((item) => item.id === input.shotId);
    if (shot) {
      const landed = state.videoCandidates.some(
        (entry) => entry.provider === "h3-comfyui" && entry.state === "ready"
          && entry.meta?.storyboardId === input.shotId
          && !input.baselineCandidateIds.has(entry.id),
      ) || (shot.outputVersion ?? 0) > input.baselineOutputVersion;
      if (landed) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, RECLAIM_POLL_INTERVAL_MS));
  }
  return false;
}

function snapshotShotBaseline(shotId: string): { baselineCandidateIds: Set<string>; baselineOutputVersion: number } {
  const state = useStudioStore.getState();
  const shot = state.storyboards.find((item) => item.id === shotId);
  return {
    baselineCandidateIds: new Set(
      state.videoCandidates.filter((entry) => entry.meta?.storyboardId === shotId).map((entry) => entry.id),
    ),
    baselineOutputVersion: shot?.outputVersion ?? 0,
  };
}

async function powerSaveStart(): Promise<void> {
  try {
    await window.h3BatchPowerSave?.start?.();
  } catch {
    // 防休眠桥不可用不阻断批量(旧 preload 在驾),仅失守休眠防线
  }
}

async function powerSaveStop(): Promise<void> {
  try {
    await window.h3BatchPowerSave?.stop?.();
  } catch {
    // 同上,收尾尽力而为
  }
}

/** 单镜执行+回收(批量循环与镜级 force 重生成共用真身)。
 *  失败分类抛出:kind="engine"(不重掷)/"reclaim"(仅重试消费过仍失败)/"assembled"(组装/自检门)。 */
export async function runStoryboardH3ShotVideoStep(input: {
  shot: StoryboardItem;
  tier: H3ResolutionTier;
  originProjectId: string;
}): Promise<void> {
  const shot = input.shot;
  if (shot.mediaRef?.kind !== "image" || !shot.mediaRef.path) {
    throw new Error(`分镜 ${shot.id} 缺少首帧画面,无法出片`);
  }
  const state = useStudioStore.getState();
  const chapter = state.novelChapters.find((item) => item.id === shot.episodeId);
  let firstFrameB64: string;
  try {
    firstFrameB64 = await readStoryboardImageB64(shot.mediaRef.path);
  } catch (error) {
    throw new Error(`读取首帧失败:${error instanceof Error ? error.message : String(error)}`);
  }
  const assembled = buildShotH3ApiWorkflow({
    shot,
    chapterId: shot.episodeId,
    chapterLabel: chapter?.title || shot.episodeId,
    policy: dialogueAudioPolicy(shot.lines),
    voiceMood: shot.emotion,
    originProjectId: input.originProjectId,
    firstFrameB64,
    resolutionTier: input.tier,
  });
  await executeShotWorkflow({
    apiGraph: assembled.apiGraph,
    extraPngInfo: assembled.uiWorkflow,
    images: assembled.images,
    timeoutS: TIER_TIMEOUT_S[input.tier],
  });
  const baseline = snapshotShotBaseline(shot.id);
  const landed = await reclaimShotVideo({ shotId: shot.id, ...baseline });
  if (!landed) {
    throw new Error(`视频已生成但 60 秒内未回收到项目(收件箱条目保留,画布在场或下轮批量可补收)`);
  }
}

export interface StoryboardH3VideoBatchStartOptions {
  recipeId?: string;
  tier?: H3ResolutionTier;
  /** force 路径指定镜(批量入口不用;镜级重生成走 runStoryboardH3ShotVideo) */
  forceShotIds?: string[];
}

/** 镜级重生成(D6):单镜 force 路径,复用同一组装+执行+回收函数;
 *  供分镜详情卡「重生成视频(H3)」按钮调用。 */
export async function runStoryboardH3ShotVideo(
  shot: StoryboardItem,
  opts: { tier?: H3ResolutionTier } = {},
): Promise<void> {
  const originProjectId = useProjectStore.getState().activeProjectId ?? "";
  if (!originProjectId) throw new Error("请先打开回写目标项目");
  await powerSaveStart();
  try {
    await runStoryboardH3ShotVideoStep({ shot, tier: opts.tier ?? "960p", originProjectId });
    toast.success(`S${String(shot.index).padStart(2, "0")} 单镜视频已出片并回收`);
  } finally {
    await powerSaveStop();
  }
}

export function useStoryboardH3VideoBatch(input: { storyboards: StoryboardItem[] }) {
  const [state, setState] = useState<StoryboardH3VideoBatchState>(IDLE_STATE);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const { storyboards } = input;

  /** hook 接口契约(与入口师并行写 UI 的约定,PRD §5.4): */
  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRequestedRef.current = true;
    toast.info("停止中:当前镜完成后停下(已提交的生成不浪费)");
  }, []);

  const start = useCallback((opts: StoryboardH3VideoBatchStartOptions = {}) => {
    if (runningRef.current || liveH3BatchRunning) return;
    const tier = opts.tier ?? "960p";
    const ready = batchDispatchableH3Recipes();
    if (ready.length === 0) {
      toast.error("没有可批量派发的 H3 工作流(注册表 ready 件为空)");
      return;
    }
    const recipeId = opts.recipeId ?? ready[0]!.id;
    const episodeId = storyboards.find((item) => item.episodeId)?.episodeId ?? "";
    const projectId = useProjectStore.getState().activeProjectId ?? "";
    if (!projectId || !episodeId) {
      toast.error("缺少活动项目或章节,无法批量出片");
      return;
    }
    const sessionStore = useStoryboardH3VideoSessionStore.getState();
    const persisted = sessionStore.session;
    const resumeRecord = persisted && persisted.episodeId === episodeId && persisted.projectId === projectId
      ? persisted
      : null;
    // 候选重建(重入按当前分镜表势力;video 镜幂等跳过,上轮失败镜跳过 C4)
    const skippedShotIds = new Set([...(resumeRecord?.failedShotIds ?? []), ...(resumeRecord?.doneShotIds ?? [])]);
    const plan = planStoryboardH3VideoBatch(storyboards);
    const queue = plan.candidates.filter((item) => !skippedShotIds.has(item.id));
    if (queue.length === 0) {
      if (resumeRecord) sessionStore.clearStoryboardH3VideoSession();
      toast.info("所有分镜视频均已齐备(或仅有上轮失败镜——修复后走单镜重生成)");
      return;
    }
    // 发车摘要(N1 数据源在面板确认对话;此行为续跑/直发兜底播报,N2 禁静默)
    const skippedFailed = resumeRecord?.failedShotIds.length ?? 0;
    toast.info(
      `H3 出片:${queue.length} 镜可出片`
      + (plan.missingFrameCount > 0 ? `,${plan.missingFrameCount} 镜缺首帧已跳过` : "")
      + (plan.truncatedShotIndexes.length > 0 ? `,超 15s 封顶截断:S${plan.truncatedShotIndexes.map((i) => String(i).padStart(2, "0")).join(" S")}` : "")
      + (skippedFailed > 0 ? `,跳过上轮失败镜 ${skippedFailed} 个` : ""),
    );

    runningRef.current = true;
    liveH3BatchRunning = true;
    stopRequestedRef.current = false;
    setState({ running: true, total: queue.length, done: 0, failed: 0, currentShotIndex: null });
    const sessionId = resumeRecord?.sessionId ?? createStoryboardH3VideoSessionId();
    const doneShotIds = [...(resumeRecord?.doneShotIds ?? [])];
    const failedShotIds = [...(resumeRecord?.failedShotIds ?? [])];
    useStoryboardH3VideoSessionStore.getState().beginStoryboardH3VideoSession({
      sessionId,
      projectId,
      episodeId,
      cursorShotIndex: queue[0]!.index,
      totalShots: queue.length,
      doneShotIds,
      failedShotIds,
      recipeId,
      tier,
      status: "running",
    });

    void (async () => {
      let done = 0;
      let failed = 0;
      const durations: number[] = [];
      let degradationWarned = false;
      await powerSaveStart();
      try {
        for (const shot of queue) {
          if (stopRequestedRef.current) break;
          setState((prev) => ({ ...prev, currentShotIndex: shot.index }));
          const startedAt = Date.now();
          try {
            await runStoryboardH3ShotVideoStep({ shot, tier, originProjectId: projectId });
            done += 1;
            doneShotIds.push(shot.id);
          } catch (error) {
            failed += 1;
            failedShotIds.push(shot.id);
            const message = error instanceof Error ? error.message : String(error);
            console.error("[h3-video-batch] 单镜失败", shot.id, message);
            toast.error(`S${String(shot.index).padStart(2, "0")} 出片失败:${message.slice(0, 120)}`);
          }
          const elapsedS = (Date.now() - startedAt) / 1000;
          durations.push(elapsedS);
          // MPS 退化监测(N4):镜耗时>前序均值 2 倍→一次 toast 提示
          if (!degradationWarned && durations.length >= 2) {
            const priorMean = durations.slice(0, -1).reduce((sum, v) => sum + v, 0) / (durations.length - 1);
            if (priorMean > 0 && elapsedS > priorMean * 2) {
              degradationWarned = true;
              console.warn("[h3-video-batch] 疑似 MPS 退化", { elapsedS, priorMean });
              toast.warning("引擎疑似 MPS 退化(单镜耗时异常膨胀),建议本轮收尾后重启引擎");
            }
          }
          useStoryboardH3VideoSessionStore.getState().advanceStoryboardH3VideoSession({
            cursorShotIndex: shot.index + 1,
            doneShotIds: [...doneShotIds],
            failedShotIds: [...failedShotIds],
          });
          setState((prev) => ({ ...prev, done, failed }));
        }
      } finally {
        await powerSaveStop();
        runningRef.current = false;
        liveH3BatchRunning = false;
        setState((prev) => ({ ...prev, running: false, currentShotIndex: null }));
        if (stopRequestedRef.current) {
          useStoryboardH3VideoSessionStore.getState().interruptStoryboardH3VideoSession();
        } else {
          useStoryboardH3VideoSessionStore.getState().clearStoryboardH3VideoSession();
        }
        // 收尾(N10):出片数+指路预看验收;失败清单
        if (done > 0) {
          const failedLabel = failed > 0
            ? `(失败 ${failed} 镜:S${failedShotIds.map((id) => {
              const shot = storyboards.find((item) => item.id === id);
              return shot ? String(shot.index).padStart(2, "0") : "?";
            }).join(" S")})`
            : "";
          toast.success(`H3 出片完成:${done} 镜已出片,请走「预看成片」验收;废片可单镜重生成${failedLabel}`);
        } else if (failed > 0) {
          toast.error(`H3 出片全部失败(${failed} 镜),详见控制台与失败清单`);
        }
      }
    })();
  }, [storyboards]);

  // 订阅会话 store(响应式):interrupted 会话驱动「继续出片」入口
  const session = useStoryboardH3VideoSessionStore((store) => store.session);
  const resumable = session && session.status === "interrupted"
    ? { shotIndex: session.cursorShotIndex, remaining: Math.max(0, session.totalShots - session.doneShotIds.length) }
    : null;

  return { state, start, stop, resumable };
}
