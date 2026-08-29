// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalImage } from "./local-image";
import {
  __resetInteractionDeferForTests,
  interactionDeferBegin,
  interactionDeferEnd,
} from "@/components/panels/studio/previews/interaction-defer";

vi.useFakeTimers();

afterEach(() => {
  cleanup();
  __resetInteractionDeferForTests();
  vi.clearAllTimers();
});

describe("LocalImage interaction gate", () => {
  it("renders the img immediately when settled (default)", () => {
    render(<LocalImage src="project-file://p/a.png" alt="已稳定" />);
    expect(document.querySelector("img")).toBeTruthy();
  });

  it("renders a placeholder without any network while interaction is active", () => {
    interactionDeferBegin();
    render(<LocalImage src="project-file://p/b.png" alt="交互中" />);
    expect(document.querySelector("img")).toBeNull();
    const placeholder = document.querySelector("[data-preview-image-deferred]");
    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute("data-preview-image-deferred")).toBe("交互中");
  });

  it("loads only after the 1s settle debounce ends", async () => {
    interactionDeferBegin();
    render(<LocalImage src="project-file://p/c.png" alt="防抖" />);
    await act(async () => {
      interactionDeferEnd();
      await vi.advanceTimersByTimeAsync(4999);
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

  it("re-mounting a previously loaded src shows the img immediately, even while gated (源级粘性,不重复等待)", async () => {
    // 首次:闸开加载
    const first = render(<LocalImage src="project-file://p/seen.png" alt="首次" />);
    expect(document.querySelector("img")).toBeTruthy();
    first.unmount();
    // 关闸后全新挂载同源:必须立即可见(不再占位/不再等 5s)
    act(() => interactionDeferBegin());
    render(<LocalImage src="project-file://p/seen.png" alt="复见" />);
    expect(document.querySelector("img")).toBeTruthy();
    expect(document.querySelector("[data-preview-image-deferred]")).toBeNull();
  });

  it("keeps already-revealed images mounted when the gate closes again (sticky reveal)", async () => {
    render(<LocalImage src="project-file://p/d.png" alt="粘性" />);
    expect(document.querySelector("img")).toBeTruthy();
    interactionDeferBegin();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("img")).toBeTruthy();
    expect(document.querySelector("[data-preview-image-deferred]")).toBeNull();
  });
});

describe("LocalImage previewable (08-30 展示大图入口)", () => {
  it("does not render the preview button by default", () => {
    render(<LocalImage src="project-file://p/a.png" alt="分镜 1" className="h-full w-full" />);
    expect(document.querySelector("button[aria-label^='展示大图']")).toBeNull();
    expect(document.querySelector("img[alt='分镜 1']")).toBeTruthy();
  });

  it("opens the full-image modal with the thumb variant stripped", () => {
    render(<LocalImage src="project-file://p/a.png?thumb=1" alt="分镜 2" previewable />);
    fireEvent.click(document.querySelector("button[aria-label^='展示大图']") as HTMLElement);
    const modalImage = document.querySelector("img[alt='Preview']") as HTMLImageElement;
    expect(modalImage).toBeTruthy();
    expect(modalImage.getAttribute("src")).toBe("project-file://p/a.png");
  });

  it("stops propagation so tile click navigation is not triggered", () => {
    const onTileClick = vi.fn();
    render(
      <div onClick={onTileClick}>
        <LocalImage src="project-file://p/b.png?thumb=1" alt="分镜 3" previewable />
      </div>,
    );
    fireEvent.click(document.querySelector("button[aria-label^='展示大图']") as HTMLElement);
    expect(onTileClick).not.toHaveBeenCalled();
  });
});
