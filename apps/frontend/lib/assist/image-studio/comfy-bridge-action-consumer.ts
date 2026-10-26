import type { ComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { logEvent } from "@/lib/diagnostics/logger";

type BridgeAction = NonNullable<Awaited<ReturnType<ComfyEngineClient["getBridgeActions"]>>>["items"][number];

type ConsumeActionsOptions = {
  client: Pick<ComfyEngineClient, "getBridgeActions" | "ackBridgeActions">;
  projectId: string | null;
  episodeId: string;
  isActive: () => boolean;
  handlerFor: (item: BridgeAction) => (() => void | Promise<void>) | undefined;
  onError: (error: unknown) => void;
};

// The sidecar has one queue shared by every canvas mount. Keep dispatch receipts
// until the server no longer lists them; an uncertain ack must never rerun a
// paid handler. The epoch prevents receipts leaking across sidecar restarts.
let deliveryTail: Promise<void> = Promise.resolve();
let receiptQueueId: string | undefined;
let ackFailureReported = false;
const dispatched = new Set<number>();
const deferredReported = new Set<number>();
const RECEIPT_KEY = "mystudio-comfy-action-receipts-v1";
const RECEIPT_CAP = 20;

function readReceipts(queueId: string): number[] {
  const raw = window.localStorage.getItem(RECEIPT_KEY);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("queueId" in value) || typeof value.queueId !== "string"
    || !("ids" in value) || !Array.isArray(value.ids) || value.ids.length > RECEIPT_CAP
    || !value.ids.every((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    throw new Error("制作动作收据损坏，已暂停派发以防重复执行");
  }
  return value.queueId === queueId ? value.ids as number[] : [];
}

function writeReceipts(queueId: string, ids: Set<number>): void {
  if (ids.size > RECEIPT_CAP) throw new Error("制作动作收据超过队列上限，已暂停派发");
  window.localStorage.setItem(RECEIPT_KEY, JSON.stringify({ queueId, ids: [...ids] }));
}

/**
 * 滞留动作一次性现形(livefire9 静默失败死点):消费腿对「项目/章不匹配或
 * 无处理器」的动作原样 continue——零 toast 零 run 零日志,用户点击无声蒸发。
 * 滞留语义保留(切回对应章后仍会补发),但每个动作每队列纪元必须警告一次:
 * onError→宿主 toast + diagnostics logEvent(App 日志留痕,装机事后可取证)。
 */
function reportDeferredOnce(item: BridgeAction, options: ConsumeActionsOptions, message: string): void {
  if (deferredReported.has(item.id)) return;
  deferredReported.add(item.id);
  void logEvent({
    level: "warn",
    category: "workflow",
    message: "comfyAction.deferred",
    context: {
      itemId: item.id,
      kind: item.kind,
      originProjectId: item.originProjectId ?? null,
      originEpisodeId: item.originEpisodeId ?? null,
      activeProjectId: options.projectId,
      activeEpisodeId: options.episodeId,
    },
  });
  options.onError(new Error(message));
}

export function consumeComfyBridgeActions(options: ConsumeActionsOptions): Promise<void> {
  const consume = async () => {
    if (!options.isActive()) return;
    // IDs restart with the in-memory sidecar queue. Always fetch pending items;
    // a remembered numeric cursor could otherwise hide the replacement queue.
    const listed = await options.client.getBridgeActions(0);
    if (!listed?.queueId || !options.isActive()) return;
    const pending = new Set(listed.items.map((item) => item.id));
    try {
      const stored = readReceipts(listed.queueId);
      if (receiptQueueId !== listed.queueId) {
        receiptQueueId = listed.queueId;
        dispatched.clear();
        deferredReported.clear();
        ackFailureReported = false;
      }
      stored.forEach((id) => dispatched.add(id));
      for (const id of dispatched) if (!pending.has(id)) dispatched.delete(id);
      for (const id of deferredReported) if (!pending.has(id)) deferredReported.delete(id);
      writeReceipts(listed.queueId, dispatched);
    } catch {
      options.onError(new Error("制作动作收据无法安全保存，已暂停派发；请检查本地存储后重试"));
      return;
    }
    const acknowledged: number[] = [];
    for (const item of listed.items) {
      if (!Number.isSafeInteger(item.id) || item.id <= 0) continue;
      if (dispatched.has(item.id)) {
        acknowledged.push(item.id);
        continue;
      }
      if (!options.isActive()) break;
      if (!options.projectId || item.originProjectId !== options.projectId
        || !options.episodeId || item.originEpisodeId !== options.episodeId) {
        // livefire9 死点:章/项目不匹配的动作此前无声 continue。滞留可见化
        // (一次性),滞留语义不变——切回对应章后下轮 tick 照常补发。
        reportDeferredOnce(item, options, `制作动作未执行：画布动作来自 项目${item.originProjectId ?? "未绑定"}/章节${item.originEpisodeId ?? "未绑定"}，`
          + `当前为 项目${options.projectId ?? "未绑定"}/章节${options.episodeId}；动作已保留，切回对应章节后会自动执行`);
        continue;
      }
      const handler = options.handlerFor(item);
      if (!handler) {
        reportDeferredOnce(item, options, `制作动作未执行：当前画布视图不处理动作 ${item.kind}，动作已保留在队列`);
        continue;
      }
      // Invocation can start an external operation before throwing. Retain its
      // receipt even on failure so retries only repeat ack, never that operation.
      dispatched.add(item.id);
      try {
        // Persist before invocation: reload may otherwise repeat paid work
        // after an uncertain ack. A crash in this tiny gap requires user retry.
        writeReceipts(listed.queueId, dispatched);
      } catch {
        dispatched.delete(item.id);
        options.onError(new Error("制作动作收据保存失败，动作尚未派发，请检查本地存储后重试"));
        break;
      }
      acknowledged.push(item.id);
      // 派发即留痕(livefire9「App 日志净」式事后取证无法区分「派发过但
      // handler 死」vs「从未派发」)——diagnostics 记录派发事实,结局由
      // handler 自身日志/onError 补全。
      void logEvent({
        level: "info",
        category: "workflow",
        message: "comfyAction.dispatch",
        context: {
          itemId: item.id,
          kind: item.kind,
          originProjectId: item.originProjectId ?? null,
          originEpisodeId: item.originEpisodeId ?? null,
        },
      });
      try {
        await handler();
      } catch (error) {
        options.onError(error);
      }
    }
    if (acknowledged.length > 0) {
      // Exact IDs preserve foreign-project and unsupported actions between the
      // dispatched ones. Null/rejection retains receipts for the next poll.
      try {
        const result = await options.client.ackBridgeActions(Math.max(...acknowledged), listed.queueId, acknowledged);
        if (result === null) throw new Error("制作动作确认未送达，将自动重试确认；已派发动作不会重复执行");
        ackFailureReported = false;
      } catch (error) {
        if (!ackFailureReported) options.onError(error);
        ackFailureReported = true;
      }
    }
  };
  const result = deliveryTail.then(consume);
  deliveryTail = result.catch(() => undefined);
  return result;
}
