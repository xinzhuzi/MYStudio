// @vitest-environment jsdom
// LiveJobFeedback 原语测试(apple-hig-design-overhaul 活反馈铺开)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveJobFeedback } from "./live-job-feedback";

afterEach(cleanup);

describe("LiveJobFeedback(长任务活反馈)", () => {
  it("active:五条均衡器 + 已进行计时文案", () => {
    render(<LiveJobFeedback active startedAt={Date.now() - 65_000} />);
    const bars = document.querySelectorAll("span.w-\\[3px\\], [aria-hidden] span");
    expect(bars.length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/已进行/).textContent).toMatch(/1:0\d/);
  });

  it("prefix 空串隐藏计时文案(纯均衡器场景)", () => {
    render(<LiveJobFeedback active prefix="" />);
    expect(screen.queryByText(/已进行/)).toBeNull();
  });

  it("非 active:静态条仍渲染(弱化不隐藏)", () => {
    const { container } = render(<LiveJobFeedback active={false} />);
    expect(container.querySelectorAll("span").length).toBeGreaterThan(0);
  });
});
