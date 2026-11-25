// 10-27 分镜H3双通道 P2a+二期硬取消(PRD 10-27-storyboard-h3-dual-channel §5.4/§14.2):
// 「H3 出片」批量器——串行逐镜(读首帧 b64→组装器 API 档→sidecar /comfy/execute
// →writeback 回收轮询落位;远端 settings 引擎生效时 complete 结果的 videos 另走
// b64 回流入库=T16 断链修复,本地模式零调用防双写),断点续跑跳过上轮失败镜(C4),失败二分类(引擎失败
// 不重掷/回收失败仅重试消费),硬取消停止(Q2 兑现:stop→sidecar
// /comfy/jobs/{id}/cancel 立即打断当前镜;回收段不硬断已生成片照常落账;停止期
// 失败带「已按停止请求取消:」前缀与真引擎失败区分),防休眠桥在批量边界开停
// (N3),MPS 耗时漂移监测(N4),发车摘要禁静默跳过(N2/C6),发车前孤儿对拍
// skipShotIds 本轮排除(§14.3.2,不持久不自动),收尾 toast 指路预看验收(N10)。
// 单镜重生成(runStoryboardH3ShotVideo,D6)=同组装+执行+回收函数的 force 路径。
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  DEFAULT_H3_RECIPE_ID,
  buildShotH3ApiWorkflowForRecipe,
  h3BatchDispatchableRecipeIds,
  resolveH3ShotTimeoutS,
  resolveSancaiStageTimeoutS,
  parseImageSizeFromB64,
  applySancaiStageBSource,
  SANCAI_CANVAS_ANCHORS,
  type ShotH3SancaiApiWorkflowResult,
} from "@/lib/comfyui/h3/h3-shot-video-workflow";
import { batchDispatchableH3Recipes, type H3ResolutionTier } from "@/lib/comfyui/h3/h3-workflow-recipes";
import { dialogueAudioPolicy } from "@/lib/comfyui/h3/h3-shot-prompt";
import { comfySidecarJson, persistComfyVideosFromResult, requestComfyEngineFree, type ComfyExecuteJobReply } from "@/lib/comfyui/comfy/comfy-execute";
import { getRemoteEngine } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import { consumeComfyBridgeWritebacks } from "@/lib/comfyui/comfy/comfy-bridge-writeback-consumer";
import { landH3ShotVideo, probeH3VideoDurationUs } from "@/lib/comfyui/h3/h3-shot-landing";
import { readStoryboardImageB64 } from "@/lib/comfyui/storyboard/storyboard-overview-sync";
import {
  storyboardImageReviewIssues,
  verifyStoryboardImageBytes,
} from "@/lib/studio/storyboard-image-review-gate";
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

/** job 轮询间隔/回收轮询窗(PRD §5.4:回收 60s 窗每 5s)。 */
const JOB_POLL_INTERVAL_MS = 5_000;
const RECLAIM_WINDOW_MS = 60_000;
const RECLAIM_POLL_INTERVAL_MS = 5_000;
/** i2v 族超 15s 镜按 362 帧封顶截断(§二 Q1)——发车摘要列示用。 */
const SHOT_SECONDS_CAP = 15;
/** multiseg 超 40s 硬顶拒派(§14.1.4 M1:40s 960P 原片≈45MB 逼近 MyShot 64MB 回写上限,
 *  超限片白烧数小时且永不到账;组装器 buildShotH3MultisegPrompt 同门硬顶)。 */
const MULTISEG_SECONDS_HARD_CAP = 40;

export interface StoryboardH3VideoBatchPlan {
  /** 可派发镜(本章有首帧 mediaRef=image 且非 video),按 index 升序 */
  candidates: StoryboardItem[];
  /** 缺首帧镜数(候选排除,N2 摘要) */
  missingFrameCount: number;
  /** i2v 族:超 15s 被截断的镜(仍派发,C6 摘要);multiseg 恒空(改走顶拒清单) */
  truncatedShotIndexes: number[];
  /** multiseg 专属:超 40s 硬顶拒派镜(index 列表,§14.1.4 M1——不进 queue,
   *  发车摘要列「超 40s 顶拒」;i2v 族恒空)。 */
  rejectedShotIndexes: number[];
  /** 1125 人审硬门:未过图片人审的候选镜(index 列表)——不进 queue,
   *  发车摘要列示;工作台人审区通过后下轮可出片。 */
  unreviewedShotIndexes: number[];
  /** 已是 video 的镜(幂等跳过,不计缺帧) */
  alreadyVideoCount: number;
}

