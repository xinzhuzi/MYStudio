import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus as facadeBus } from "./event-bus";
import { eventBus as canonicalBus } from "./events/event-bus";

describe("eventBus root facade", () => {
  it("re-exports the same singleton as the canonical events module", () => {
    expect(facadeBus).toBe(canonicalBus);
  });
});

describe("eventBus", () => {
  beforeEach(() => {
    facadeBus.clear("test:event");
    facadeBus.clear("test:once");
  });

  it("delivers payloads and removes a listener through the unsubscribe function", () => {
    const handler = vi.fn();
    const unsubscribe = facadeBus.on("test:event", handler);

    facadeBus.emit("test:event", { id: "asset-1" });
    unsubscribe();
    facadeBus.emit("test:event", { id: "asset-2" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ id: "asset-1" });
  });

  it("delivers a replacement listener registered during the same emit", () => {
    const replacement = vi.fn();
    const unsubscribe = facadeBus.on("test:event", () => {
      unsubscribe();
      facadeBus.on("test:event", replacement);
    });

    facadeBus.emit("test:event", "first");
    facadeBus.emit("test:event", "second");

    expect(replacement).toHaveBeenCalledTimes(2);
    expect(replacement).toHaveBeenNthCalledWith(1, "first");
  });

  it("invokes once listeners only once", () => {
    const handler = vi.fn();
    facadeBus.once("test:once", handler);

    facadeBus.emit("test:once", "first");
    facadeBus.emit("test:once", "second");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("first");
  });

  it("isolates listener failures from other listeners", () => {
    const failing = vi.fn(() => {
      throw new Error("listener failed");
    });
    const succeeding = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    facadeBus.on("test:event", failing);
    facadeBus.on("test:event", succeeding);
    facadeBus.emit("test:event", "payload");

    expect(succeeding).toHaveBeenCalledWith("payload");
    expect(errorSpy).toHaveBeenCalledWith(
      "[EventBus] Error in test:event:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("cross-module emit reaches a listener registered on the other import path", () => {
    const handler = vi.fn();
    const unsubscribe = canonicalBus.on("test:event", handler);

    facadeBus.emit("test:event", { source: "facade" });
    unsubscribe();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ source: "facade" });
  });
});
