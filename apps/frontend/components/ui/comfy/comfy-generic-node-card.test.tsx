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
// 通用节点卡测试(09-09 照 ComfyUI 节点布局重写):standalone 标题条(可省)、
// 端口行沿左右缘(色点压边+类型色)、控件体内直显(默认可见,标题条箭头收起)、
// values/onWidgetChange 接线、handleRenderer 逐口注入、空态兜底。
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

describe("ComfyGenericNodeCard 标题条(仅 standalone 渲染)", () => {
  it("传 title:标题条渲染,英文原名进 tooltip,徽章可见", () => {
    renderCard();
    expect(screen.getByText("K 采样器")).toBeTruthy();
    expect(screen.getByText("K 采样器").closest("[title]")?.getAttribute("title")).toContain("KSampler");
    expect(screen.getByText("GPL-3.0")).toBeTruthy();
  });

  it("不传 title(画布集成):无标题条,只剩端口行+控件行(body-only)", () => {
    renderCard({ title: undefined, titleEn: "ImageBlur" });
    expect(screen.queryByText("K 采样器")).toBeNull();
    expect(screen.getByText("model")).toBeTruthy(); // 端口行照常
  });
});

describe("ComfyGenericNodeCard 端口行(输入左缘/输出右缘+类型色点)", () => {
  it("输入/输出逐行配对渲染;色点走 CSS 变量方案(var(--comfy-port-*)双形式)", () => {
    const { container } = renderCard();
    expect(screen.getByText("model")).toBeTruthy();
    expect(screen.getByText("image")).toBeTruthy();
    expect(screen.getByText("IMAGE")).toBeTruthy();
    // 色点:MODEL 绿 / IMAGE 紫,经 comfyPortCssColor 的内联变量形式
    const dots = container.querySelectorAll<HTMLElement>("[data-comfy-port-dot]");
    const colors = Array.from(dots).map((dot) => dot.style.backgroundColor);
    expect(colors).toContain("var(--comfy-port-model, #57B87B)");
    expect(colors).toContain("var(--comfy-port-image, #7C6CF0)");
    // 端口 tooltip 带类型原文+中文语义
    expect(screen.getByTitle("model · MODEL(模型)")).toBeTruthy();
  });

  it("handleRenderer:每个端口调用一次(集成层锚 Handle 进端口行)", () => {
    const handleRenderer = vi.fn(
      (port: ComfyGenericPortDef) => <span key={port.id} data-testid="row-handle">{port.id}</span>,
    );
    renderCard({ handleRenderer });
    expect(handleRenderer).toHaveBeenCalledTimes(3);
    const rendered = screen.getAllByTestId("row-handle").map((node) => node.textContent);
    expect(rendered).toEqual(["model", "IMAGE", "image"]); // 行序:第1行 model+IMAGE,第2行 image
  });

  it("空态:无端口显示「无端口」", () => {
    renderCard({ ports: [] });
    expect(screen.getByText(/无端口/)).toBeTruthy();
  });
});

describe("ComfyGenericNodeCard 控件区(照 ComfyUI:体内直显,默认可见)", () => {
  it("默认可见:五类控件按 schema 直接渲染,不再藏「高级参数」折叠", () => {
    renderCard();
    expect(screen.getByLabelText("步数")).toBeTruthy();
    expect(screen.getByLabelText("sampler")).toBeTruthy();
    expect(screen.queryByText(/高级参数/)).toBeNull();
  });

  it("standalone 标题条箭头可收起/展开控件(收起保端口行)", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "收起节点参数" }));
    expect(screen.queryByLabelText("步数")).toBeNull();
    expect(screen.getByText("model")).toBeTruthy(); // 端口行保留
    fireEvent.click(screen.getByRole("button", { name: "展开节点参数" }));
    expect(screen.getByLabelText("步数")).toBeTruthy();
  });

  it("defaultExpanded:false 起步收起;点「参数(N)已收起」展开", () => {
    renderCard({ defaultExpanded: false });
    expect(screen.queryByLabelText("步数")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /参数\(2\)已收起/ }));
    expect(screen.getByLabelText("步数")).toBeTruthy();
  });

  it("values/onWidgetChange 接线:values 驱动回显,控件改动回调 (widgetId, value)", () => {
    const onWidgetChange = vi.fn();
    renderCard({ values: { steps: 12, sampler: "heun" }, onWidgetChange });
    expect((screen.getByLabelText("步数") as HTMLInputElement).value).toBe("12");
    expect((screen.getByLabelText("sampler") as HTMLSelectElement).value).toBe("heun");
    fireEvent.change(screen.getByLabelText("sampler"), { target: { value: "euler" } });
    expect(onWidgetChange).toHaveBeenCalledWith("sampler", "euler");
  });

  it("缺项 values 走 schema.default;不传 onWidgetChange 交互不炸", () => {
    renderCard({ values: {} });
    expect((screen.getByLabelText("步数") as HTMLInputElement).value).toBe("4");
    fireEvent.change(screen.getByLabelText("sampler"), { target: { value: "heun" } });
    expect((screen.getByLabelText("sampler") as HTMLSelectElement).value).toBe("heun");
  });

  it("widgets 为空 → 「无参数」兜底", () => {
    renderCard({ widgets: [] });
    expect(screen.getByText(/无参数/)).toBeTruthy();
  });
});
