// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { snapToNearestEdge } from "@/components/orbs";
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

  it("进度弧按状态逐段着色(六段制;fixture 3 段),中心显示待推进阶段序号", () => {
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

  it("点击(位移小于阈值)打开面板:待推进恒显;「切换阶段」分区默认收起(09-10 裁定)", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 22, clientY: 21 });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
    // 标题行在(收起态恒显),清单不在(条件渲染);「剧本资产管理」=分区条目专属文案
    const header = screen.getByRole("button", { name: /^切换阶段$/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "切换阶段" })).toBeNull();
    expect(screen.queryByText("剧本资产管理")).toBeNull();
  });

  it("AC1:工作流球面板零视图导航——无 data-orb-nav-view/模式切换入口(09-10 拆双球)", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 22, clientY: 21 });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
    expect(document.querySelectorAll("[data-orb-nav-view]").length).toBe(0);
    expect(document.querySelectorAll("[data-orb-nav-mode]").length).toBe(0);
  });

  it("点「切换阶段」标题行展开:清单挂出(折叠→展开,09-10 裁定)", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 22, clientY: 21 });
    const header = await screen.findByRole("button", { name: /^切换阶段$/ });
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "切换阶段" })).toBeTruthy();
    expect(
      screen.getByText("生成故事骨架、改编策略和结构化剧本"),
    ).toBeTruthy();
  });

  it("面板重开回默认收起(开合态不持久化)", async () => {
    renderOrb();
    const orb = getOrb();
    // 开→展开→收面板→再开
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 22, clientY: 21 });
    fireEvent.click(await screen.findByRole("button", { name: /^切换阶段$/ }));
    expect(screen.getByRole("group", { name: "切换阶段" })).toBeTruthy();
    fireEvent.pointerDown(orb, { clientX: 25, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 26, clientY: 20 });
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
    fireEvent.pointerDown(orb, { clientX: 25, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 26, clientY: 20 });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "切换阶段" })).toBeNull();
  });

  it("面板中点击阶段项触发切换并关闭面板(先展开分区)", async () => {
    const onStageChange = renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    fireEvent.click(await screen.findByRole("button", { name: /^切换阶段$/ }));
    const item = await screen.findByRole("button", { name: /剧本资产管理/ });
    fireEvent.click(item);
    expect(onStageChange).toHaveBeenCalledWith("assets");
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
  });

  it("图像节点图视图入口在面板中可用(先展开分区)", async () => {
    const onStageChange = renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 20, clientY: 20 });
    fireEvent.click(await screen.findByRole("button", { name: /^切换阶段$/ }));
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

  it("W1 回归:球内拖拽释放(pointerup+click 双到)不开面板", () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 60, clientY: 70 });
    fireEvent.click(orb, { clientX: 60, clientY: 70 });
    expect(screen.queryByText(/待推进：/)).toBeNull();
  });

  it("W2 回归:面板开着时点球=收起(toggle),不再关-开闪跳", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
    fireEvent.pointerDown(orb, { clientX: 25, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 26, clientY: 20 });
    await waitFor(() =>
      expect(screen.queryByText(/待推进：/)).toBeNull(),
    );
  });

  it("胶囊随球位左右翻:初始位置在右半屏时胶囊挂左", () => {
    window.localStorage.setItem(
      "mystudio.workflow-orb.position",
      JSON.stringify({ x: window.innerWidth - 60, y: 300 }),
    );
    const { container } = render(
      <WorkflowStatusOrb readiness={readiness} activeStage="novel" onStageChange={vi.fn()} />,
    );
    const capsule = container.querySelector("[data-orb-capsule]");
    expect(capsule?.classList.contains("right-full")).toBe(true);
  });

  it("默认锚右下避侧栏(09-10 实弹修复:左下默认锚压在侧栏轨道上盖住设置/帮助)", () => {
    const { container } = render(
      <WorkflowStatusOrb readiness={readiness} activeStage="novel" onStageChange={vi.fn()} />,
    );
    const capsule = container.querySelector("[data-orb-capsule]");
    // 右半屏默认位 → 胶囊翻左(right-full);若退回左下锚此断言即翻红
    expect(capsule?.classList.contains("right-full")).toBe(true);
  });

  it("挂载后延迟自愈过渡期视口(装机实弹:943 过渡高算出默认锚,落定 900 后零 resize 事件)", async () => {
    const realH = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 943, configurable: true });
    try {
      render(
        <WorkflowStatusOrb readiness={readiness} activeStage="novel" onStageChange={vi.fn()} />,
      );
      // 视口落定为 900,但实弹观测:全程零 resize 事件——只能靠延迟自愈钳回
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

  it("层序契约:球 z-40(高于 webview,低于 dropdown z-50/Dialog z-250)", () => {
    renderOrb();
    expect(getOrb().style.zIndex).toBe("40");
  });

  it("pointercancel 后标志位复位,下一次合成 click 不被误吞", async () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(orb);
    fireEvent.click(orb);
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
  });

  it("合成 click(无 pointer 事件)可开面板——smoke 脚本路径", async () => {
    renderOrb();
    fireEvent.click(getOrb());
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
  });

  it("真实点击兜底:pointerup 被 drag 会话吞掉时,带坐标的 click 仍开面板(装机实弹报障)", async () => {
    renderOrb();
    const orb = getOrb();
    // pointerdown 有,pointerup 缺席(真机上 motion drag 干扰的故障路径),click 携带释放点坐标
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.click(orb, { clientX: 22, clientY: 21 });
    expect(await screen.findByText(/待推进：剧本生产阶段/)).toBeTruthy();
  });

  it("拖拽后落在球内的 click(位移超阈值)不开面板", () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.click(orb, { clientX: 60, clientY: 70 });
    expect(screen.queryByText(/待推进：/)).toBeNull();
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
