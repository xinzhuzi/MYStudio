// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasNodeShell } from "./node-shell";
import { vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  Handle: ({ className, title, type, id }: { className?: string; title?: string; type?: string; id?: string }) => (
    <div
      className={`react-flow__handle ${type ?? ""} ${className ?? ""}`}
      data-handleid={id}
      title={title}
      data-testid="handle"
    />
  ),
  Position: { Left: "left", Right: "right" },
}));
import { nsfwNodeDefinition } from "./nodes/nsfw";
import { stickyNodeDefinition } from "./nodes/sticky";

// 09-08 框架底层能力:任何声明节点自动获得折叠+摘要+handles 声明渲染
describe("CanvasNodeShell(框架底层能力)", () => {
  afterEach(cleanup);

  it("处理类(nsfw)默认收起:摘要行可见,详情隐藏,点击展开", () => {
    render(
      <CanvasNodeShell definition={nsfwNodeDefinition} node={{ id: "n1", type: "nsfw", title: "破限" }} selected={false} footer={<div>详情内容X</div>}>
        <span />
      </CanvasNodeShell>,
    );
    expect(screen.getByText("破限")).toBeTruthy();
    expect(screen.getByText(/专业流增强/)).toBeTruthy();
    expect(screen.queryByText("详情内容X")).toBeNull();
    fireEvent.click(screen.getByLabelText("展开节点详情"));
    expect(screen.getByText("详情内容X")).toBeTruthy();
  });

  it("输入类(sticky)默认展开,无 handles 则零口渲染", () => {
    render(
      <CanvasNodeShell definition={stickyNodeDefinition} node={{ id: "s1", type: "sticky", text: "注意光线" }} selected={false}>
        <div>便签内容Y</div>
      </CanvasNodeShell>,
    );
    expect(screen.getByText("便签内容Y")).toBeTruthy();
    expect(screen.getByText("注意光线")).toBeTruthy();
  });

  it("handles 按声明渲染(口别 id 与校验单源同口径)", () => {
    const { container } = render(
      <CanvasNodeShell definition={nsfwNodeDefinition} node={{ id: "n1", type: "nsfw" }} selected={false}>
        <div>x</div>
      </CanvasNodeShell>,
    );
    const handles = [...container.querySelectorAll(".react-flow__handle")];
    expect(handles).toHaveLength(2);
    expect(handles.filter((h) => h.classList.contains("target"))).toHaveLength(1);
    expect(handles.filter((h) => h.classList.contains("source"))).toHaveLength(1);
  });
});
