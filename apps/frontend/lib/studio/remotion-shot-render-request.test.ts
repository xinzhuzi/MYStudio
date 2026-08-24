// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  REMOTION_SHOT_RENDER_REQUEST_EVENT,
  dispatchRemotionShotRenderRequest,
  subscribeRemotionShotRenderRequest,
} from "./remotion-shot-render-request";

describe("remotion shot render request", () => {
  it("delivers the shotId to subscribers and stops after unsubscribe", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeRemotionShotRenderRequest(handler);

    dispatchRemotionShotRenderRequest("sb-2");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ shotId: "sb-2" });

    unsubscribe();
    dispatchRemotionShotRenderRequest("sb-3");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("ignores unrelated window events", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeRemotionShotRenderRequest(handler);

    window.dispatchEvent(new CustomEvent("studio:unrelated"));
    expect(handler).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("uses a stable event name", () => {
    expect(REMOTION_SHOT_RENDER_REQUEST_EVENT).toBe("studio:remotion-shot-render-request");
  });
});
