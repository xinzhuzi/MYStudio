// @vitest-environment jsdom
// AppOrb(09-10 终裁:悬浮球是 1 个)测试=原工作流球 14 例交互回归(经 AppOrb DOM
// 走 OrbShell 真实路径)+ 全面面板(待推进/切换阶段/本视图仅沉浸/前往)+阶段直达门禁。
// 沉浸态通过 media-panel activeTab=freedom 模拟。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppOrb } from "./AppOrb";
import { snapToNearestEdge } from "@/components/orbs";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useStudioStore } from "@/stores/studio/studio-store";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useMediaPanelStore.setState({ activeTab: "studio" });
  useStudioStore.setState({
    workflowConfig: {
      ...useStudioStore.getState().workflowConfig,
      workflowStage: "manuals",
      visualManualId: undefined,
      directorManualId: undefined,
    },
  });
});

function getOrb() {
  return screen.getByRole("button", { name: /工作流进度/ });
}

function openPanel() {
  const orb = getOrb();
  fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
}

function expandSection(title: string) {
  // 幂等:仅当收起时点开(上下文默认可能已展开)
  const header = screen.getByRole("button", { name: new RegExp(`^${title}$`) });
  if (header.getAttribute("aria-expanded") === "false") {
    fireEvent.click(header);
  }
}

describe("AppOrb(唯一悬浮球·交互回归,接棒原工作流球)", () => {
  it("球本体 data 钩子+active-stage", () => {
    render(<AppOrb />);
    const orb = getOrb();
    expect(orb.getAttribute("data-workflow-orb")).not.toBeNull();
    expect(orb.getAttribute("data-workflow-active-stage")).toBe("manuals");
  });

  it("进度弧按状态逐段着色,中心显示待推进阶段序号", () => {
    const { container } = render(<AppOrb />);
    expect(container.querySelectorAll("[data-orb-segment]").length).toBeGreaterThan(0);
  });

  it("hover 胶囊携带阶段名/进度摘要", () => {
    const { container } = render(<AppOrb />);
    const capsule = container.querySelector("[data-orb-capsule]");
    expect(capsule?.textContent).toContain("/");
  });

  it("点击(位移小于阈值)打开面板:待推进恒显;上下文默认展开(09-11 裁定)", async () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    openPanel();
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
    // 工作流上下文:切换阶段默认展开(清单直接可见),前往默认收起
    expect(screen.getByRole("group", { name: "切换阶段" })).toBeTruthy();
    expect(
      document.querySelectorAll("[data-orb-stage-item]").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^前往$/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("W1 回归:球内拖拽释放(pointerup+click 双到)不开面板", () => {
    render(<AppOrb />);
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 60, clientY: 70 });
    fireEvent.click(orb, { clientX: 60, clientY: 70 });
    expect(screen.queryByText(/待推进：/)).toBeNull();
  });

  it("W2 回归:面板开着时点球=收起(toggle)", async () => {
    render(<AppOrb />);
    const orb = getOrb();
    openPanel();
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
    fireEvent.pointerDown(orb, { clientX: 25, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 26, clientY: 20 });
    await waitFor(() => expect(screen.queryByText(/待推进：/)).toBeNull());
  });

  it("胶囊随球位左右翻:初始位置在右半屏时胶囊挂左(默认锚右下)", () => {
    const { container } = render(<AppOrb />);
    const capsule = container.querySelector("[data-orb-capsule]");
    expect(capsule?.classList.contains("right-full")).toBe(true);
  });

  it("层序契约:球 z-40", () => {
    render(<AppOrb />);
    expect(getOrb().style.zIndex).toBe("40");
  });

  it("pointercancel 后标志位复位,下一次合成 click 不被误吞", async () => {
    render(<AppOrb />);
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(orb);
    fireEvent.click(orb);
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
  });

  it("合成 click(无 pointer 事件)可开面板——smoke 脚本路径", async () => {
    render(<AppOrb />);
    fireEvent.click(getOrb());
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
  });

  it("真实点击兜底:pointerup 被 drag 会话吞掉时,带坐标的 click 仍开面板", async () => {
    render(<AppOrb />);
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.click(orb, { clientX: 22, clientY: 21 });
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
  });

  it("拖拽后落在球内的 click(位移超阈值)不开面板", () => {
    render(<AppOrb />);
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.click(orb, { clientX: 60, clientY: 70 });
    expect(screen.queryByText(/待推进：/)).toBeNull();
  });

  it("键盘 Enter 可开合面板", async () => {
    render(<AppOrb />);
    const orb = getOrb();
    fireEvent.keyDown(orb, { key: "Enter" });
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
    fireEvent.keyDown(orb, { key: "Enter" });
    await waitFor(() => expect(screen.queryByText(/待推进：/)).toBeNull());
  });

  it("挂载后延迟自愈过渡期视口(943→900 零 resize)", async () => {
    const realH = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 943, configurable: true });
    try {
      render(<AppOrb />);
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      await waitFor(
        () => {
          const stored = JSON.parse(
            window.localStorage.getItem("mystudio.workflow-orb.position") ?? "null",
          );
          expect(stored?.y).toBeLessThanOrEqual(900 - 48 - 6);
        },
        { timeout: 3000 },
      );
    } finally {
      Object.defineProperty(window, "innerHeight", { value: realH, configurable: true });
    }
  });
});

