// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// Radix Slider(数值控件)在 jsdom 需要 ResizeObserver(仓库惯例:各测试文件自行 stub)
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// @vitest-environment jsdom
// 五类控件测试:受控/非受控、范围钳制+step 吸附、COMBO 空选项防御、
// 未知类型兜底、标签中文优先(B 节通用节点 widget 渲染验收面)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComfyWidgetField,
  clampComfyNumber,
  resolveComfyWidgetDefault,
} from "./comfy-widget-controls";
import type { ComfyWidgetSchema } from "./comfy-widget-controls";

afterEach(cleanup);

describe("clampComfyNumber(范围钳制+step 吸附,纯函数)", () => {
  it("夹到 [min,max];吸附 step 网格(以 min 为原点);INT 取整", () => {
    expect(clampComfyNumber(15, { min: 0, max: 10 })).toBe(10);
    expect(clampComfyNumber(-3, { min: 0, max: 10 })).toBe(0);
    expect(clampComfyNumber(7, { min: 0, max: 10, step: 5 })).toBe(5);
    expect(clampComfyNumber(0.14, { min: 0, max: 1, step: 0.05 })).toBe(0.15);
    expect(clampComfyNumber(2.6, { min: 0, max: 10, integer: true })).toBe(3);
    expect(clampComfyNumber(Number.NaN, { min: 2, max: 8 })).toBe(2);
  });

  it("吸附舍入越界时二次钳制(max 不在网格上不漏出)", () => {
    expect(clampComfyNumber(10, { min: 0, max: 10, step: 3 })).toBe(9);
    expect(clampComfyNumber(10, { min: 0, max: 10, step: 3, integer: true })).toBe(9);
  });
});

describe("resolveComfyWidgetDefault(缺省值规整:BOOLEAN false / STRING 空 / COMBO 首项)", () => {
  it("BOOLEAN 缺省 false(即使 default 给了脏类型)", () => {
    expect(resolveComfyWidgetDefault({ id: "b", type: "BOOLEAN", label: "b" })).toBe(false);
    expect(
      resolveComfyWidgetDefault({ id: "b", type: "BOOLEAN", label: "b", default: "yes" } as ComfyWidgetSchema),
    ).toBe(false);
  });

  it("COMBO 取属于选项的 default,否则首项;INT 用钳制后的 default", () => {
    expect(
      resolveComfyWidgetDefault({ id: "c", type: "COMBO", label: "c", options: ["a", "b"], default: "b" }),
    ).toBe("b");
    expect(
      resolveComfyWidgetDefault({ id: "c", type: "COMBO", label: "c", options: ["a", "b"], default: "zz" }),
    ).toBe("a");
    expect(
      resolveComfyWidgetDefault({ id: "n", type: "INT", label: "n", min: 0, max: 10, default: 99 }),
    ).toBe(10);
  });
});

describe("ComfyWidgetField INT/FLOAT(滑杆+数值步进)", () => {
  it("受控:中文标签优先渲染,数值框回显 value", () => {
    render(
      <ComfyWidgetField
        schema={{ id: "steps", type: "INT", label: "steps", zhLabel: "步数", min: 1, max: 30, step: 1, default: 4 }}
        value={8}
      />,
    );
    const input = screen.getByLabelText("步数") as HTMLInputElement;
    expect(input.value).toBe("8");
    // 英文原名进 tooltip(中文标签+原文对照)
    expect(screen.getByTitle(/steps\(steps\)/).textContent).toContain("步数");
  });

  it("钳制:数值框敲越界值,失焦后 onChange 只吐钳制结果", () => {
    const onChange = vi.fn();
    render(
      <ComfyWidgetField
        schema={{ id: "cfg", type: "FLOAT", label: "cfg", min: 0, max: 10, step: 0.5, default: 5 }}
        value={5}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("cfg") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("草稿态:回车提交并吸附 step;清空后失焦=放弃修改(不吐值)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ComfyWidgetField
        schema={{ id: "steps", type: "INT", label: "steps", min: 0, max: 100, step: 5, default: 20 }}
        value={20}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("steps") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(5); // 7 → 吸附到 5
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1); // 空草稿=放弃
    // 受控值没变,输入框回落当前值
    rerender(
      <ComfyWidgetField
        schema={{ id: "steps", type: "INT", label: "steps", min: 0, max: 100, step: 5, default: 20 }}
        value={20}
        onChange={onChange}
      />,
    );
    expect((screen.getByLabelText("steps") as HTMLInputElement).value).toBe("20");
  });

  it("滑杆:拖动(键盘)吐吸附值;非受控内部态起步于 default", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ComfyWidgetField
        schema={{ id: "denoise", type: "FLOAT", label: "denoise", min: 0, max: 1, step: 0.1, default: 0.5 }}
        onChange={onChange}
      />,
    );
    // 非受控:数值框回显 schema.default
    expect((screen.getByLabelText("denoise") as HTMLInputElement).value).toBe("0.5");
    // 滑杆键盘可达(Radix role=slider,方向键调值)
    const thumb = container.querySelector('[role="slider"]') as HTMLElement;
    expect(thumb).toBeTruthy();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(0.6);
  });
});

