// @vitest-environment jsdom
// AppOrb(09-11 终局:球=全局模块 components/orbs,阶段仅工作流)测试:
// ①交互回归(经 AppOrb DOM 走 OrbShell 真实路径);
// ②分域矩阵:工作流=进度环+待推进+切换阶段(默认开);其他=Compass 中性面+无阶段内容;
// ③上下文默认展开与「前往」高亮;④阶段就地切换与手册门禁。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppOrb } from "./AppOrb";
import { snapToNearestEdge } from "./use-orb-position";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useStudioStore } from "@/stores/studio/studio-store";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useMediaPanelStore.setState({ activeTab: "studio" });
  useFreedomStore.getState().setActiveStudio("comfy");
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
  return screen.getByRole("button", { name: /工作流进度|导航：/ });
}

function openPanel() {
  const orb = getOrb();
  fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
}

describe("AppOrb(交互回归,接棒原工作流球)", () => {
  it("球本体 data 钩子+active-stage(工作流视图)", () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    const orb = getOrb();
    expect(orb.getAttribute("data-workflow-orb")).not.toBeNull();
    expect(orb.getAttribute("data-workflow-active-stage")).toBe("manuals");
  });

  it("进度弧仅工作流渲染(09-11:阶段只工作流有)", () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    const { container } = render(<AppOrb />);
    expect(container.querySelectorAll("[data-orb-segment]").length).toBeGreaterThan(0);
    useMediaPanelStore.setState({ activeTab: "assets" });
    const { container: c2 } = render(<AppOrb />);
    expect(c2.querySelectorAll("[data-orb-segment]").length).toBe(0);
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

  it("胶囊分域:工作流=阶段摘要;其他=当前模块名(09-11)", () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    const { container } = render(<AppOrb />);
    expect(
      container.querySelector("[data-orb-capsule]")?.textContent,
    ).toContain("/");
    useMediaPanelStore.setState({ activeTab: "assets" });
    const { container: c2 } = render(<AppOrb />);
    expect(c2.querySelector("[data-orb-capsule]")?.textContent).toContain("资产");
  });

  it("胶囊随球位左右翻:默认锚右下 → 胶囊挂左", () => {
    const { container } = render(<AppOrb />);
    expect(
      container.querySelector("[data-orb-capsule]")?.classList.contains("right-full"),
    ).toBe(true);
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
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
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

describe("AppOrb(分域矩阵·09-11:阶段仅工作流)", () => {
  it("工作流:待推进恒显+切换阶段默认展开+前往收起;阶段就地切换", async () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    openPanel();
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "切换阶段" })).toBeTruthy();
    expect(
      document.querySelectorAll("[data-orb-stage-item]").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /^前往$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    const item = document.querySelector('[data-orb-stage-item="manuals"]') as HTMLElement;
    fireEvent.click(item);
    expect(useStudioStore.getState().workflowConfig.workflowStage).toBe("manuals");
    expect(useMediaPanelStore.getState().activeTab).toBe("studio");
  });

  it("手册门禁照旧:未选手册点后续阶段被阻(toast)", async () => {
    const { toast } = await import("sonner");
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    openPanel();
    const item = await waitFor(() => {
      const el = document.querySelector('[data-orb-stage-item="script"]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(item);
    expect(toast.error).toHaveBeenCalled();
  });

  it("沉浸(本地模型):「本地模型」区默认展开(画布/配音室),阶段区在场但收起", async () => {
    useMediaPanelStore.setState({ activeTab: "freedom" });
    const { container } = render(<AppOrb />);
    openPanel();
    expect(await screen.findByRole("group", { name: "本地模型" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /配音室/ })).toBeTruthy();
    // 中转枢纽:阶段分区在场(可展开直达),但球面零进度弧、无待推进头
    expect(
      screen.getByRole("button", { name: /^切换阶段$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText(/待推进：/)).toBeNull();
    expect(container.querySelectorAll("[data-orb-segment]").length).toBe(0);
    expect(container.querySelector("[data-orb-capsule]")?.textContent).toContain("本地模型");
    expect(
      screen.getByRole("button", { name: /^前往$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("其他视图(资产):「前往」默认展开+当前模块高亮;阶段/本地模型区在场但收起", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    const { container } = render(<AppOrb />);
    openPanel();
    expect(await screen.findByRole("group", { name: "前往" })).toBeTruthy();
    expect(
      document.querySelectorAll("[data-orb-nav-view]").length,
    ).toBe(10);
    expect(
      document
        .querySelector('[data-orb-nav-view="assets"]')
        ?.classList.contains("bg-accent/60"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: /^切换阶段$/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      document
        .querySelector('[data-orb-section="local-models"] > button')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText(/待推进：/)).toBeNull();
    expect(container.querySelectorAll("[data-orb-segment]").length).toBe(0);
  });

  it("中转直达(阶段):资产视图展开「切换阶段」点手册阶段→跳工作流并落档", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    render(<AppOrb />);
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: /^切换阶段$/ }));
    const item = await waitFor(() => {
      const el = document.querySelector('[data-orb-stage-item="manuals"]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(item);
    expect(useMediaPanelStore.getState().activeTab).toBe("studio");
    expect(useStudioStore.getState().workflowConfig.workflowStage).toBe("manuals");
  });

  it("中转直达(模式):资产视图展开「本地模型」点配音室→跳本地模型并切 TTS", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    render(<AppOrb />);
    openPanel();
    await screen.findByRole("group", { name: "前往" });
    const localHeader = document.querySelector(
      '[data-orb-section="local-models"] > button',
    ) as HTMLElement;
    fireEvent.click(localHeader);
    const tts = await screen.findByRole("button", { name: /配音室/ });
    fireEvent.click(tts);
    expect(useMediaPanelStore.getState().activeTab).toBe("freedom");
    expect(useFreedomStore.getState().activeStudio).toBe("tts");
  });

  it("中转记录:「最近」记录跳转,一键回跳(studio→overview 后面板见工作流)", async () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    // 挂载后切走 → 离栈的 studio 入列
    useMediaPanelStore.setState({ activeTab: "overview" });
    // 等视图切换(含收面板效应)落定再开面板,规避机器速度竞态
    await waitFor(() =>
      expect(
        document.querySelector("[data-orb-capsule]")?.textContent,
      ).toContain("概览"),
    );
    openPanel();
    const recentHeader = await screen.findByRole("button", { name: /^最近$/ });
    fireEvent.click(recentHeader);
    const chip = await waitFor(() => {
      const el = document.querySelector('[data-orb-recent="studio"]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(chip.textContent).toContain("工作流");
    fireEvent.click(chip);
    expect(useMediaPanelStore.getState().activeTab).toBe("studio");
  });

  it("视图切换即收面板(09-11:面板不跨视图滞留;smoke 胶囊锚依赖)", async () => {
    useMediaPanelStore.setState({ activeTab: "studio" });
    render(<AppOrb />);
    openPanel();
    expect(await screen.findByText(/待推进：/)).toBeTruthy();
    useMediaPanelStore.setState({ activeTab: "assets" });
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
  });

  it("「前往」10 视口含本地模型,可跳转落 media-panel", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    render(<AppOrb />);
    openPanel();
    await screen.findByRole("group", { name: "前往" });
    expect(
      document.querySelector('[data-orb-nav-view="freedom"]')?.textContent,
    ).toContain("本地模型");
    fireEvent.click(screen.getByRole("button", { name: /^概览$/ }));
    expect(useMediaPanelStore.getState().activeTab).toBe("overview");
  });

  it("「前往」不含分镜面板入口(08-23 唯一入口裁定)", async () => {
    useMediaPanelStore.setState({ activeTab: "assets" });
    render(<AppOrb />);
    openPanel();
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
