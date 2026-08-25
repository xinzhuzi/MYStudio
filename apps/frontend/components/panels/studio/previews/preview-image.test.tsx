// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewImage } from "./preview-image";
import {
  __resetInteractionDeferForTests,
  interactionDeferBegin,
  interactionDeferEnd,
} from "./interaction-defer";

vi.useFakeTimers();

afterEach(() => {
  cleanup();
  __resetInteractionDeferForTests();
  vi.clearAllTimers();
});

describe("PreviewImage interaction gate", () => {
  it("renders the img immediately when settled (default)", () => {
    render(<PreviewImage src="project-file://p/a.png" alt="已稳定" />);
    expect(document.querySelector("img")).toBeTruthy();
  });

  it("renders a placeholder without any network while interaction is active", () => {
    interactionDeferBegin();
    render(<PreviewImage src="project-file://p/b.png" alt="交互中" />);
    expect(document.querySelector("img")).toBeNull();
    const placeholder = document.querySelector("[data-preview-image-deferred]");
    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute("data-preview-image-deferred")).toBe("交互中");
  });

  it("loads only after the 1s settle debounce ends", async () => {
    interactionDeferBegin();
    render(<PreviewImage src="project-file://p/c.png" alt="防抖" />);
    await act(async () => {
      interactionDeferEnd();
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(document.querySelector("img")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(document.querySelector("img")).toBeTruthy();
    expect((document.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(
      "project-file://p/c.png",
    );
  });

  it("keeps already-revealed images mounted when the gate closes again (sticky reveal)", async () => {
    render(<PreviewImage src="project-file://p/d.png" alt="粘性" />);
    expect(document.querySelector("img")).toBeTruthy();
    interactionDeferBegin();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("img")).toBeTruthy();
    expect(document.querySelector("[data-preview-image-deferred]")).toBeNull();
  });
});
