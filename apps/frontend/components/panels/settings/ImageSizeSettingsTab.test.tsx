// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 生图引擎选择行(09-12 生图路由设置,Q1a 下拉/Q4a 生图设置页落位)。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ImageSizeSettingsTab } from "./ImageSizeSettingsTab";
import type { ImageGenerationSettings } from "@/stores/app/app-settings-store";

const baseSettings: ImageGenerationSettings = {
  defaultImageModel: "",
  defaultAspectRatio: "1:1",
  defaultResolution: "1K",
  autoDenoiseEnabled: false,
  localImageLoraEnabled: false,
  compatibilityRetryEnabled: true,
  compatibilityRetryAspectRatio: "1:1",
  compatibilityRetryResolution: "1K",
};

/** 仓库惯例属性名非 data-testid(照 data-compatibility-retry-checkbox 同款)。 */
const engineOption = (value: string) =>
  document.querySelector(`[data-image-engine-option="${value}"]`) as HTMLButtonElement | null;

describe("ImageSizeSettingsTab 生图引擎行(09-12)", () => {
  afterEach(() => cleanup());
  it("渲染引擎候选(自动/本地/云端)且选中态跟随设置值", () => {
    render(<ImageSizeSettingsTab settings={baseSettings} onChange={() => {}} />);
    expect(engineOption("auto")).toBeTruthy();
    expect(engineOption("krea2-turbo")).toBeTruthy();
    expect(engineOption("gpt-image-2")).toBeTruthy();
    // 默认空串=「自动」选中(default variant 带 backdrop-blur;未选=outline 的 bg-transparent)
    expect(engineOption("auto")?.className).toContain("backdrop-blur");
    expect(engineOption("krea2-turbo")?.className).toContain("bg-transparent");
  });

  it("点击候选回调 defaultImageModel;选中云端模型后对应按钮高亮", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ImageSizeSettingsTab settings={baseSettings} onChange={onChange} />);
    fireEvent.click(engineOption("gpt-image-2")!);
    expect(onChange).toHaveBeenCalledWith({ defaultImageModel: "gpt-image-2" });
    rerender(<ImageSizeSettingsTab settings={{ ...baseSettings, defaultImageModel: "gpt-image-2" }} onChange={onChange} />);
    expect(engineOption("gpt-image-2")?.className).toContain("backdrop-blur");
    expect(engineOption("auto")?.className).toContain("bg-transparent");
  });
});
