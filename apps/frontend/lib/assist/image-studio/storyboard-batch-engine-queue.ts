/**
 * 分镜批量生图·引擎队列协议(09-15 P3 精确停队,TE MAN 协议仿写·零拷贝):
 *
 * 引擎契约(ComfyUI 官方 /queue HTTP API,只读消费不碰引擎本体):
 * - GET /queue → { queue_running: [[序号, prompt_id, …]], queue_pending: […] }
 * - DELETE /queue + body {delete: [prompt_id, …]} → 删除指定 pending 项
 *
 * 协议三件:
 * 1. prompt_id 记录器——本会话提交过的任务编号集合(提交层把观测到的编号
 *    记进来;观测不到的编号永远不会被记,也就永远不会被删);
 * 2. 差分归因——提交前后快照 pending 集,新增项视为本会话提交(串行批量下
 *    成立;他人任务在快照前就在队里,不会进差分);
 * 3. 精确停队——停止时只 DELETE「本会话记录 ∩ 仍在 pending」的编号,
 *    他人任务与正在执行的任务零触碰。
 *
 * 全部 fail-soft:队列不可达时协议静默降级(返回空结果/undefined),
 * 绝不把停队失败升级成用户可见错误(停止本地批量本身总是成功)。
 */

/** 引擎队列快照(已从引擎原始数组形态归一成 prompt_id 列表)。 */
export interface StoryboardBatchEngineQueueSnapshot {
  runningPromptIds: string[];
  pendingPromptIds: string[];
}

/** 队列操作通道(生产=引擎 HTTP;测试=内存 mock 注入)。 */
export interface StoryboardBatchEngineQueueChannel {
  getQueue(): Promise<StoryboardBatchEngineQueueSnapshot>;
  deleteQueueItems(promptIds: string[]): Promise<void>;
}

const QUEUE_HTTP_TIMEOUT_MS = 5_000;

/**
 * 引擎 GET /queue 原始应答 → 快照(纯函数,容错:任何畸形输入都落空快照,
 * 不抛错——队列观测失败不得打断生图主链)。
 */
export function parseStoryboardBatchEngineQueueReply(raw: unknown): StoryboardBatchEngineQueueSnapshot {
  const extractIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const ids: string[] = [];
    for (const entry of value) {
      // 引擎队列项 = [序号, prompt_id, prompt, extra_data, outputs];只取 prompt_id
      const promptId = Array.isArray(entry) && typeof entry[1] === "string" ? entry[1] : null;
      if (promptId && !ids.includes(promptId)) ids.push(promptId);
    }
    return ids;
  };
  if (!raw || typeof raw !== "object") return { runningPromptIds: [], pendingPromptIds: [] };
  const reply = raw as { queue_running?: unknown; queue_pending?: unknown };
  return {
    runningPromptIds: extractIds(reply.queue_running),
    pendingPromptIds: extractIds(reply.queue_pending),
  };
}

/** 引擎 HTTP 通道(生产实现;baseUrl 形如 http://127.0.0.1:{port})。 */
export function createHttpStoryboardBatchEngineQueueChannel(
  baseUrl: string,
): StoryboardBatchEngineQueueChannel {
  const normalizeBaseUrl = baseUrl.replace(/\/+$/, "");
  return {
    async getQueue(): Promise<StoryboardBatchEngineQueueSnapshot> {
      const response = await fetch(`${normalizeBaseUrl}/queue`, {
        signal: AbortSignal.timeout(QUEUE_HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`引擎队列查询失败(HTTP ${response.status})`);
      return parseStoryboardBatchEngineQueueReply(await response.json().catch(() => null));
    },
    async deleteQueueItems(promptIds: string[]): Promise<void> {
      if (promptIds.length === 0) return;
      const response = await fetch(`${normalizeBaseUrl}/queue`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [...promptIds] }),
        signal: AbortSignal.timeout(QUEUE_HTTP_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`引擎队列撤回失败(HTTP ${response.status})`);
    },
  };
}

/** 本会话 prompt_id 集合(记录器;去重、只增不清)。 */
export interface StoryboardBatchPromptIdTracker {
  record(promptIds: string[]): void;
  recordedIds(): string[];
  has(promptId: string): boolean;
  clear(): void;
}

export function createStoryboardBatchPromptIdTracker(): StoryboardBatchPromptIdTracker {
  const ids = new Set<string>();
  return {
    record(promptIds) {
      for (const id of promptIds) {
        if (typeof id === "string" && id) ids.add(id);
      }
    },
    recordedIds: () => [...ids],
    has: (promptId) => ids.has(promptId),
    clear: () => ids.clear(),
  };
}

/**
 * 差分归因(纯函数):提交后快照相对提交前快照新增的 pending 编号 =
 * 本会话新提交且仍在排队的任务。已在执行(running)的编号不算——它们
 * 无法被 DELETE,记录了也没有停队价值。
 */
export function diffNewPendingPromptIds(
  before: StoryboardBatchEngineQueueSnapshot | null,
  after: StoryboardBatchEngineQueueSnapshot,
): string[] {
  const known = new Set([...(before?.pendingPromptIds ?? []), ...(before?.runningPromptIds ?? [])]);
  return after.pendingPromptIds.filter((id) => !known.has(id));
}

/** 精确停队结果(供诊断日志与汇总文案)。 */
export interface StoryboardBatchStopQueueOutcome {
  /** 已从引擎队列撤回的本会话任务编号。 */
  deletedPromptIds: string[];
  /** 本会话仍在执行中的任务(引擎不允许 DELETE 执行项,只留痕)。 */
  runningPromptIds: string[];
  /** 队列通道失败原因(fail-soft;本地批量停止不受影响)。 */
  error?: string;
}

/**
 * 精确停队:只删除「本会话记录过 ∩ 当前仍在 pending」的队列项。
 * 他人任务不在记录器里,永远不会进 DELETE 载荷——这是本协议的硬保证。
 */
export async function stopStoryboardBatchQueuedJobs(
  tracker: StoryboardBatchPromptIdTracker,
  channel: StoryboardBatchEngineQueueChannel | undefined,
): Promise<StoryboardBatchStopQueueOutcome> {
  const empty: StoryboardBatchStopQueueOutcome = { deletedPromptIds: [], runningPromptIds: [] };
  if (!channel) return empty;
  const mine = tracker.recordedIds();
  if (mine.length === 0) return empty;
  try {
    const snapshot = await channel.getQueue();
    const minePending = snapshot.pendingPromptIds.filter((id) => tracker.has(id));
    const mineRunning = snapshot.runningPromptIds.filter((id) => tracker.has(id));
    if (minePending.length === 0) {
      return { deletedPromptIds: [], runningPromptIds: mineRunning };
    }
    await channel.deleteQueueItems(minePending);
    return { deletedPromptIds: minePending, runningPromptIds: mineRunning };
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
