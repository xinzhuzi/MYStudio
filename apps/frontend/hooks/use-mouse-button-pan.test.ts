// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMouseButtonPan } from "./use-mouse-button-pan";

function fire(el: HTMLElement, type: string, init: Partial<PointerEventInit> & { pointerId?: number }) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
}

describe("useMouseButtonPan(09-03 左键不平移/右中键接管)", () => {
  it("右键拖拽派发屏幕增量;按住期守卫+干净释放合成重发", async () => {
    const onPan = vi.fn();
    const ctxEvents: string[] = [];
    const { result } = renderHook(() => useMouseButtonPan(onPan));
    const el = document.createElement("div");
    document.body.appendChild(el);
    const bind = () => {
      el.onpointerdown = (e) => result.current.onPointerDown(e as unknown as React.PointerEvent<HTMLElement>);
      el.onpointermove = (e) => result.current.onPointerMove(e as unknown as React.PointerEvent<HTMLElement>);
      el.onpointerup = (e) => result.current.onPointerUp(e as unknown as React.PointerEvent<HTMLElement>);
      el.onpointercancel = (e) => result.current.onPointerCancel(e as unknown as React.PointerEvent<HTMLElement>);
      el.addEventListener("contextmenu", (e) => {
        result.current.onContextMenuCapture(e as unknown as React.MouseEvent<HTMLElement>);
      }, true);
    };
    bind();

    act(() => { fire(el, "pointerdown", { button: 2, buttons: 2, clientX: 100, clientY: 100 }); });
    act(() => { fire(el, "pointermove", { button: 2, buttons: 2, clientX: 110, clientY: 104 }); });
    act(() => { fire(el, "pointermove", { button: 2, buttons: 2, clientX: 125, clientY: 112 }); });
    act(() => { fire(el, "pointerup", { button: 2, buttons: 0, clientX: 125, clientY: 112 }); });
    expect(onPan).toHaveBeenCalledTimes(2);
    expect(onPan).toHaveBeenNthCalledWith(1, 10, 4);
    expect(onPan).toHaveBeenNthCalledWith(2, 15, 8);
    // 右键按住期间:contextmenu 被守卫吞掉(preventDefault+stopPropagation)
    el.addEventListener("contextmenu", () => { ctxEvents.push("ctx"); });
    act(() => { fire(el, "pointerdown", { button: 2, buttons: 2, clientX: 100, clientY: 100 }); });
    act(() => {
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 }));
    });
    expect(ctxEvents).toEqual([]); // 守卫生效,未到达

    // 干净右键释放(未拖):微任务后合成重发一颗 contextmenu
    await act(async () => { fire(el, "pointerup", { button: 2, buttons: 0, clientX: 100, clientY: 100 }); });
    expect(ctxEvents).toEqual(["ctx"]); // 合成重发到达(守卫已释放)
  });

  it("左键不参与平移;中键可以", () => {
    const onPan = vi.fn();
    const { result } = renderHook(() => useMouseButtonPan(onPan));
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.onpointerdown = (e) => result.current.onPointerDown(e as unknown as React.PointerEvent<HTMLElement>);
    el.onpointermove = (e) => result.current.onPointerMove(e as unknown as React.PointerEvent<HTMLElement>);
    el.onpointerup = (e) => result.current.onPointerUp(e as unknown as React.PointerEvent<HTMLElement>);
    el.onpointercancel = (e) => result.current.onPointerCancel(e as unknown as React.PointerEvent<HTMLElement>);
    act(() => { fire(el, "pointerdown", { button: 0, buttons: 1, clientX: 0, clientY: 0 }); });
    act(() => { fire(el, "pointermove", { button: 0, buttons: 1, clientX: 50, clientY: 50 }); });
    act(() => { fire(el, "pointerup", { button: 0, buttons: 0, clientX: 50, clientY: 50 }); });
    expect(onPan).not.toHaveBeenCalled();

    act(() => { fire(el, "pointerdown", { button: 1, buttons: 4, clientX: 0, clientY: 0 }); });
    act(() => { fire(el, "pointermove", { button: 1, buttons: 4, clientX: 20, clientY: 0 }); });
    expect(onPan).toHaveBeenCalledWith(20, 0);
  });

  it("交互元素上的右键不启动平移(按钮/输入框等)", () => {
    const onPan = vi.fn();
    const { result } = renderHook(() => useMouseButtonPan(onPan));
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.onpointerdown = (e) => result.current.onPointerDown(e as unknown as React.PointerEvent<HTMLElement>);
    button.onpointermove = (e) => result.current.onPointerMove(e as unknown as React.PointerEvent<HTMLElement>);
    act(() => { fire(button, "pointerdown", { button: 2, buttons: 2, clientX: 0, clientY: 0 }); });
    act(() => { fire(button, "pointermove", { button: 2, buttons: 2, clientX: 99, clientY: 99 }); });
    expect(onPan).not.toHaveBeenCalled();
  });
});
