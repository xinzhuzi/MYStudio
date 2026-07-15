// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceSettingsTab } from "./AppearanceSettingsTab";
import { AdvancedSettingsTab } from "./AdvancedSettingsTab";
import { ImageSizeSettingsTab } from "./ImageSizeSettingsTab";
import { SupportSettingsTab } from "./SupportSettingsTab";

afterEach(cleanup);

describe("settings leaf tabs", () => {
  it("renders appearance presets from the theme store", () => {
    render(<AppearanceSettingsTab />);

    expect(screen.getByRole("heading", { name: "外观皮肤" })).toBeTruthy();
    expect(screen.getByText(/^当前：/)).toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
  });

  it("renders support payment and contact images with accessible names", () => {
    render(<SupportSettingsTab />);

    expect(screen.getByRole("heading", { name: "请作者喝杯咖啡" })).toBeTruthy();
    expect(screen.getByAltText("微信收款码")).toBeTruthy();
    expect(screen.getByAltText("支付宝收款码")).toBeTruthy();
    expect(screen.getByAltText("作者微信")).toBeTruthy();
  });

  it("reports image size changes without owning persistence", () => {
    const onChange = vi.fn();
    render(
      <ImageSizeSettingsTab
        settings={{
          defaultAspectRatio: "16:9",
          defaultResolution: "2K",
          compatibilityRetryEnabled: true,
          compatibilityRetryAspectRatio: "1:1",
          compatibilityRetryResolution: "1K",
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("heading", { name: "图片规格" })).toBeTruthy();
    expect(screen.getByText("GPT Image 规格矩阵")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "1:1" })[0]!);
    expect(onChange).toHaveBeenCalledWith({ defaultAspectRatio: "1:1" });
  });

  it("delegates advanced option changes and reset actions", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <AdvancedSettingsTab
        options={{
          enableVisualContinuity: true,
          enableResumeGeneration: true,
          enableContentModeration: true,
          enableAutoModelSwitch: false,
        }}
        onChange={onChange}
        onReset={onReset}
      />,
    );

    fireEvent.click(screen.getAllByRole("switch")[0]!);
    expect(onChange).toHaveBeenCalledWith("enableVisualContinuity", false);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
