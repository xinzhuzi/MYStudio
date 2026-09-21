import type { ComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";

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
        ackFailureReported = false;
      }
      stored.forEach((id) => dispatched.add(id));
      for (const id of dispatched) if (!pending.has(id)) dispatched.delete(id);
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
        || !options.episodeId || item.originEpisodeId !== options.episodeId) continue;
      const handler = options.handlerFor(item);
      if (!handler) continue;
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
