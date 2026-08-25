// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetInteractionDeferForTests,
  interactionDeferBegin,
  interactionDeferEnd,
  useInteractionSettled,
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
    // 防抖窗口内仍关闸
    act(() => vi.advanceTimersByTime(999));
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
