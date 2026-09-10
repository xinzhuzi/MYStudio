// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkflowStatusOrb } from "./WorkflowStatusOrb";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const readiness: WorkflowReadiness = {
  progress: 17,
  nextStageId: "script",
  nextActionLabel: "生成故事骨架、改编策略和结构化剧本",
  nextAction: {
    kind: "open-stage",
    stageId: "script",
    label: "进入剧本生产阶段",
    enabled: true,
  },
  stages: [
    {
      id: "manuals",
      label: "风格与导演",
      status: "ready",
      completed: ["已选择视觉手册"],
      missing: [],
      actionLabel: "选择视觉与导演手册",
    },
    {
      id: "script",
      label: "剧本生产阶段",
      status: "active",
      completed: [],
      missing: ["还没有剧本"],
      actionLabel: "生成故事骨架、改编策略和结构化剧本",
    },
    {
      id: "assets",
      label: "剧本资产管理",
      status: "blocked",
      completed: [],
      missing: ["提取角色/场景/道具"],
      actionLabel: "提取角色、场景、道具后手动生成资产",
    },
  ],
};

function renderOrb(onStageChange = vi.fn()) {
  render(
    <WorkflowStatusOrb
      readiness={readiness}
      activeStage="novel"
      onStageChange={onStageChange}
    />,
  );
  return onStageChange;
}

function getOrb() {
  return screen.getByRole("button", { name: /工作流进度/ });
}

describe("WorkflowStatusOrb", () => {
  it("渲染球本体与 smoke 定位钩子(data-workflow-orb + active-stage)", () => {
    renderOrb();
    const orb = getOrb();
    expect(orb.getAttribute("data-workflow-orb")).not.toBeNull();
    expect(orb.getAttribute("data-workflow-active-stage")).toBe("novel");
  });

  it("六段进度弧按状态着色,中心显示待推进阶段序号", () => {
    const { container } = render(<WorkflowStatusOrb readiness={readiness} activeStage="novel" onStageChange={vi.fn()} />);
    const segments = container.querySelectorAll("[data-orb-segment]");
    expect(segments).toHaveLength(3);
    expect(segments[0]!.classList.contains("stroke-success")).toBe(true);
    expect(segments[1]!.classList.contains("stroke-warning")).toBe(true);
    expect(segments[2]!.classList.contains("stroke-muted-foreground/40")).toBe(true);
    // 待推进=script=第 2 阶段
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("hover 胶囊携带阶段名/进度/缺口摘要", () => {
    const { container } = render(<WorkflowStatusOrb readiness={readiness} activeStage="novel" onStageChange={vi.fn()} />);
    const capsule = container.querySelector("[data-orb-capsule]");
    expect(capsule?.textContent).toContain("剧本生产阶段 · 1/3 · 缺：还没有剧本");
  });

  it("点击(位移小于阈值)打开面板:待推进文案+切换阶段+清单可见", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 22, clientY: 21 });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "切换阶段" })).toBeTruthy();
    expect(
      screen.getByText("生成故事骨架、改编策略和结构化剧本"),
    ).toBeTruthy();
  });

  it("面板中点击阶段项触发切换并关闭面板", async () => {
    const onStageChange = renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    const item = await screen.findByRole("button", { name: /剧本资产管理/ });
    fireEvent.click(item);
    expect(onStageChange).toHaveBeenCalledWith("assets");
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
  });

  it("图像节点图视图入口在面板中可用", async () => {
    const onStageChange = renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByRole("button", { name: /图像节点图/ }));
    expect(onStageChange).toHaveBeenCalledWith("imageWorkflow");
  });

  it("拖拽位移超过阈值不开面板", () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 80, clientY: 90 });
    expect(screen.queryByText(/待推进：/)).toBeNull();
    expect(screen.queryByRole("group", { name: "切换阶段" })).toBeNull();
  });

  it("键盘 Enter 可开合面板", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.keyDown(orb, { key: "Enter" });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
    fireEvent.keyDown(orb, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
  });
});