describe("ComfyWidgetField COMBO(下拉)", () => {
  it("选项渲染+切换吐值;当前值不在候选时防御性补项", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ComfyWidgetField
        schema={{ id: "sampler", type: "COMBO", label: "sampler", options: ["euler", "heun"] }}
        value="euler"
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("sampler") as HTMLSelectElement;
    expect(select.value).toBe("euler");
    fireEvent.change(select, { target: { value: "heun" } });
    expect(onChange).toHaveBeenCalledWith("heun");
    // 上游脏值(插件更新后选项变了):补项显示真实值,不静默跳变
    rerender(
      <ComfyWidgetField
        schema={{ id: "sampler", type: "COMBO", label: "sampler", options: ["euler", "heun"] }}
        value="dpmpp_2m"
        onChange={onChange}
      />,
    );
    const select2 = screen.getByLabelText("sampler") as HTMLSelectElement;
    expect(select2.value).toBe("dpmpp_2m");
    expect(select2.options.length).toBe(3);
  });

  it("空选项防御:缺 options/空数组 → 禁用态占位「暂无可选项」,不崩", () => {
    const { rerender } = render(
      <ComfyWidgetField schema={{ id: "x", type: "COMBO", label: "x" }} onChange={vi.fn()} />,
    );
    expect(screen.getByText("暂无可选项")).toBeTruthy();
    rerender(
      <ComfyWidgetField schema={{ id: "x", type: "COMBO", label: "x", options: [] }} onChange={vi.fn()} />,
    );
    expect(screen.getByText("暂无可选项")).toBeTruthy();
  });
});

describe("ComfyWidgetField STRING(多行输入框)", () => {
  it("textarea 多行+field-sizing 随内容;输入直吐", () => {
    const onChange = vi.fn();
    render(
      <ComfyWidgetField
        schema={{ id: "prompt", type: "STRING", label: "prompt", zhLabel: "提示词", placeholder: "描述画面", default: "hello" }}
        onChange={onChange}
      />,
    );
    const area = screen.getByLabelText("提示词") as HTMLTextAreaElement;
    expect(area.value).toBe("hello");
    expect(area.className).toContain("[field-sizing:content]");
    expect(area.placeholder).toBe("描述画面");
    fireEvent.change(area, { target: { value: "a cat" } });
    expect(onChange).toHaveBeenCalledWith("a cat");
  });
});

describe("ComfyWidgetField BOOLEAN(开关)", () => {
  it("缺省 false;点击开→true;default: true 起步", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <ComfyWidgetField schema={{ id: "invert", type: "BOOLEAN", label: "invert", zhLabel: "反转" }} onChange={onChange} />,
    );
    const off = container.querySelector('[role="switch"]') as HTMLElement;
    expect(off.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(off);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(
      <ComfyWidgetField
        schema={{ id: "invert", type: "BOOLEAN", label: "invert", zhLabel: "反转", default: true }}
        onChange={onChange}
      />,
    );
    const on = container.querySelector('[role="switch"]') as HTMLElement;
    expect(on.getAttribute("aria-checked")).toBe("true");
  });
});

describe("ComfyWidgetField 兜底(未知类型/标签回落)", () => {
  it("未知 widget 类型 → 禁用输入框+「暂不支持」提示,不崩", () => {
    const { container } = render(
      <ComfyWidgetField
        schema={{ id: "vec", type: "COORDS", label: "vec", default: "1,2" } as unknown as ComfyWidgetSchema}
      />,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.title).toContain("暂不支持");
    expect(input.value).toBe("1,2");
  });

  it("标签回落:无 zhLabel 用英文原名,再无则用 id", () => {
    render(<ComfyWidgetField schema={{ id: "seed", type: "INT", label: "seed", min: 0, max: 100 }} />);
    expect(screen.getByLabelText("seed")).toBeTruthy();
    cleanup();
    render(<ComfyWidgetField schema={{ id: "seed", type: "INT", label: "", min: 0, max: 100 }} />);
    expect(screen.getByLabelText("seed")).toBeTruthy();
  });
});
