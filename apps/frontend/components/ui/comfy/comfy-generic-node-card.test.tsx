// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Radix Slider(参数区数值控件)在 jsdom 需要 ResizeObserver(仓库惯例:各测试文件自行 stub)
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @vitest-environment jsdom
// 通用节点卡展示壳测试:标题区(中文名+英文原名 tooltip)、端口分栏+类型色点、
// 参数折叠展开、values/onWidgetChange 接线、空态兜底(B 节验收面)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyGenericNodeCard } from "./comfy-generic-node-card";
import type { ComfyGenericPortDef, ComfyGenericNodeCardProps } from "./comfy-generic-node-card";

afterEach(cleanup);

const PORTS: ComfyGenericPortDef[] = [
  { id: "model", label: "model", type: "MODEL", side: "input" },
  { id: "image", label: "image", type: "IMAGE", side: "input" },
  { id: "IMAGE", label: "IMAGE", type: "IMAGE", side: "output" },
];

const WIDGETS: ComfyGenericNodeCardProps["widgets"] = [
  { id: "steps", type: "INT", label: "steps", zhLabel: "步数", min: 1, max: 30, step: 1, default: 4 },
  { id: "sampler", type: "COMBO", label: "sampler", options: ["euler", "heun"], default: "euler" },
];

function renderCard(overrides: Partial<ComfyGenericNodeCardProps> = {}) {
  const props: ComfyGenericNodeCardProps = {
    title: "K 采样器",
    titleEn: "KSampler",
    badge: "GPL-3.0",
    ports: PORTS,
    widgets: WIDGETS,
    ...overrides,
  };
  return render(<ComfyGenericNodeCard {...props} />);
}

describe("ComfyGenericNodeCard 标题区", () => {
  it("中文名渲染;英文原名进 tooltip;徽章可见", () => {
    renderCard();
    expect(screen.getByText("K 采样器")).toBeTruthy();
    expect(screen.getByText("K 采样器").closest("[title]")?.getAttribute("title")).toContain("KSampler");
    expect(screen.getByText("GPL-3.0")).toBeTruthy();
  });

  it("无 titleEn 时 tooltip 回落中文名本身,不报错", () => {
    renderCard({ titleEn: undefined });
    expect(screen.getByText("K 采样器").closest("[title]")?.getAttribute("title")).toBe("K 采样器");
  });
});

describe("ComfyGenericNodeCard 端口区(左右分栏+类型色点)", () => {
  it("输入左/输出右分栏;色点走 CSS 变量方案(var(--comfy-port-*)双形式)", () => {
    const { container } = renderCard();
    const inputCol = screen.getByLabelText("输入端口");
    const outputCol = screen.getByLabelText("输出端口");
    expect(inputCol.textContent).toContain("model");
    expect(inputCol.textContent).toContain("image");
    expect(outputCol.textContent).toContain("IMAGE");
    // 色点:MODEL 绿 / IMAGE 紫,经 comfyPortCssColor 的内联变量形式
    const dots = container.querySelectorAll<HTMLElement>("[style*='--comfy-port']");
    const colors = Array.from(dots).map((dot) => dot.style.backgroundColor);
    expect(colors).toContain("var(--comfy-port-model, #57B87B)");
    expect(colors).toContain("var(--comfy-port-image, #7C6CF0)");
    // 端口 tooltip 带类型原文+中文语义
    expect(screen.getByTitle("model · MODEL(模型)")).toBeTruthy();
  });

  it("空态:无端口显示「无端口」;单侧为空显示占位", () => {
    renderCard({ ports: [] });
    expect(screen.getByText(/无端口/)).toBeTruthy();
    cleanup();
    renderCard({ ports: [{ id: "out", label: "IMAGE", type: "IMAGE", side: "output" }] });
    expect(screen.getByText("无输入")).toBeTruthy();
  });
});

describe("ComfyGenericNodeCard 参数区(高级参数折叠)", () => {
  it("默认折叠:控件不渲染;展开后五类控件按 schema 渲染", () => {
    renderCard();
    expect(screen.queryByLabelText("步数")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /高级参数\(2\)/ }));
    expect(screen.getByLabelText("步数")).toBeTruthy();
    expect(screen.getByLabelText("sampler")).toBeTruthy();
  });

  it("values/onWidgetChange 接线:values 驱动回显,控件改动回调 (widgetId, value)", () => {
    const onWidgetChange = vi.fn();
    renderCard({
      values: { steps: 12, sampler: "heun" },
      onWidgetChange,
      defaultExpanded: true,
    });
    expect((screen.getByLabelText("步数") as HTMLInputElement).value).toBe("12");
    expect((screen.getByLabelText("sampler") as HTMLSelectElement).value).toBe("heun");
    fireEvent.change(screen.getByLabelText("sampler"), { target: { value: "euler" } });
    expect(onWidgetChange).toHaveBeenCalledWith("sampler", "euler");
  });

  it("缺项 values 走 schema.default;不传 onWidgetChange 交互不炸", () => {
    renderCard({ values: {}, defaultExpanded: true });
    expect((screen.getByLabelText("步数") as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText("sampler") as HTMLSelectElement).value).toBe("euler");
    // 未接线回调时改动控件:内部态自持,无异常
    fireEvent.change(screen.getByLabelText("sampler"), { target: { value: "heun" } });
    expect((screen.getByLabelText("sampler") as HTMLSelectElement).value).toBe("heun");
  });

  it("widgets 为空 → 折叠区展开显示「无参数」兜底", () => {
    renderCard({ widgets: [], defaultExpanded: true });
    expect(screen.getByText(/无参数/)).toBeTruthy();
  });
});
