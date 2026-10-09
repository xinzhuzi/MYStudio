// @vitest-environment jsdom
// resizable.tsx autoSaveId 持久化重实现(v2 等价,1010)回归锁:
// 复原(首渲染读档→defaultLayout)/落盘(onLayoutChanged→requestedLayout)/损坏档回退/无 autoSaveId 零行为差
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const groupSpy = vi.hoisted(() => vi.fn());
vi.mock("react-resizable-panels", () => ({
  Group: ({
    defaultLayout,
    onLayoutChanged,
    children,
  }: {
    defaultLayout?: Record<string, number>;
    onLayoutChanged?: (l: Record<string, number>, m: { isUserInteraction: boolean; requestedLayout?: Record<string, number> }) => void;
    children?: React.ReactNode;
  }) => (
    <div
      data-testid="group"
      data-layout={JSON.stringify(defaultLayout ?? null)}
      onClick={() =>
        onLayoutChanged?.({ a: 30, b: 70 }, { isUserInteraction: true, requestedLayout: { a: 31, b: 69 } })
      }
    >
      {children}
    </div>
  ),
  Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}));
void groupSpy;

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

const KEY = "manying:panel-layout:ac-test";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ResizablePanelGroup autoSaveId 持久化(1010 重实现)", () => {
  it("有 autoSaveId:首渲染从 localStorage 复原为 defaultLayout", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ a: 40, b: 60 }));
    render(
      <ResizablePanelGroup direction="horizontal" autoSaveId="ac-test">
        <ResizablePanel id="a" defaultSize={22} />
        <ResizablePanel id="b" defaultSize={78} />
      </ResizablePanelGroup>,
    );
    expect(screen.getByTestId("group").dataset.layout).toBe(JSON.stringify({ a: 40, b: 60 }));
  });

  it("onLayoutChanged 落盘=requestedLayout(库推荐存储值),消费者回调透传", () => {
    const consumerCb = vi.fn();
    render(
      <ResizablePanelGroup direction="horizontal" autoSaveId="ac-test" onLayoutChanged={consumerCb}>
        <ResizablePanel id="a" defaultSize={22} />
        <ResizableHandle />
        <ResizablePanel id="b" defaultSize={78} />
      </ResizablePanelGroup>,
    );
    fireEvent.click(screen.getByTestId("group"));
    expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify({ a: 31, b: 69 }));
    expect(consumerCb).toHaveBeenCalledWith(
      { a: 30, b: 70 },
      { isUserInteraction: true, requestedLayout: { a: 31, b: 69 } },
    );
  });

  it("损坏存档:弃档回退 defaultSize 路径(defaultLayout=null)不炸", () => {
    window.localStorage.setItem(KEY, "{broken json");
    render(
      <ResizablePanelGroup direction="horizontal" autoSaveId="ac-test">
        <ResizablePanel id="a" defaultSize={22} />
      </ResizablePanelGroup>,
    );
    expect(screen.getByTestId("group").dataset.layout).toBe("null");
  });

  it("无 autoSaveId:零行为差(defaultLayout/onLayoutChanged 原样透传)", () => {
    const consumerCb = vi.fn();
    render(
      <ResizablePanelGroup
        direction="horizontal"
        defaultLayout={{ a: 10, b: 90 }}
        onLayoutChanged={consumerCb}
      >
        <ResizablePanel id="a" defaultSize={22} />
      </ResizablePanelGroup>,
    );
    expect(screen.getByTestId("group").dataset.layout).toBe(JSON.stringify({ a: 10, b: 90 }));
    fireEvent.click(screen.getByTestId("group"));
    expect(window.localStorage.length).toBe(0);
    expect(consumerCb).toHaveBeenCalledTimes(1);
  });
});
