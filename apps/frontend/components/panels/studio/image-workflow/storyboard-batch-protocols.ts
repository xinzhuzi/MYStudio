/**
 * 分镜批量生图四协议·编排件(09-15 P3,TE MAN 协议仿写·零拷贝):
 * - 间隔节流:逐镜提交间隔常量(保守默认)+ 可中断延时(停止零残留 timer);
 * - 失败回退阶梯:原样 → 原样重试 → 降载降分辨率 → 放弃(三败才上报);
 * - 队列通道解析:经 comfy-engine-contract 拿引擎实际端口建 HTTP 通道
 *   (components 层才可 import 设置面板契约;lib 层协议保持纯净)。
 *
 * 与 use-storyboard-batch-generation 的分工:本文件只放可单测的纯编排,
 * 面板状态机(store 写入/toast/UI)留在 hook。
 */
import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import {
  createHttpStoryboardBatchEngineQueueChannel,
  type StoryboardBatchEngineQueueChannel,
} from "@/lib/assist/image-studio/storyboard-batch-engine-queue";

/**
 * 逐镜提交间隔(保守默认,防引擎队列压死;连败快失败时也不至于连打)。
 * 写成常量便于调整;hook 可经 submitIntervalMs 注入覆盖(测试用)。
 */
export const STORYBOARD_BATCH_SHOT_INTERVAL_MS = 2_500;

/** 阶梯第三段「降载降分辨率」的目标档(最低档,既降显存又降时长)。 */
export const STORYBOARD_BATCH_DEGRADED_RESOLUTION = "1K";

/** 回退阶梯总尝试次数:初次 + 原样重试 + 降载重试。 */
export const STORYBOARD_BATCH_LADDER_MAX_ATTEMPTS = 3;

export type StoryboardBatchLadderStage = "initial" | "retry" | "degraded";

const LADDER_STAGES: StoryboardBatchLadderStage[] = ["initial", "retry", "degraded"];

export interface StoryboardBatchLadderOutcome {
  ok: boolean;
  /** 实际执行过的阶梯段(按序)。 */
  stagesRun: StoryboardBatchLadderStage[];
  /** 阶梯走满仍失败(exhausted)或因中止退出(aborted)。 */
  aborted?: boolean;
  /** 最后一次失败的错误(成功时缺省)。 */
  error?: unknown;
}

/**
 * 失败回退阶梯:attempt 按 stage 执行(initial=原样 / retry=原样重试 /
 * degraded=降载降分辨率);段间检查 shouldAbort(用户停止后不再烧重试),
 * 走满 STORYBOARD_BATCH_LADDER_MAX_ATTEMPTS 段仍失败才放弃。
 * 三段行为由调用方映射(降载=换分辨率参数重发),本函数只管节奏。
 */
export async function runStoryboardBatchLadder(input: {
  attempt: (stage: StoryboardBatchLadderStage) => Promise<void>;
  shouldAbort?: () => boolean;
  maxAttempts?: number;
}): Promise<StoryboardBatchLadderOutcome> {
  const stages = LADDER_STAGES.slice(0, Math.max(1, input.maxAttempts ?? STORYBOARD_BATCH_LADDER_MAX_ATTEMPTS));
  const stagesRun: StoryboardBatchLadderStage[] = [];
  let lastError: unknown;
  for (const stage of stages) {
    if (input.shouldAbort?.()) {
      return { ok: false, stagesRun, aborted: true, error: lastError };
    }
    stagesRun.push(stage);
    try {
      await input.attempt(stage);
      return { ok: true, stagesRun };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, stagesRun, error: lastError };
}

/** 可中断延时(间隔节流内核):wait 到点 true;cancel/已中止 → 立即 false,零残留 timer。 */
export interface StoryboardBatchInterruptibleDelay {
  wait(ms: number): Promise<boolean>;
  cancel(): void;
  /** 是否仍有挂起的延时 timer(测试断言「停止后无残留」用)。 */
  isPending(): boolean;
}

export function createStoryboardBatchInterruptibleDelay(
  shouldAbort: () => boolean = () => false,
): StoryboardBatchInterruptibleDelay {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settle: ((elapsed: boolean) => void) | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const resolve = settle;
    settle = null;
    resolve?.(false);
  };
  return {
    wait(ms: number): Promise<boolean> {
      if (shouldAbort()) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        settle = resolve;
        timer = setTimeout(() => {
          timer = null;
          settle = null;
          resolve(true);
        }, ms);
      });
    },
    cancel: clear,
    isPending: () => timer !== null,
  };
}

/**
 * 解析生产队列通道:引擎托管客户端拿实际端口(17xxx 防撞顺延结果)→
 * 引擎 HTTP /queue 通道。任何一步失败(非桌面/引擎未跑/端口未知)返回
 * undefined——精确停队协议静默降级,不阻断批量。
 */
export async function resolveStoryboardBatchQueueChannel(): Promise<StoryboardBatchEngineQueueChannel | undefined> {
  const client = getComfyEngineClient();
  if (!client) return undefined;
  try {
    const status = await client.getEngineStatus();
    if (typeof status.port !== "number" || !Number.isFinite(status.port) || status.port <= 0) {
      return undefined;
    }
    return createHttpStoryboardBatchEngineQueueChannel(`http://127.0.0.1:${status.port}`);
  } catch {
    return undefined;
  }
}