/** 发车计划纯函数(面板确认对话 N1/N2/C6 的数据源;§14.1.4 recipe 参分叉:
 *  i2v 族维持 15s 截断清单;multiseg 输出「超 40s 顶拒派清单」)。
 *  recipeId 缺省=i2v 口径(面板既有单参调用零波及)。 */
export function planStoryboardH3VideoBatch(storyboards: StoryboardItem[], recipeId?: string): StoryboardH3VideoBatchPlan {
  const candidates = storyboards
    .filter((item) => item.mediaRef?.kind === "image" && item.mediaRef.path)
    .sort((a, b) => a.index - b.index);
  const missingFrameCount = storyboards.filter((item) => item.mediaRef?.kind !== "video" && item.mediaRef?.kind !== "image").length;
  const alreadyVideoCount = storyboards.filter((item) => item.mediaRef?.kind === "video").length;
  const shotSeconds = (item: StoryboardItem) => item.durationTarget ?? item.duration;
  const isMultiseg = recipeId === "my-h3-multiseg";
  const truncatedShotIndexes = isMultiseg
    ? []
    : candidates.filter((item) => shotSeconds(item) > SHOT_SECONDS_CAP).map((item) => item.index);
  const rejectedShotIndexes = isMultiseg
    ? candidates.filter((item) => shotSeconds(item) > MULTISEG_SECONDS_HARD_CAP).map((item) => item.index)
    : [];
  // 1125 人审硬门:候选里未过图片人审的镜全部拦下(全章节,无豁免)
  const unreviewedShotIndexes = candidates
    .filter((item) => storyboardImageReviewIssues(item).length > 0)
    .map((item) => item.index);
  return { candidates, missingFrameCount, alreadyVideoCount, truncatedShotIndexes, rejectedShotIndexes, unreviewedShotIndexes };
}

/** 远端 settings 模式判定(10-29 D1 T16 复核 gap2):仅设置位配置的远端引擎生效
 *  (source==="settings")才走 b64 回流入库。getRemoteEngine 异步且探活静默吞错
 *  (照 McpSettingsTab 同款口径)——判定失败(sidecar 不可达/网络错)按「非 settings」
 *  保守跳过:错杀不入库(产物仍在引擎输出目录可重试)好过本地模式误判双写。 */
async function remoteEngineIsFromSettings(): Promise<boolean> {
  try {
    return (await getRemoteEngine()).source === "settings";
  } catch {
    return false;
  }
}

/** 远端模式产物回流(10-29 D1 T16 复核 gap2,分镜批量远端断链修复):远端引擎的
 *  MyShot writeback 实测 403(收件箱回收链在远端不通),产物只走 job result.videos
 *  的 b64 回流(T4 实弹已证回流通)——经 persistComfyVideosFromResult 入库发起项目
 *  media/ai-video/(成功即剥离 b64)。口径:①仅远端 settings 生效才调(本地模式
 *  收件箱已回收,再写=双写,零调用);②result 无 videos 短路(免逐镜多余 remote
 *  探活 GET);③入库失败只计数不抛错不阻断——照 T7 WorkbenchTab 消费位「失败
 *  不阻断」惯例,镜落账仍由收件箱回收链单独判(本函数不碰回收/收件箱逻辑)。
 *  1115 fire F2①②:回流入库明细带回 subfolder 镜绑定;绑定匹配白名单
 *  (video/漫影/{章}/{镜},镜像消费器 assertVideoSubfolder)即返回 landedUrl,
 *  供 complete 处正门直落——远端收件箱结构性永不到,不再等 60s 回收窗。 */
