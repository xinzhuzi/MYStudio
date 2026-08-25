// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionDeferHint } from "./interaction-defer-hint";
import {
  __resetInteractionDeferForTests,
  interactionDeferBegin,
  interactionDeferEnd,
} from "./interaction-defer";

vi.useFakeTimers({ now: 1000000 });

afterEach(() => {
  cleanup();
  __resetInteractionDeferForTests();
  vi.clearAllTimers();
});

describe("InteractionDeferHint", () => {
  it("renders nothing while settled", () => {
    render(<InteractionDeferHint />);
    expect(document.querySelector("[data-interaction-defer-hint]")).toBeNull();
  });

  it("shows the paused label during active interaction", () => {
    render(<InteractionDeferHint />);
    act(() => interactionDeferBegin());
    expect(screen.getByText("交互中 · 已暂停加载")).toBeTruthy();
    expect(
      document.querySelector("[data-interaction-defer-hint]")?.getAttribute("data-interaction-defer-hint"),
    ).toBe("active");
  });

  it("shows a 5s countdown after the gesture ends, then disappears when loading resumes", async () => {
    render(<InteractionDeferHint />);
    act(() => interactionDeferBegin());
    await act(async () => {
      interactionDeferEnd();
      await vi.advanceTimersByTimeAsync(0);
    });
    // 停手瞬间:倒计时从 5 起
    expect(screen.getByText("5s 后加载图片")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3200);
    });
    expect(screen.getByText("2s 后加载图片")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });
    expect(document.querySelector("[data-interaction-defer-hint]")).toBeNull();
  });

  it("switches back from countdown to paused when interaction resumes", async () => {
    render(<InteractionDeferHint />);
    act(() => interactionDeferBegin());
    await act(async () => {
      interactionDeferEnd();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("5s 后加载图片")).toBeTruthy();
    act(() => interactionDeferBegin());
    expect(screen.getByText("交互中 · 已暂停加载")).toBeTruthy();
  });
});
