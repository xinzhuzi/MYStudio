import { describe, expect, it, vi } from "vitest";
import {
  createBeforeQuitCleanup,
  createWindowAllClosedHandler,
  shouldCreateWindowOnActivate,
  shouldCreateWindowOnSecondInstance,
} from "./app-lifecycle";

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Electron app lifecycle", () => {
  it("does not create a BrowserWindow from activate before app is ready", () => {
    expect(shouldCreateWindowOnActivate({ isAppReady: false, openWindowCount: 0 })).toBe(false);
  });

  it("creates a BrowserWindow from activate only when ready and no windows exist", () => {
    expect(shouldCreateWindowOnActivate({ isAppReady: true, openWindowCount: 0 })).toBe(true);
    expect(shouldCreateWindowOnActivate({ isAppReady: true, openWindowCount: 1 })).toBe(false);
  });

  it("creates a BrowserWindow for a second launch only when the first app is ready without a usable window", () => {
    expect(shouldCreateWindowOnSecondInstance({ isAppReady: false, hasUsableWindow: false })).toBe(false);
    expect(shouldCreateWindowOnSecondInstance({ isAppReady: true, hasUsableWindow: true })).toBe(false);
    expect(shouldCreateWindowOnSecondInstance({ isAppReady: true, hasUsableWindow: false })).toBe(true);
  });

  it("stops local sidecars before allowing the app to quit", async () => {
    let resolveStop!: () => void;
    const stopLocalServices = vi.fn(() => new Promise<void>((resolve) => {
      resolveStop = resolve;
    }));
    const quit = vi.fn();
    const preventDefault = vi.fn();
    const handler = createBeforeQuitCleanup({ stopLocalServices, quit });

    handler({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopLocalServices).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();

    resolveStop();
    await flushPromises();

    expect(quit).toHaveBeenCalledOnce();
  });

  it("does not start duplicate sidecar cleanup while quit cleanup is already running", async () => {
    let resolveStop!: () => void;
    const stopLocalServices = vi.fn(() => new Promise<void>((resolve) => {
      resolveStop = resolve;
    }));
    const quit = vi.fn();
    const handler = createBeforeQuitCleanup({ stopLocalServices, quit });
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };
    const resumedQuitEvent = { preventDefault: vi.fn() };

    handler(firstEvent);
    handler(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(stopLocalServices).toHaveBeenCalledOnce();

    resolveStop();
    await flushPromises();
    handler(resumedQuitEvent);

    expect(quit).toHaveBeenCalledOnce();
    expect(resumedQuitEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("stops local sidecars when all windows close on macOS without quitting the app", async () => {
    const stopLocalServices = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn();
    const handler = createWindowAllClosedHandler({
      platform: "darwin",
      stopLocalServices,
      quit,
    });

    handler();
    await flushPromises();

    expect(stopLocalServices).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
  });

  it("stops local sidecars and quits when all windows close outside macOS", async () => {
    const stopLocalServices = vi.fn().mockResolvedValue(undefined);
    const quit = vi.fn();
    const handler = createWindowAllClosedHandler({
      platform: "win32",
      stopLocalServices,
      quit,
    });

    handler();
    await flushPromises();

    expect(stopLocalServices).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });
});
