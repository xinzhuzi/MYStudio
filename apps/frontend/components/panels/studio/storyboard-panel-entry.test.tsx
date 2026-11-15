// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoryboardPanelEntryButton } from "./storyboard-panel-entry";

afterEach(cleanup);

describe("storyboard panel entry button (1115 FR4 发车口补·二裁路 2)", () => {
  it("渲染入口锚(data-storyboard-panel-entry),点击触发 onOpen", () => {
    const onOpen = vi.fn();
    const { container } = render(<StoryboardPanelEntryButton onOpen={onOpen} />);
    const btn = container.querySelector<HTMLButtonElement>("[data-storyboard-panel-entry]");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("分镜面板");
    fireEvent.click(btn!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("已在分镜面板页(hidden)时入口不渲染", () => {
    const { container } = render(<StoryboardPanelEntryButton onOpen={() => {}} hidden />);
    expect(container.querySelector("[data-storyboard-panel-entry]")).toBeNull();
  });
});