async function persistRemoteShotVideos(
  result: ComfyExecuteJobReply["result"],
  originProjectId: string,
  shot: { id: string; episodeId: string },
): Promise<{ landedUrl: string | null }> {
  if (!result?.videos?.length) return { landedUrl: null };
  if (!(await remoteEngineIsFromSettings())) return { landedUrl: null };
  const summary = await persistComfyVideosFromResult(result, originProjectId);
  if (summary.failed > 0) {
    console.warn("[h3-video-batch] 远端引擎视频回流入库部分失败(产物仍在引擎输出目录)", summary);
  }
  const expectedSubfolder = `video/漫影/${shot.episodeId}/${shot.id}`;
  // 1116 F2③ 实弹归因:Win 引擎 folder_paths normpath 铸反斜杠回包(38/38 脱靶
  // 根因)——execute.py 已在边界归一,此处对 item.subfolder 再容错一次(双保险,
  // 旧装机侧未带边界归一时直落仍活)。
  const matched = (summary.items ?? []).find(
    (item) => (item.subfolder ?? "").replace(/\\/g, "/") === expectedSubfolder && item.url,
  );
  return { landedUrl: matched?.url ?? null };
}

/** 自实现执行+轮询:提交拿到 jobId 即回调 onJobId(硬取消 stop 追踪用);
 *  job error 抛大白话由调用方分类;complete 返回 job result(三采拆链要读
 *  result.videos 拿段A 终档产物做段B 视频源)。远端 settings 模式下按
 *  persistOnComplete 入库 result.videos(T16 产物回流,本地模式零调用;
 *  1112 三采:段A 中间档(p1/p2)不回流,仅段B 终档回流)。
 *  1115 fire F2②:远端回流入库且镜绑定匹配白名单时,complete 处即走
 *  landH3ShotVideo 正门直落(mediaRef=video+候选+时长探测,与收件箱消费器
 *  同一落账真身)——远端收件箱结构性永不到,直落即判 landed,回收窗只作
 *  本地链双保险;directLanded=false(本地模式/无绑定/入库失败)照旧回落
 *  收件箱回收链。 */
