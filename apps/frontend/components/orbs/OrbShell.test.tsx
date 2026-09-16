// @vitest-environment jsdom
// OrbShell 长按解锁拖拽(09-12 防粘连用户裁定)回归:
// 拖拽改受控 dragControls——按下零跟手,按住 1s 且未划走(>6px)才解锁;
// 快速点击开面板语义完全不变;armed 原地松手=取消(不开面板+吞尾随 click)。
// 09-15 webview 盲区根修:解锁(armed)≠即刻拖拽——须下一根「按键仍按住且
// 距上一可见采样无大跳(>32px)」的 move 才啮合启动会话(ComfyUI 画布是
// <webview>,宿主 window 收不到 guest 区指针事件,松手/划走可能整个不可见)。
// useDragControls 覆写为 stub:jsdom 无真拖拽会话,断言「start 何时被调」即断言解锁门。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrbShell } from "./OrbShell";

const { dragControlsStub } = vi.hoisted(() => ({
  dragControlsStub: {
    start: vi.fn(),
    // DragGesture.mount 会订阅受控组件并保存退订函数(本 stub 无真会话,给空退订)
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useDragControls: () => dragControlsStub };
});

const PANEL_MARK = "长按测试面板";
const STORAGE_KEY = "test.orb-shell.position";

function renderShell() {
  return render(
    <OrbShell
      storageKey={STORAGE_KEY}
      dataOrb="test-orb"
      ariaLabel="测试球"
      capsuleText="测试胶囊"
      ballContent={null}
      panelContent={() => <div>{PANEL_MARK}</div>}
    />,
  );
}

function getOrb() {
  return screen.getByRole("button", { name: "测试球" });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  dragControlsStub.start.mockClear();
  vi.useRealTimers();
});

describe("OrbShell 长按解锁拖拽(09-12 防粘连)", () => {
  it("快速点击(未满 1s)照旧开面板,拖拽不启动", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    expect(screen.getByText(PANEL_MARK)).toBeTruthy();
    expect(dragControlsStub.start).not.toHaveBeenCalled();
  });

  it("按住满 1s(未划走)解锁:首根可见 move(按键在、无大跳)才啮合启动会话", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 解锁≠即刻拖拽:armed 后等啮合 move
    expect(dragControlsStub.start).not.toHaveBeenCalled();
    act(() => {
      fireEvent.pointerMove(window, { buttons: 1, clientX: 24, clientY: 20 });
    });
    expect(dragControlsStub.start).toHaveBeenCalledTimes(1);
    expect(dragControlsStub.start.mock.calls[0][0]).toMatchObject({
      clientX: 24,
      clientY: 20,
    });
  });

  it("按住满 1s 原地松手=取消:不开面板、尾随 click 被吞、位置不落盘", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    fireEvent.click(orb, { clientX: 21, clientY: 20 });
    expect(screen.queryByText(PANEL_MARK)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("蓄力期划走(>6px)取消解锁:满 1s 也不启动拖拽,释放不开面板", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 60, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dragControlsStub.start).not.toHaveBeenCalled();
    fireEvent.pointerUp(orb, { clientX: 60, clientY: 20 });
    expect(screen.queryByText(PANEL_MARK)).toBeNull();
  });

  it("蓄力期小位移(<6px 抖动)不打断:满 1s 仍解锁啮合", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 23, clientY: 21 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 24, clientY: 21 });
    expect(dragControlsStub.start).toHaveBeenCalledTimes(1);
  });

  it("webview 盲区幽灵拖拽(09-15 根修):解锁后 hover 移动(按键已松)不啮合,手势作废自愈", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 复现:按压后划出球体到 webview 盲区并已松手(pointerup 宿主不可见),
    // 1s 计时器照跑解锁;随后的 hover move 无按键——不得啮合成幽灵拖拽
    fireEvent.pointerMove(window, { buttons: 0, clientX: 300, clientY: 300 });
    expect(dragControlsStub.start).not.toHaveBeenCalled();
    // 手势作废:吞 click 标志回滚,下一次真实点击照旧开面板
    fireEvent.click(orb, { clientX: 21, clientY: 20 });
    expect(screen.getByText(PANEL_MARK)).toBeTruthy();
  });

  it("webview 盲区回流(09-15 根修):解锁后大跳位移(按键虽在)不啮合", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // 复现:按住球缘外拖进盲区,1s 后光标在远处回流宿主——位移大跳=手势可疑
    fireEvent.pointerMove(window, { buttons: 1, clientX: 400, clientY: 400 });
    expect(dragControlsStub.start).not.toHaveBeenCalled();
  });

  it("二手势防劫持:armed 未啮合时再按下,旧啮合监听已撤(新手势从蓄力重新判)", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerDown(orb, { clientX: 21, clientY: 20 });
    // 二手势蓄力期(<6px)move 不得被旧 armed 监听劫走启动拖拽
    fireEvent.pointerMove(window, { buttons: 1, clientX: 26, clientY: 20 });
    expect(dragControlsStub.start).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 27, clientY: 20 });
    expect(dragControlsStub.start).toHaveBeenCalledTimes(1);
    expect(dragControlsStub.start.mock.calls[0][0]).toMatchObject({
      clientX: 27,
      clientY: 20,
    });
  });

  it("pointercancel 中止蓄力:不解锁,后续合成 click 不被误吞(自愈对齐)", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(orb);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dragControlsStub.start).not.toHaveBeenCalled();
    fireEvent.click(orb);
    expect(screen.getByText(PANEL_MARK)).toBeTruthy();
  });

  it("蓄力进度环随手势出现/消失(data-orb-hold-ring)", () => {
    const { container } = renderShell();
    const orb = getOrb();
    expect(container.querySelector("[data-orb-hold-ring]")).toBeNull();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    const ring = container.querySelector("[data-orb-hold-ring]");
    expect(ring).toBeTruthy();
    expect(ring?.getAttribute("data-hold-state")).toBe("charging");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      container
        .querySelector("[data-orb-hold-ring]")
        ?.getAttribute("data-hold-state"),
    ).toBe("armed");
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    expect(container.querySelector("[data-orb-hold-ring]")).toBeNull();
  });

  it("面板开着时长按松手=取消:不重开面板(按压时 Radix 外点已收,真机同此)", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
    expect(screen.getByText(PANEL_MARK)).toBeTruthy();
    fireEvent.pointerDown(orb, { clientX: 25, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.pointerUp(orb, { clientX: 26, clientY: 20 });
    fireEvent.click(orb, { clientX: 26, clientY: 20 });
    // 长按释放=取消:无论收起来自 Radix 外点还是 armed 早退,都不得重开
    expect(screen.queryByText(PANEL_MARK)).toBeNull();
  });
});