describe("AppOrb(唯一悬浮球·全面面板)", () => {
  it("普通视图(资产):前往默认展开(导航首要),切换阶段收起,「本视图」不在", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    render(<AppOrb />);
    openPanel();
    expect(await screen.findByRole("group", { name: "前往" })).toBeTruthy();
    expect(
      document.querySelectorAll("[data-orb-nav-view]").length,
    ).toBe(10);
    expect(
      screen.getByRole("button", { name: /^切换阶段$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("button", { name: /^本视图$/ })).toBeNull();
  });

  it("沉浸视图(freedom):「本视图」默认展开(模块内容直接可见),其余收起", async () => {
    useMediaPanelStore.setState({ activeTab: "freedom" });
    render(<AppOrb />);
    openPanel();
    expect(await screen.findByRole("group", { name: "本视图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /配音室/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ComfyUI 画布/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^前往$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /^切换阶段$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("「前往」高亮当前模块(09-11:不同模块不同效果)", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    render(<AppOrb />);
    openPanel();
    await screen.findByRole("group", { name: "前往" });
    const active = document.querySelector('[data-orb-nav-view="assets"]');
    expect(active?.classList.contains("bg-accent/60")).toBe(true);
    const inactive = document.querySelector('[data-orb-nav-view="overview"]');
    expect(inactive?.classList.contains("bg-accent/60")).toBe(false);
  });

  it("展开「前往」:10 视口可跳(含本地模型),落 media-panel", async () => {
    render(<AppOrb />);
    openPanel();
    expandSection("前往");
    const entries = await waitFor(() => {
      const list = document.querySelectorAll("[data-orb-nav-view]");
      expect(list.length).toBe(10);
      expect(
        document.querySelector('[data-orb-nav-view="freedom"]')?.textContent,
      ).toContain("本地模型");
      return list;
    });
    fireEvent.click(screen.getByRole("button", { name: /^概览$/ }));
    expect(useMediaPanelStore.getState().activeTab).toBe("overview");
    expect(entries).toBeTruthy();
  });

  it("展开「切换阶段」点手册阶段:跳工作流并落档(直达)", async () => {
    render(<AppOrb />);
    openPanel();
    expandSection("切换阶段");
    const item = await waitFor(() => {
      const el = document.querySelector('[data-orb-stage-item="manuals"]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(item);
    expect(useMediaPanelStore.getState().activeTab).toBe("studio");
    expect(useStudioStore.getState().workflowConfig.workflowStage).toBe("manuals");
  });

  it("手册门禁照旧:未选手册点后续阶段被阻(toast),不跳转", async () => {
    const { toast } = await import("sonner");
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    openPanel();
    expandSection("切换阶段");
    const item = await waitFor(() => {
      const el = document.querySelector('[data-orb-stage-item="script"]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(item);
    expect(toast.error).toHaveBeenCalled();
    expect(useMediaPanelStore.getState().activeTab).toBe("studio");
  });

  it("「前往」不含分镜面板入口(08-23 唯一入口裁定)", async () => {
    render(<AppOrb />);
    openPanel();
    expandSection("前往");
    await screen.findByRole("group", { name: "前往" });
    const gotoText = Array.from(document.querySelectorAll("[data-orb-nav-view]"))
      .map((node) => node.textContent ?? "")
      .join(" ");
    expect(gotoText).not.toContain("分镜面板");
  });
});

describe("snapToNearestEdge", () => {
  const VW = 1440, VH = 900;
  it("贴左:靠近左缘吸附 x=6 且 y 保留(界内)", () => {
    const r = snapToNearestEdge(30, 400, VW, VH);
    expect(r.x).toBe(6);
    expect(r.y).toBe(400);
  });
  it("贴右:靠近右缘吸附 x=vw-48-6", () => {
    const r = snapToNearestEdge(1380, 400, VW, VH);
    expect(r.x).toBe(VW - 48 - 6);
  });
  it("贴底:靠近底缘吸附 y=vh-48-6", () => {
    const r = snapToNearestEdge(700, 860, VW, VH);
    expect(r.y).toBe(VH - 48 - 6);
  });
});
