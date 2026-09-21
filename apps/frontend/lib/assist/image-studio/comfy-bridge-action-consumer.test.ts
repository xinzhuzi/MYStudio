// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeComfyBridgeActions } from "./comfy-bridge-action-consumer";

type Action = { id: number; kind: string; originProjectId?: string; originEpisodeId?: string };
afterEach(() => { vi.restoreAllMocks(); window.localStorage.removeItem("mystudio-comfy-action-receipts-v1"); });
let sequence = 0;
function fixture(items: Action[]) {
  const state = { items: items.map((item) => ({ originEpisodeId: "chapter-a", ...item })), queueId: `test-queue-${++sequence}` };
  const client = {
    getBridgeActions: vi.fn(async (cursor: number) => ({ cursor, queueId: state.queueId, items: [...state.items] })),
    ackBridgeActions: vi.fn(async (_upTo: number, _queueId?: string, ids?: number[]): Promise<number | null> => {
      state.items = state.items.filter((item) => !ids?.includes(item.id));
      return ids?.length ?? 0;
    }),
  };
  const handler = vi.fn();
  const options = { client, projectId: "a", episodeId: "chapter-a", isActive: () => true, handlerFor: () => handler, onError: vi.fn() };
  return { state, client, handler, options };
}

describe("Comfy bridge action delivery", () => {
  it("retains foreign and unbound actions while exactly acknowledging active-project actions", async () => {
    const { options, client, handler, state } = fixture([
      { id: 1, kind: "generate-images", originProjectId: "b" },
      { id: 2, kind: "generate-images" },
      { id: 3, kind: "generate-images", originProjectId: "a" },
    ]);
    await consumeComfyBridgeActions(options);
    expect(handler).toHaveBeenCalledOnce();
    expect(client.ackBridgeActions).toHaveBeenCalledWith(3, state.queueId, [3]);
    expect(state.items.map((item) => item.id)).toEqual([1, 2]);
  });

  it("retries uncertain ack across a new caller without dispatching again", async () => {
    const { options, client, handler } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    client.ackBridgeActions.mockResolvedValueOnce(null);
    await consumeComfyBridgeActions(options);
    const replacementHandler = vi.fn();
    await consumeComfyBridgeActions({ ...options, handlerFor: () => replacementHandler });
    expect(handler).toHaveBeenCalledOnce();
    expect(replacementHandler).not.toHaveBeenCalled();
    expect(client.ackBridgeActions).toHaveBeenCalledTimes(2);
  });

  it("allows reused numeric IDs only after the queue epoch changes", async () => {
    const { options, client, handler, state } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    client.ackBridgeActions.mockResolvedValueOnce(null);
    await consumeComfyBridgeActions(options);
    state.queueId += "-restarted";
    await consumeComfyBridgeActions(options);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(client.getBridgeActions.mock.calls).toEqual([[0], [0]]);
    expect(client.ackBridgeActions).toHaveBeenLastCalledWith(1, state.queueId, [1]);
  });

  it("does not dispatch or ack a legacy queue with no epoch", async () => {
    const { options, handler, client } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    client.getBridgeActions.mockResolvedValueOnce({ cursor: 0, queueId: "", items: [{ id: 1, kind: "generate-images", originProjectId: "a", originEpisodeId: "chapter-a" }] });
    await consumeComfyBridgeActions(options);
    expect(handler).not.toHaveBeenCalled();
    expect(client.ackBridgeActions).not.toHaveBeenCalled();
  });

  it("records invocation before a failing handler so its side effects cannot auto-repeat", async () => {
    const { options, handler, client } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    handler.mockRejectedValue(new Error("failed after dispatch"));
    client.ackBridgeActions.mockRejectedValueOnce(new Error("ack failed"));
    await consumeComfyBridgeActions(options);
    await consumeComfyBridgeActions(options);
    expect(handler).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledTimes(2);
  });

  it("does not run the next action after project lifetime ends while a handler is pending", async () => {
    const { options, handler, client } = fixture([
      { id: 1, kind: "generate-images", originProjectId: "a" },
      { id: 2, kind: "generate-videos", originProjectId: "a" },
    ]);
    let active = true;
    handler.mockImplementationOnce(async () => { active = false; });
    await consumeComfyBridgeActions({ ...options, isActive: () => active });
    expect(handler).toHaveBeenCalledOnce();
    expect(client.ackBridgeActions).toHaveBeenCalledWith(1, expect.any(String), [1]);
  });

  it.each(["null", "rejection"])("reports ack %s once without replay across different clients", async (failure) => {
    const { options, handler, client } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    if (failure === "null") client.ackBridgeActions.mockResolvedValue(null);
    else client.ackBridgeActions.mockRejectedValue(new Error("connection lost"));
    await consumeComfyBridgeActions(options);
    expect(options.onError).toHaveBeenCalledOnce();
    await consumeComfyBridgeActions({ ...options, client: { ...client } });
    expect(handler).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledOnce();
  });

  it("retains other chapters and legacy unbound chapters without blocking active chapter", async () => {
    const { options, handler, state } = fixture([
      { id: 1, kind: "generate-images", originProjectId: "a", originEpisodeId: "chapter-b" },
      { id: 2, kind: "generate-images", originProjectId: "a", originEpisodeId: undefined },
      { id: 3, kind: "generate-images", originProjectId: "a", originEpisodeId: "chapter-a" },
    ]);
    await consumeComfyBridgeActions(options);
    expect(handler).toHaveBeenCalledOnce();
    expect(state.items.map((item) => item.id)).toEqual([1, 2]);
  });

  it("survives renderer module reload after an uncertain ack", async () => {
    const { options, client, handler } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    client.ackBridgeActions.mockResolvedValueOnce(null);
    await consumeComfyBridgeActions(options);
    vi.resetModules();
    const reloaded = await import("./comfy-bridge-action-consumer");
    await reloaded.consumeComfyBridgeActions(options);
    expect(handler).toHaveBeenCalledOnce();
    expect(client.ackBridgeActions).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2])("refuses dispatch and ack when durable receipt write %s fails", async (failingWrite) => {
    const { options, client, handler } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    // The test setup may supply a plain-object Storage implementation. Replace
    // the exact dependency instead of spying on a possibly unrelated prototype.
    const storage = window.localStorage;
    const setItem = vi.fn(storage.setItem.bind(storage));
    for (let call = 1; call < failingWrite; call++) setItem.mockImplementationOnce(storage.setItem.bind(storage));
    setItem.mockImplementationOnce(() => { throw new Error("QuotaExceededError"); });
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: storage.getItem.bind(storage), setItem,
    } });
    try {
      await consumeComfyBridgeActions(options);
      expect(setItem).toHaveBeenCalledTimes(failingWrite);
      expect(handler).not.toHaveBeenCalled();
      expect(client.ackBridgeActions).not.toHaveBeenCalled();
      expect(options.onError).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "localStorage", descriptor);
    }
  });

  it.each(['{"queueId":"x","ids":["1"]}', '{"queueId":"x","ids":[0]}', "broken"])("fails closed for malformed durable receipt %s", async (raw) => {
    const { options, handler, client } = fixture([{ id: 1, kind: "generate-images", originProjectId: "a" }]);
    window.localStorage.setItem("mystudio-comfy-action-receipts-v1", raw);
    await consumeComfyBridgeActions(options);
    expect(handler).not.toHaveBeenCalled();
    expect(client.ackBridgeActions).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledOnce();
  });
});
