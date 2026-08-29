// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetInteractionDeferForTests,
  interactionDeferBegin,
  interactionDeferEnd,
  useInteractionSettled,
  whenInteractionSettled,
} from "./interaction-defer";

vi.useFakeTimers();

function Probe() {
  const settled = useInteractionSettled();
  return <span data-testid="settled">{String(settled)}</span>;
}

afterEach(() => {
  cleanup();
  __resetInteractionDeferForTests();
  vi.clearAllTimers();
});

describe("whenInteractionSettled (加载排队原语)", () => {
  it("resolves immediately when the gate is open", async () => {
    const t0 = performance.now();
    await whenInteractionSettled();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("queues until the 5s settle debounce completes, not before", async () => {
    let resolved = false;
    act(() => interactionDeferBegin());
    act(() => interactionDeferEnd());
    // 关闸中创建等待:必须挂起到 5s 防抖走完
    const p = whenInteractionSettled().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
    void p;
  });
});

describe("interaction defer gate", () => {
  it("defaults to settled (loading allowed) when never gated", () => {
    render(<Probe />);
    expect(screen.getByTestId("settled").textContent).toBe("true");
  });

  it("closes during interaction and reopens after the 1s settle debounce", () => {
    render(<Probe />);
    act(() => interactionDeferBegin());
    expect(screen.getByTestId("settled").textContent).toBe("false");

    act(() => interactionDeferEnd());
    // 防抖窗口(5s)内仍关闸
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByTestId("settled").textContent).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("settled").textContent).toBe("true");
  });

  it("keeps the gate closed while interaction continues (end debounces restart)", () => {
    render(<Probe />);
    act(() => interactionDeferBegin());
    for (let i = 0; i < 5; i++) {
      act(() => {
        interactionDeferEnd();
        vi.advanceTimersByTime(400);
        interactionDeferBegin();
      });
      expect(screen.getByTestId("settled").textContent).toBe("false");
    }
  });
});
