// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { OrbSection } from "./OrbSection";

afterEach(() => cleanup());

/** 受控组件:宿主持 state(与业务球用法一致)。 */
function SectionHost({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <OrbSection section="stages" title="切换阶段" open={open} onToggle={() => setOpen((v) => !v)}>
      <button type="button">阶段条目</button>
    </OrbSection>
  );
}

describe("OrbSection(折叠分区原语,09-10 裁定:默认收起点标题展开)", () => {
  it("收起态:标题行恒在 DOM,内容不进 DOM(条件渲染,非 CSS 藏)", () => {
    render(<SectionHost />);
    expect(screen.getByRole("button", { name: /切换阶段/ })).toBeTruthy();
    expect(screen.queryByText("阶段条目")).toBeNull();
  });

  it("分区根 data 契约:data-orb-section + data-state 随开合翻转", () => {
    const { container } = render(<SectionHost />);
    const root = container.querySelector("[data-orb-section='stages']");
    expect(root?.getAttribute("data-state")).toBe("closed");
    fireEvent.click(screen.getByRole("button", { name: /切换阶段/ }));
    expect(root?.getAttribute("data-state")).toBe("open");
  });

  it("点标题行展开:aria-expanded 翻真,内容挂出并带 group 语义", () => {
    render(<SectionHost />);
    const header = screen.getByRole("button", { name: /切换阶段/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "切换阶段" })).toBeTruthy();
    expect(screen.getByText("阶段条目")).toBeTruthy();
  });

  it("再点收起:内容退出 DOM", () => {
    render(<SectionHost />);
    const header = screen.getByRole("button", { name: /切换阶段/ });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.queryByText("阶段条目")).toBeNull();
  });

  it("受控 onToggle 回调被触发(宿主状态语义)", () => {
    const onToggle = vi.fn();
    render(
      <OrbSection section="views" title="本视图" open={false} onToggle={onToggle}>
        <span>内容</span>
      </OrbSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: /本视图/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
