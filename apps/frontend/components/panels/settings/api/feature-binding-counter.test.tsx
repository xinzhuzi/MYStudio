// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { FeatureBindingPanel } from "./FeatureBindingPanel";
import { useAPIConfigStore } from "@/stores/ai/api-config-store";

describe("FeatureBindingPanel 已配置计数器", () => {
  let snapshot: ReturnType<typeof useAPIConfigStore.getState>;

  beforeEach(() => {
    snapshot = useAPIConfigStore.getState();
    useAPIConfigStore.setState({
      providers: [
        { id: "p1", platform: "custom", name: "测试供应商", apiKey: "k1", baseUrl: "https://example.com/v1", model: ["m1"] },
      ],
      modelTypes: {},
      modelTags: {},
      featureBindings: {
        chat: null,
        script_analysis: null,
        character_generation: null,
        scene_generation: null,
        prop_generation: null,
        video_generation: null,
        image_understanding: null,
        freedom_image: null,
        freedom_video: null,
        tts: null,
      },
    });
  });

  afterEach(() => {
    useAPIConfigStore.setState(snapshot, true);
  });

  it("仅变更 featureBindings 时计数器即时跟随(陈旧 useMemo 缓存回归锁)", () => {
    const { unmount } = render(<FeatureBindingPanel />);

    expect(screen.getByText(/已配置:\s*0\s*\/\s*9/)).toBeTruthy();
    expect(screen.getByText("部分服务未配置")).toBeTruthy();

    // 只走绑定变更路径(不动 providers/modelTypes/modelTags)——旧代码此处计数器不刷新
    act(() => {
      useAPIConfigStore.getState().setFeatureBindings("script_analysis", ["p1:m1"]);
    });

    expect(screen.getByText(/已配置:\s*1\s*\/\s*9/)).toBeTruthy();
    // 尚有 8 项未配置,横幅仍在;再全部清空后横幅仍在是预期(其余功能未配)
    unmount();
  });
});
