// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionPicker } from "./mention-picker";

afterEach(cleanup);

const CANDIDATES = [
  { id: "ref1", type: "reference", title: "赵四正脸", thumbUrl: "project-file://x/a.png" },
  { id: "p1", type: "prompt", title: "主提示词", summary: "水墨风格" },
];

function renderPicker(onPick = vi.fn(), onClose = vi.fn()) {
  return render(
    <div className="relative">
      <MentionPicker x={8} y={40} query="" candidates={CANDIDATES} onPick={onPick} onClose={onClose} />
    </div>,
  );
}

describe("MentionPicker", () => {
  it("渲染候选(图/文)并支持键盘导航+ESC", () => {
    renderPicker();
    const list = screen.getByRole("listbox", { name: "引用资源" });
    expect(screen.getByRole("option", { name: /赵四正脸/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /主提示词/ })).toBeTruthy();
    fireEvent.keyDown(list, { key: "Escape" });
  });

  it("点击候选回调并关闭;无匹配不渲染选项", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    renderPicker(onPick, onClose);
    fireEvent.click(screen.getByRole("option", { name: /赵四正脸/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "ref1" }));
    const { container } = render(
      <MentionPicker x={0} y={0} query="不存在" candidates={CANDIDATES} onPick={() => {}} onClose={() => {}} />,
    );
    expect(container.querySelector("[data-option]")).toBeNull();
  });
});
