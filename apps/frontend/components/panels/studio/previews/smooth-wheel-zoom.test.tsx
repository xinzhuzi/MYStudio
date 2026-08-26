// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useSmoothWheelZoom, type SmoothWheelZoomApi } from "./smooth-wheel-zoom";
import {
  __resetInteractionDeferForTests,
  interactionDeferBegin,
  interactionDeferEnd,
} from "./interaction-defer";

vi.mock("./interaction-defer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./interaction-defer")>();
  return {
    ...actual,
    interactionDeferBegin: vi.fn(),
    interactionDeferEnd: vi.fn(),
  };
});

function Harness({ api }: { api: SmoothWheelZoomApi }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useSmoothWheelZoom(ref, api, { minZoom: 0.2, maxZoom: 2 });
  return (
    <div ref={ref} style={{ width: 1000, height: 800 }}>
      <div className="pane" />
    </div>
  );
}

let rafQueue: FrameRequestCallback[] = [];
const flushRaf = () => {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(performance.now());
};

afterEach(() => {
  cleanup();
  rafQueue = [];
  vi.clearAllMocks();
  __resetInteractionDeferForTests();
});

function wheel(target: HTMLElement, deltaY: number, clientX = 500, clientY = 400) {
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }) as DOMRect;
  target.dispatchEvent(
    new WheelEvent("wheel", { deltaY, clientX, clientY, bubbles: true, cancelable: true }),
  );
}

