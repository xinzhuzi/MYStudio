// @vitest-environment jsdom
// Layout 首屏挂球回归锁(09-14「全程可见」裁定):未进项目的 Dashboard 分支
// 与项目内三分支同挂 AppOrb——球由此覆盖全应用所有视图。Dashboard/TabBar 打桩
// (本测试只锁分支结构与球的挂载,不锁业务面板),AppOrb 走真实组件(端到端)。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layout } from "./Layout";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";

vi.mock("./TabBar", () => ({
  TabBar: () => <div data-testid="tab-bar-stub" />,
}));
vi.mock("./Dashboard", () => ({
  Dashboard: () => <div data-testid="dashboard-stub" />,
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useMediaPanelStore.setState({
    activeTab: "dashboard",
    inProject: false,
    navigationBackStack: [],
    navigationForwardStack: [],
  });
});

describe("Layout 首屏挂球(09-14 全程可见)", () => {
  it("未进项目的 Dashboard 分支同挂悬浮球", async () => {
    useMediaPanelStore.setState({ activeTab: "dashboard", inProject: false });
    render(<Layout />);

    // 分支正确性:Dashboard 本体在场(而非项目内分支)
    expect(screen.getByTestId("dashboard-stub")).not.toBeNull();
    // 球在场(lazy 挂载,异步等真身;data 钩子与 aria 面孔来自 AppOrb)
    // 1014 门禁关账:eda5fde1(10-11 comfyui融合)把 chapter-pipeline /
    // chapter-pipeline-stale 拽进 orbs 懒加载模块图,VT(vite-node)下 chunk
    // 装载耗时破 findByRole 默认 1s 窗(bisect 665 commits 首坏=eda5fde1;
    // 探针实测 import 落定 ~2.8s、本用例球 ~1.1s 挂上,timeout 8s 即绿)——
    // 只放宽等待窗,断言零改。
    const orb = await screen.findByRole(
      "button",
      { name: /导航：/ },
      { timeout: 8000 },
    );
    expect(orb.getAttribute("data-workflow-orb")).not.toBeNull();
  });
});
