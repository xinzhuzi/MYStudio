import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCanvasCommandBusForTests,
  addCanvasCommandMiddleware,
  dispatchCanvasCommand,
  registerCanvasDispatcher,
  type CanvasCommand,
} from "./canvas-commands";

afterEach(__resetCanvasCommandBusForTests);

const cmd = (overrides?: Partial<CanvasCommand>): CanvasCommand => ({
  kind: "select",
  surface: "image-workflow",
  nodeId: null,
  ...overrides,
} as CanvasCommand);

describe("canvas command bus", () => {
  it("未挂载的面显式失败", () => {
    const result = dispatchCanvasCommand("image-workflow", cmd());
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("未挂载") });
  });

  it("注册→分发→注销", () => {
    const dispatcher = vi.fn(() => ({ ok: true as const }));
    const unregister = registerCanvasDispatcher("image-workflow", dispatcher);
    expect(dispatchCanvasCommand("image-workflow", cmd())).toEqual({ ok: true });
    expect(dispatcher).toHaveBeenCalledTimes(1);
    unregister();
    expect(dispatchCanvasCommand("image-workflow", cmd()).ok).toBe(false);
  });

  it("surface 不一致显式拒绝", () => {
    registerCanvasDispatcher("image-workflow", vi.fn(() => ({ ok: true as const })));
    const result = dispatchCanvasCommand("production-flow", cmd());
    expect(result.ok).toBe(false);
  });

  it("中间件锚点:可否决/可放行,注销后失效", () => {
    registerCanvasDispatcher("image-workflow", vi.fn(() => ({ ok: true as const })));
    const fence = vi.fn((_c, next) => next(_c));
    const removeMiddleware = addCanvasCommandMiddleware(fence);
    dispatchCanvasCommand("image-workflow", cmd());
    expect(fence).toHaveBeenCalledTimes(1);
    removeMiddleware();
    dispatchCanvasCommand("image-workflow", cmd());
    expect(fence).toHaveBeenCalledTimes(1);
  });
});
