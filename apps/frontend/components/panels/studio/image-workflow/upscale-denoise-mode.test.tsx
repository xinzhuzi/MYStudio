// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { denoiseModeToOpts, UpscaleDenoiseModeField, type UpscaleDenoiseMode } from "./upscale-denoise-mode";

afterEach(() => cleanup());

describe("denoiseModeToOpts 档位映射", () => {
  it("off=空参数(存量行为零变化)", () => {
    expect(denoiseModeToOpts("off")).toEqual({});
  });

  it("light=轻度滤波;seedvr2=模型修复(与滤波互斥)", () => {
    expect(denoiseModeToOpts("light")).toEqual({ denoise: true });
    expect(denoiseModeToOpts("seedvr2")).toEqual({ restore: true });
  });
});

describe("UpscaleDenoiseModeField 三档选择", () => {
  it("渲染三档且默认选中由 value 决定", () => {
    render(<UpscaleDenoiseModeField value="off" onChange={() => undefined} />);
    expect(screen.getByText("不处理")).toBeTruthy();
    expect(screen.getByText(/轻度滤波/)).toBeTruthy();
    expect(screen.getByText(/SeedVR2 模型修复/)).toBeTruthy();
    expect(screen.getByText(/需 ComfyUI 运行中/)).toBeTruthy();
  });

  it("点击 SeedVR2 档回调新档位", () => {
    const onChange = vi.fn();
    render(<UpscaleDenoiseModeField value={"off" as UpscaleDenoiseMode} onChange={onChange} />);
    fireEvent.click(screen.getByText(/SeedVR2 模型修复/));
    expect(onChange).toHaveBeenCalledWith("seedvr2");
  });
});