describe("useSmoothWheelZoom", () => {
  it("batches many wheel events within one frame into a single viewport application", () => {
    const setViewport = vi.fn();
    const api: SmoothWheelZoomApi = {
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport,
    };
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => (rafQueue.push(cb), 1));
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;

    act(() => {
      wheel(host, -50);
      wheel(host, -50);
      wheel(host, -50);
      wheel(host, -50);
    });
    expect(setViewport).not.toHaveBeenCalled(); // 帧内只累积
    act(() => flushRaf());
    expect(setViewport).toHaveBeenCalledTimes(1); // 一帧一应用
    const applied = setViewport.mock.calls[0][0];
    // 200 增量:exp(0.0022·200) ≈ ×1.5527(不触 2.0 上限,纯插值断言)
    expect(applied.zoom).toBeCloseTo(Math.exp(-(-200) * 0.0022), 5);
    rafSpy.mockRestore();
  });

  it("anchors the zoom at the cursor position", () => {
    const setViewport = vi.fn();
    const api: SmoothWheelZoomApi = {
      getViewport: () => ({ x: 100, y: 50, zoom: 1 }),
      setViewport,
    };
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => (rafQueue.push(cb), 1));
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    act(() => wheel(host, -200, 800, 600));
    act(() => flushRaf());
    const { x, y, zoom } = setViewport.mock.calls[0][0];
    const scale = zoom / 1;
    // 锚点公式:x = mx - (mx - vx)·scale
    expect(x).toBeCloseTo(800 - (800 - 100) * scale, 5);
    expect(y).toBeCloseTo(600 - (600 - 50) * scale, 5);
    rafSpy.mockRestore();
  });

  it("clamps zoom to the configured bounds", () => {
    const setViewport = vi.fn();
    let zoom = 1.95;
    const api: SmoothWheelZoomApi = {
      getViewport: () => ({ x: 0, y: 0, zoom }),
      setViewport: (v) => {
        zoom = v.zoom;
        setViewport(v);
      },
    };
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => (rafQueue.push(cb), 1));
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    act(() => wheel(host, -5000));
    act(() => flushRaf());
    expect(setViewport.mock.calls[0][0].zoom).toBe(2);
    rafSpy.mockRestore();
  });

  it("owns pane drag imperatively: one commit, click suppressed after move, pure click untouched", async () => {
    vi.useFakeTimers();
    const setViewport = vi.fn();
    let vp = { x: 0, y: 0, zoom: 1 };
    const api: SmoothWheelZoomApi = {
      getViewport: () => vp,
      setViewport: (v) => { vp = v; setViewport(v); },
    };
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => (rafQueue.push(cb), 1));
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    const pane = document.createElement("div");
    pane.className = "react-flow__pane";
    host.appendChild(pane);
    const vpEl = document.createElement("div");
    vpEl.className = "react-flow__viewport";
    host.appendChild(vpEl);

    const pd = (x: number, y: number) =>
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 3, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y }));
    const pm = (x: number, y: number) =>
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 3, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y }));
    const pu = (x: number, y: number) =>
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 3, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y }));

    // 纯点击(无移动):不提交、不吞 click
    let clicks = 0;
    pane.addEventListener("click", () => { clicks += 1; });
    act(() => { pd(100, 100); pu(100, 100); });
    pane.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1);
    expect(setViewport).not.toHaveBeenCalled();

    // 拖拽:直改 transform,松手 160ms 一次性提交;click 被吞
    act(() => { pd(100, 100); });
    act(() => { pm(140, 110); pm(180, 120); });
    expect(vpEl.style.transform).toContain("translate(80px");
    pane.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1); // 被抑制
    act(() => { pu(180, 120); });
    act(() => { vi.advanceTimersByTime(160); });
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport.mock.calls[0][0]).toMatchObject({ x: 80, y: 20, zoom: 1 });
    // 滞留抑制器清理:拖拽后若无 click 合成(异常路径),新按下后的
    // 纯点击必须透传(不被上一轮残留抑制器吞掉)
    act(() => { pd(100, 100); pu(100, 100); });
    pane.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(2);
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it("leaves Shift+drag to React Flow selection and never pans (框选手势不打架)", () => {
    vi.useFakeTimers();
    const setViewport = vi.fn();
    const api: SmoothWheelZoomApi = { getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport };
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    const pane = document.createElement("div");
    pane.className = "react-flow__pane";
    host.appendChild(pane);
    act(() => {
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, shiftKey: true, pointerId: 9, pointerType: "mouse", isPrimary: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, button: 0, buttons: 1, shiftKey: true, pointerId: 9, pointerType: "mouse", isPrimary: true, clientX: 200, clientY: 150 }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, buttons: 0, shiftKey: true, pointerId: 9, pointerType: "mouse", isPrimary: true, clientX: 200, clientY: 150 }));
    });
    act(() => { vi.advanceTimersByTime(300); });
    expect(setViewport).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps middle-button pan (图像工作流原生辅助键位)", () => {
    vi.useFakeTimers();
    const setViewport = vi.fn();
    const api: SmoothWheelZoomApi = { getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport };
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    const pane = document.createElement("div");
    pane.className = "react-flow__pane";
    host.appendChild(pane);
    const vpEl = document.createElement("div");
    vpEl.className = "react-flow__viewport";
    host.appendChild(vpEl);
    act(() => {
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 1, buttons: 4, pointerId: 11, pointerType: "mouse", isPrimary: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, button: 1, buttons: 4, pointerId: 11, pointerType: "mouse", isPrimary: true, clientX: 160, clientY: 130 }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 1, buttons: 0, pointerId: 11, pointerType: "mouse", isPrimary: true, clientX: 160, clientY: 130 }));
    });
    act(() => { vi.advanceTimersByTime(160); });
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport.mock.calls[0][0]).toMatchObject({ x: 60, y: 30 });
    vi.useRealTimers();
  });

  it("yields to an external viewport write during the commit window (最后写入者优先)", () => {
    vi.useFakeTimers();
    let vp = { x: 0, y: 0, zoom: 1 };
    const external = vi.fn();
    const api: SmoothWheelZoomApi = {
      getViewport: () => vp,
      setViewport: (v) => { vp = v; external(v); },
    };
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => (rafQueue.push(cb), 1));
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    const pane = document.createElement("div");
    pane.className = "react-flow__pane";
    host.appendChild(pane);
    const vpEl = document.createElement("div");
    vpEl.className = "react-flow__viewport";
    host.appendChild(vpEl);
    // 拖拽产生 pending
    act(() => {
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 13, pointerType: "mouse", isPrimary: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 13, pointerType: "mouse", isPrimary: true, clientX: 160, clientY: 120 }));
    });
    // 提交窗内外部改写(如点视口控制按钮)
    vp = { x: 99, y: 99, zoom: 1 };
    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, buttons: 0, pointerId: 13, pointerType: "mouse", isPrimary: true, clientX: 160, clientY: 120 }));
      vi.advanceTimersByTime(160);
    });
    expect(external).not.toHaveBeenCalled(); // 我方提交让位
    expect(vp).toMatchObject({ x: 99, y: 99 });
    rafSpy.mockRestore();
    vi.useRealTimers();
  });

  it("commits pending pan on mid-gesture unmount (拖拽中途切阶段不回跳)", () => {
    vi.useFakeTimers();
    const setViewport = vi.fn();
    const api: SmoothWheelZoomApi = { getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport };
    const { container, unmount } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    const pane = document.createElement("div");
    pane.className = "react-flow__pane";
    host.appendChild(pane);
    const vpEl = document.createElement("div");
    vpEl.className = "react-flow__viewport";
    host.appendChild(vpEl);
    act(() => {
      pane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 21, pointerType: "mouse", isPrimary: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 21, pointerType: "mouse", isPrimary: true, clientX: 150, clientY: 130 }));
    });
    act(() => { unmount(); });
    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport.mock.calls[0][0]).toMatchObject({ x: 50, y: 30 });
    vi.useRealTimers();
  });

  it("gates loading during the wheel stream and ends after the settle tail", () => {
    vi.useFakeTimers();
    const api: SmoothWheelZoomApi = {
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      setViewport: vi.fn(),
    };
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => (rafQueue.push(cb), 1));
    const { container } = render(<Harness api={api} />);
    const host = container.firstElementChild as HTMLElement;
    act(() => wheel(host, -100));
    expect(interactionDeferBegin).toHaveBeenCalledTimes(1);
    act(() => flushRaf());
    expect(interactionDeferEnd).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(160));
    expect(interactionDeferEnd).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
    vi.useRealTimers();
  });
});
