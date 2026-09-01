// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Radix Popover 在 jsdom 不响应合成指针 → mock 直渲染内容(仓内既有范式)
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ModelSelector } from "./ModelSelector";
import { useAPIConfigStore } from "@/stores/ai/api-config-store";

afterEach(() => cleanup());

describe("ModelSelector 本地免费引擎并入(2026-09-01 节点下拉缺口根修)", () => {
  beforeEach(() => {
    useAPIConfigStore.setState({
      getFeatureBindings: (feature: string) =>
        feature === "freedom_image" ? ["demo-provider:gpt-image-2"] : [],
      modelTypes: {},
      modelEndpointTypes: {},
    } as never, false);
  });

  it("image 清单:云端绑定之外并入全部本地引擎,归「本地免费」品牌组", () => {
    render(<ModelSelector type="image" value="" onChange={vi.fn()} />);

    // 本地五引擎全部在列(含 comfyui-bridge)
    for (const label of [
      "Krea2 Turbo (本地)",
      "FLUX.2 Klein 9B (本地)",
      "Z-Image Turbo (本地)",
      "Qwen 图像编辑 2511 (本地)",
      "ComfyUI 桥接 (本地)",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 品牌分组徽标
    expect(screen.getByText("本地免费")).toBeTruthy();
    // 云端绑定项仍在(gpt-image-2,无映射时回落原始 id)
    expect(screen.getByText("gpt-image-2")).toBeTruthy();
  });

  it("video 清单不受影响(不并入本地)", () => {
    render(<ModelSelector type="video" value="" onChange={vi.fn()} />);
    expect(screen.queryByText("本地免费")).toBeNull();
    expect(screen.queryByText("Krea2 Turbo (本地)")).toBeNull();
  });
});