async function executeShotWorkflow(input: {
  apiGraph: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  extraPngInfo: Record<string, unknown>;
  images: Array<{ key: string; name: string; b64: string }>;
  timeoutS: number;
  /** 发起项目快照(远端回流入库归属;照 persistComfyVideo 防错挂惯例) */
  originProjectId: string;
  onJobId?: (jobId: string) => void;
  /** complete 时远端 settings 模式入库 result.videos(单段线/三采段B=true) */
  persistOnComplete?: boolean;
  /** 目标镜(远端直落的绑定校验与落账对象) */
  shot?: StoryboardItem;
  /** 派发位音频政策(dialogueAudioPolicy(shot.lines),直落 policy 线程传入) */
  policy?: "full" | "ambient";
}): Promise<{ result: NonNullable<ComfyExecuteJobReply["result"]>; directLanded: boolean }> {
  const { jobId } = await comfySidecarJson<{ jobId: string }>("POST", "/comfy/execute", {
    body: {
      graph: input.apiGraph,
      inputs: { strings: {}, images: input.images },
      timeoutS: input.timeoutS,
      extraPngInfo: input.extraPngInfo,
    } as unknown as Record<string, unknown>,
    timeoutMs: 20_000,
  });
  input.onJobId?.(jobId);
  const deadline = Date.now() + input.timeoutS * 1000 + 30_000;
  for (;;) {
    const job = await comfySidecarJson<ComfyExecuteJobReply>(
      "GET",
      `/comfy/jobs/${encodeURIComponent(jobId)}`,
      { timeoutMs: 10_000 },
    );
    if (job.status === "error") throw new Error(job.error || job.message || "ComfyUI 执行失败");
    if (job.status === "complete") {
      let directLanded = false;
      if (input.persistOnComplete) {
        const shot = input.shot ?? { id: "", episodeId: "" };
        const { landedUrl } = await persistRemoteShotVideos(job.result, input.originProjectId, shot);
        if (landedUrl && input.shot && input.policy) {
          const h3DurationUs = await probeH3VideoDurationUs(landedUrl);
          landH3ShotVideo({
            storyboardId: input.shot.id,
            url: landedUrl,
            policy: input.policy,
            h3DurationUs: h3DurationUs ?? undefined,
            bridgeItemId: `remote-direct:${jobId}`,
            originProjectId: input.originProjectId,
          });
          directLanded = true;
        }
      }
      return { result: job.result ?? {}, directLanded };
    }
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
 *  失败分类抛出:kind="engine"(不重掷)/"reclaim"(仅重试消费过仍失败)/"assembled"(组装/自检门)。
 *  recipeId(§14.1.4 multiseg/W10 fasth3;1112 三采):经 buildShotH3ApiWorkflowForRecipe
 *  注册表分派——sancai 族走两段拆链(Note103 法则①:段A 一二采一发→POST /free→段B
 *  三采独立一发;段B 视频源=段A result.videos 里 saveVideo 锚(3071)终档的 [output]
 *  注解名,零拷贝直读输出目录);i2v 族按模板对(缺省=旧 H3 线);multiseg 走分段组装器。
 *  onJobId:每段提交引擎后即回调——批量 stop 硬取消追踪两段共用(单镜 force
 *  不接停止 UI,天然不需要,PRD §14.2.3)。 */
export async function runStoryboardH3ShotVideoStep(input: {
  shot: StoryboardItem;
  tier: H3ResolutionTier;
  originProjectId: string;
  recipeId?: string;
  onJobId?: (jobId: string) => void;
}): Promise<void> {
  const shot = input.shot;
  if (shot.mediaRef?.kind !== "image" || !shot.mediaRef.path) {
    throw new Error(`分镜 ${shot.id} 缺少首帧画面,无法出片`);
  }
  // 1125 人审硬门(共享步兜底:批量预检+单镜 force 都经此):取 store 最新镜
  // 防批量快照陈旧;未过图片人审=零引擎入队直接抛(组装门语义)。
  const latestShot = useStudioStore.getState().storyboards.find((item) => item.id === shot.id) ?? shot;
  const reviewIssue = storyboardImageReviewIssues(latestShot)[0];
  if (reviewIssue) throw new Error(reviewIssue);
  const state = useStudioStore.getState();
  const chapter = state.novelChapters.find((item) => item.id === shot.episodeId);
  let firstFrameB64: string;
  try {
    firstFrameB64 = await readStoryboardImageB64(shot.mediaRef.path);
  } catch (error) {
    throw new Error(`读取首帧失败:${error instanceof Error ? error.message : String(error)}`);
  }
  // 1125 内容对账:批准绑定图片字节——同路径换图/旁路覆写在发车前现形。
  const contentIssue = (await verifyStoryboardImageBytes(latestShot, firstFrameB64))[0];
  if (contentIssue) throw new Error(contentIssue);
  // 1112 三采:AR 阶梯推导需要首帧像素宽高(纯函数解 PNG/JPEG 头)。旧配方
  // 忽略尺寸;三采族解不出(非 PNG/JPEG/损坏头)由分派器的字段门拒派发。
  const frameSize = parseImageSizeFromB64(firstFrameB64);
  const assembled = buildShotH3ApiWorkflowForRecipe(input.recipeId ?? DEFAULT_H3_RECIPE_ID, {
    shot,
    chapterId: shot.episodeId,
    chapterLabel: chapter?.title || shot.episodeId,
    policy: dialogueAudioPolicy(shot.lines),
    voiceMood: shot.emotion,
    originProjectId: input.originProjectId,
    firstFrameB64,
    resolutionTier: input.tier,
    ...(frameSize ? { frameWidth: frameSize.width, frameHeight: frameSize.height } : {}),
  });
  const sancai = (assembled as ShotH3SancaiApiWorkflowResult).stageBGraph
    ? (assembled as ShotH3SancaiApiWorkflowResult)
    : null;
  let directLanded = false;
  if (sancai) {
    // 两段拆链(Note103 法则①;超时=两段档 900s/300s)
    const { stageA, stageB } = resolveSancaiStageTimeoutS();
    const { result: resultA } = await executeShotWorkflow({
      apiGraph: sancai.apiGraph,
      extraPngInfo: sancai.uiWorkflow,
      images: sancai.images,
      timeoutS: stageA,
      originProjectId: input.originProjectId,
      onJobId: input.onJobId,
    });
    // 段A 终档节点=锚表单源(45faa181 千位段重编号:4→3071;锚表随重编号免疫,
    // 1116 门禁红实录抢救的 C 阶段前置修复——旧裸号 "4" 在新母体必扑空=三采永不跑)
    const finalVideo = (resultA.videos ?? []).find(
      (video) => video.nodeId === String(SANCAI_CANVAS_ANCHORS.saveVideo) && video.filename,
    );
    if (!finalVideo?.filename) {
      throw new Error(`一二采已完成但未取到终档产物(SaveVideo 节点 ${SANCAI_CANVAS_ANCHORS.saveVideo} 的输出缺失),无法衔接三采`);
    }
    // 段间 /free(卸载 H3 全家桶防三采被饿;发后即忘——失败吞错不阻断段B)
    await requestComfyEngineFree();
    applySancaiStageBSource(sancai.stageBGraph, { filename: finalVideo.filename, subfolder: finalVideo.subfolder });
    ({ directLanded } = await executeShotWorkflow({
      apiGraph: sancai.stageBGraph,
      extraPngInfo: sancai.uiWorkflow,
      images: [],
      timeoutS: stageB,
      originProjectId: input.originProjectId,
      onJobId: input.onJobId,
      persistOnComplete: true,
      shot,
      policy: dialogueAudioPolicy(shot.lines),
    }));
  } else {
    ({ directLanded } = await executeShotWorkflow({
      apiGraph: assembled.apiGraph,
      extraPngInfo: assembled.uiWorkflow,
      images: assembled.images,
      timeoutS: resolveH3ShotTimeoutS(input.recipeId ?? DEFAULT_H3_RECIPE_ID, assembled.report.seconds, input.tier),
      originProjectId: input.originProjectId,
      onJobId: input.onJobId,
      persistOnComplete: true,
      shot,
      policy: dialogueAudioPolicy(shot.lines),
    }));
  }
  // 1115 fire F2②:远端直落即判 landed(片已入库+分镜已挂);回收窗只作本地收件箱
  // 链双保险——远端收件箱结构性永不到,再等=白烧 60s(1115 实盘 19/19 全因此计失败)。
  if (!directLanded) {
    const baseline = snapshotShotBaseline(shot.id);
    const landed = await reclaimShotVideo({ shotId: shot.id, ...baseline });
    if (!landed) {
      throw new Error(`视频已生成但 60 秒内未回收到项目(收件箱条目保留,画布在场或下轮批量可补收)`);
    }
  }
}

export interface StoryboardH3VideoBatchStartOptions {
  recipeId?: string;
  tier?: H3ResolutionTier;
  /** force 路径指定镜(批量入口不用;镜级重生成走 runStoryboardH3ShotVideo) */
  forceShotIds?: string[];
  /** 发车前孤儿对拍「先导入并跳过这些镜」(§14.3.2):本轮 queue 排除这些镜——
   *  只作用于本次 start 不持久不自动(O3:防与「重生帧图→H3 重生成」循环互踩,
   *  mediaRef=video 仍是唯一自动幂等键)。 */
  skipShotIds?: string[];
}

/** 1116 §七 用户口径(终裁):分镜批量视频按镜时长路由正典线——≤15s 常规镜=
 * 单镜(sancai-i2v,首帧锚定三段链);>15s 长镜=一镜到底-分段(multiseg)。
 * i2v-31 单段直出=快速预览档,禁再做批量缺省(1115 实弹 19 支直出片教训)。 */
export function autoRecipeForStoryboards(storyboards: StoryboardItem[]): string {
  const over15 = storyboards.some((item) => (item.durationTarget ?? item.duration ?? 0) > 15);
  return over15 ? "my-h3-multiseg" : "my-h3-sancai-i2v";
}

/** 镜级重生成(D6):单镜 force 路径,复用同一组装+执行+回收函数;
 *  供分镜详情卡「重生成视频(H3)」按钮调用。recipeId 缺省链(§14.1.4 D6 延伸):
 *  显式传入 > 会话 store 上次配方(与批量续跑同轨)> DEFAULT_H3_RECIPE_ID;
 *  显式传 "my-fasth3-i2v-27" 走 Windows FastH3 主线(B1 实弹入口)。 */
export async function runStoryboardH3ShotVideo(
  shot: StoryboardItem,
  opts: { tier?: H3ResolutionTier; recipeId?: string } = {},
): Promise<void> {
  const originProjectId = useProjectStore.getState().activeProjectId ?? "";
  if (!originProjectId) throw new Error("请先打开回写目标项目");
  const recipeId = opts.recipeId
    ?? useStoryboardH3VideoSessionStore.getState().session?.recipeId
    ?? DEFAULT_H3_RECIPE_ID;
  await powerSaveStart();
  try {
    await runStoryboardH3ShotVideoStep({ shot, tier: opts.tier ?? "960p", originProjectId, recipeId });
    toast.success(`S${String(shot.index).padStart(2, "0")} 单镜视频已出片并回收`);
  } finally {
    await powerSaveStop();
  }
}

export function useStoryboardH3VideoBatch(input: { storyboards: StoryboardItem[] }) {
  const [state, setState] = useState<StoryboardH3VideoBatchState>(IDLE_STATE);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  /** 当前镜 sidecar jobId(硬取消追踪;组装段/镜间/回收完成后恒 null)。 */
  const currentJobIdRef = useRef<string | null>(null);
  const { storyboards } = input;

  /** hook 接口契约(与入口师并行写 UI 的约定,PRD §5.4):
   *  硬取消(Q2 兑现,§14.2.3):立即 cancel 当前镜——发后即忘(sidecar 永不
   *  5xx,失败只降级),引擎打断后 job 转 error,前端轮询≤5s 见错抛出→该镜
   *  记失败(原因带停止前缀),循环顶退出;jobId 已清(组装段/镜间/回收完成)
   *  再点=no-op(幂等,双击只发一次 cancel);回收段不硬断,已生成片照常落账。 */
  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRequestedRef.current = true;
    const jobId = currentJobIdRef.current;
    currentJobIdRef.current = null;
    if (jobId) {
      void comfySidecarJson("POST", `/comfy/jobs/${encodeURIComponent(jobId)}/cancel`, {
        timeoutMs: 10_000,
      }).catch(() => {
        // 取消失败按软停兜底:停止是清理性操作,不因取消本身报红
      });
    }
    toast.info("已请求取消当前镜(引擎打断通常数秒内生效)");
  }, []);

  const start = useCallback((opts: StoryboardH3VideoBatchStartOptions = {}) => {
    if (runningRef.current || liveH3BatchRunning) return;
    const tier = opts.tier ?? "960p";
    const ready = batchDispatchableH3Recipes();
    if (ready.length === 0) {
      toast.error("没有可批量派发的 H3 工作流(注册表 ready 件为空)");
      return;
    }
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
    // 配方解析(10-27 windows-fasth3-mainline 接线 + §14.1.4 multiseg + 1116 §七时长路由):
    // 显式传入 > 续跑会话在档(防中断续跑静默切配方)> 按镜时长自动路由(≤15s 全 sancai-i2v/
    // 任一 >15s multiseg;1116 正典口径,i2v-31 只做显式预览档)> ready 首件缺省;
    // 须可 API 派发(注册表 ready 门在前,本门在后)。
    const autoRecipe = autoRecipeForStoryboards(storyboards);
    const recipeId = opts.recipeId ?? resumeRecord?.recipeId ?? (
      h3BatchDispatchableRecipeIds().includes(autoRecipe) ? autoRecipe : ready[0]!.id);
    if (!h3BatchDispatchableRecipeIds().includes(recipeId)) {
      toast.error(`工作流配方 ${recipeId} 没有 API 模板,无法批量派发(可派发:${h3BatchDispatchableRecipeIds().join(" / ")})`);
      return;
    }
    // 候选重建(重入按当前分镜表势力;video 镜幂等跳过,上轮失败镜跳过 C4)
    const skippedShotIds = new Set([...(resumeRecord?.failedShotIds ?? []), ...(resumeRecord?.doneShotIds ?? [])]);
    const plan = planStoryboardH3VideoBatch(storyboards, recipeId);
    // multiseg 超 40s 顶拒镜(M1)不进 queue——拒派清单禁静默,发车摘要列示
    const rejectedShotIds = new Set(
      plan.rejectedShotIndexes.map((index) => plan.candidates.find((item) => item.index === index)?.id).filter((id): id is string => Boolean(id)),
    );
    // 孤儿对拍跳过(§14.3.2):本轮 start 显式带入的盘上已有片镜,不持久不自动
    const orphanSkipShotIds = new Set(opts.skipShotIds ?? []);
    const orphanSkipCount = plan.candidates.filter((item) => orphanSkipShotIds.has(item.id)).length;
    // 1125 人审硬门预检:未审镜不进 queue(摘要列示);全被拦=直接不发车
    const unreviewedShotIds = new Set(
      plan.unreviewedShotIndexes
        .filter((index) => !skippedShotIds.has(plan.candidates.find((item) => item.index === index)?.id ?? ""))
        .map((index) => plan.candidates.find((item) => item.index === index)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const unreviewedCount = unreviewedShotIds.size;
    const queue = plan.candidates.filter((item) => !skippedShotIds.has(item.id) && !orphanSkipShotIds.has(item.id) && !rejectedShotIds.has(item.id) && !unreviewedShotIds.has(item.id));
    if (queue.length === 0) {
      if (resumeRecord) sessionStore.clearStoryboardH3VideoSession();
      if (unreviewedCount > 0) {
        toast.error(`本轮无可出片镜:${unreviewedCount} 镜未通过图片人审(全章节硬门)——请先在工作台「图片人审」区逐镜看图通过`);
      } else {
        toast.info(
          orphanSkipCount > 0
            ? `本轮无可出片镜:${orphanSkipCount} 镜已按盘上既有片跳过(候选可走版本对查看)`
            : "所有分镜视频均已齐备(或仅有上轮失败镜——修复后走单镜重生成)",
        );
      }
      return;
    }
    // 发车摘要(N1 数据源在面板确认对话;此行为续跑/直发兜底播报,N2 禁静默;
    // §14.1.4 分叉:multiseg=超 40s 顶拒清单+Σ镜秒×300s 预计时长;i2v 族=超 15s 截断清单照旧)
    const skippedFailed = resumeRecord?.failedShotIds.length ?? 0;
    const isMultiseg = recipeId === "my-h3-multiseg";
    const multisegEstimateMin = isMultiseg
      ? `,预计 ${Math.round(queue.reduce((sum, item) => sum + (item.durationTarget ?? item.duration), 0) * 300 / 60)} 分钟`
      : "";
    toast.info(
      `H3 出片:${queue.length} 镜可出片${multisegEstimateMin}`
      + (plan.missingFrameCount > 0 ? `,${plan.missingFrameCount} 镜缺首帧已跳过` : "")
      + (unreviewedCount > 0 ? `,${unreviewedCount} 镜未过人审已拦(工作台人审区通过后可出片)` : "")
      + (isMultiseg
        ? (plan.rejectedShotIndexes.length > 0 ? `,超 40s 顶拒派:S${plan.rejectedShotIndexes.map((i) => String(i).padStart(2, "0")).join(" S")}` : "")
        : (plan.truncatedShotIndexes.length > 0 ? `,超 15s 封顶截断:S${plan.truncatedShotIndexes.map((i) => String(i).padStart(2, "0")).join(" S")}` : ""))
      + (skippedFailed > 0 ? `,跳过上轮失败镜 ${skippedFailed} 个` : "")
      + (orphanSkipCount > 0 ? `,盘上已有片跳过 ${orphanSkipCount} 镜` : ""),
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
            await runStoryboardH3ShotVideoStep({
              shot,
              tier,
              originProjectId: projectId,
              recipeId,
              onJobId: (jobId) => { currentJobIdRef.current = jobId; },
            });
            done += 1;
            doneShotIds.push(shot.id);
          } catch (error) {
            failed += 1;
            failedShotIds.push(shot.id);
            const raw = error instanceof Error ? error.message : String(error);
            // 停止置位期间的失败=取消收尾链(引擎打断→job error),带前缀与
            // 真引擎失败区分(C2:续跑可辨;failedShotIds 语义不变可补,C4)
            const message = stopRequestedRef.current ? `已按停止请求取消:${raw}` : raw;
            console.error("[h3-video-batch] 单镜失败", shot.id, message);
            toast.error(`S${String(shot.index).padStart(2, "0")} 出片失败:${message.slice(0, 120)}`);
          } finally {
            currentJobIdRef.current = null;
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
