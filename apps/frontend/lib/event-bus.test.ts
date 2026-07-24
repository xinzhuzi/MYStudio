import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "./event-bus";

describe("eventBus", () => {
  beforeEach(() => {
    eventBus.clear("test:event");
    eventBus.clear("test:once");
  });

  it("delivers payloads and removes a listener through the unsubscribe function", () => {
    const handler = vi.fn();
    const unsubscribe = eventBus.on("test:event", handler);

    eventBus.emit("test:event", { id: "asset-1" });
    unsubscribe();
    eventBus.emit("test:event", { id: "asset-2" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ id: "asset-1" });
  });

  it("invokes once listeners only once", () => {
    const handler = vi.fn();
    eventBus.once("test:once", handler);

    eventBus.emit("test:once", "first");
    eventBus.emit("test:once", "second");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("first");
  });

  it("isolates listener failures from other listeners", () => {
    const failing = vi.fn(() => {
      throw new Error("listener failed");
    });
    const succeeding = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    eventBus.on("test:event", failing);
    eventBus.on("test:event", succeeding);
    eventBus.emit("test:event", "payload");

    expect(succeeding).toHaveBeenCalledWith("payload");
    expect(errorSpy).toHaveBeenCalledWith(
      "[EventBus] Error in test:event:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
