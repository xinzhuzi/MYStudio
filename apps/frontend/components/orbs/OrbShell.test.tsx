// @vitest-environment jsdom
// OrbShell 长按解锁拖拽(09-12 防粘连用户裁定)回归:
// 拖拽改受控 dragControls——按下零跟手,按住 1s 且未划走(>6px)才启动拖拽会话;
// 快速点击开面板语义完全不变;armed 原地松手=取消(不开面板+吞尾随 click)。
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

  it("按住满 1s(未划走)解锁:dragControls.start 以按下事件启动", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dragControlsStub.start).toHaveBeenCalledTimes(1);
    expect(dragControlsStub.start.mock.calls[0][0]).toMatchObject({
      clientX: 20,
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

  it("蓄力期小位移(<6px 抖动)不打断:满 1s 仍解锁", () => {
    renderShell();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 23, clientY: 21 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dragControlsStub.start).toHaveBeenCalledTimes(1);
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
