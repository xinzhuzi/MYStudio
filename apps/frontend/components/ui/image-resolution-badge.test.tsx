// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { interactionDeferBegin, interactionDeferEnd } from "@/hooks/interaction-defer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResolutionBadge,
  __resetImageResolutionCacheForTests,
  useImagePixelSize,
} from "@/components/ui/image-resolution-badge";

type DimTable = Record<string, [number, number] | undefined>;

function installFakeImage(dimTable: DimTable, onConstruct?: () => void) {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      private src_ = "";
      constructor() {
        onConstruct?.();
        Object.defineProperty(this, "src", {
          get: () => this.src_,
          set: (value: string) => {
            this.src_ = value;
            const dims = dimTable[value];
            queueMicrotask(() => {
              if (dims) {
                this.naturalWidth = dims[0];
                this.naturalHeight = dims[1];
                this.onload?.();
              } else {
                this.onerror?.();
              }
            });
          },
        });
      }
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetImageResolutionCacheForTests();
});

describe("ResolutionBadge", () => {
  it("shows the original pixel size even when display src is a thumb variant", async () => {
    installFakeImage({ "asset-file://a/b.png": [3840, 2160] });
    render(<ResolutionBadge src="asset-file://a/b.png?thumb=1" />);
    expect(await screen.findByText("3840×2160")).toBeTruthy();
  });

  it("shows the real pixel size for preset-tier images", async () => {
    installFakeImage({ "local-image://m/1k.png": [1280, 720] });
    render(<ResolutionBadge src="local-image://m/1k.png" />);
    expect(await screen.findByText("1280×720")).toBeTruthy();
  });

  it("renders real pixel size for tiny images and nothing for unresolved or failed images", async () => {
    installFakeImage({
      "local-image://m/tiny.png": [200, 200],
      "local-image://m/broken.png": undefined,
    });
    const { container, rerender } = render(<ResolutionBadge src="local-image://m/pending.png" />);
    expect(container.querySelector("span")).toBeNull();

    await waitFor(() => {
      rerender(<ResolutionBadge src="local-image://m/tiny.png" />);
    });
    expect(await screen.findByText("200×200")).toBeTruthy();

    await waitFor(() => {
      rerender(<ResolutionBadge src="local-image://m/broken.png" />);
    });
    // 探测失败的 src 独立断言:角标必须消失,而不是沿用上一张图的尺寸
    await waitFor(() => {
      expect(screen.queryByText("200×200")).toBeNull();
    });
    expect(container.querySelector("span")).toBeNull();

    await waitFor(() => {
      rerender(<ResolutionBadge src={undefined} />);
    });
    expect(container.querySelector("span")).toBeNull();
  });

  it("clears the stale size immediately when switching to an unprobed src", async () => {
    installFakeImage({ "local-image://m/old.png": [1280, 720] });
    const { rerender } = render(<ResolutionBadge src="local-image://m/old.png" />);
    expect(await screen.findByText("1280×720")).toBeTruthy();

    // 交互门闸挂起新 src 的探测:期间不得显示旧图的尺寸
    act(() => interactionDeferBegin());
    rerender(<ResolutionBadge src="local-image://m/new-pending.png" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("1280×720")).toBeNull();
    expect(screen.queryByText(/×/)).toBeNull();
    // settleMs=0 立即开闸,不给同文件后续测试留下 5s 防抖窗口
    act(() => interactionDeferEnd(0));
  });

  it("probes each url once across mounts via the module cache", async () => {
    installFakeImage({ "local-image://m/cache.png": [2048, 1152] });
    const { unmount } = render(<ResolutionBadge src="local-image://m/cache.png" />);
    expect(await screen.findByText("2048×1152")).toBeTruthy();
    unmount();

    let constructs = 0;
    installFakeImage({ "local-image://m/cache.png": [2048, 1152] }, () => {
      constructs++;
    });
    render(<ResolutionBadge src="local-image://m/cache.png" />);
    await waitFor(() => {
      expect(screen.getByText("2048×1152")).toBeTruthy();
    });
    expect(constructs).toBe(0);
  });

  it("probes managed schemes via the backend IPC without loading image data", async () => {
    let imageConstructs = 0;
    installFakeImage({}, () => {
      imageConstructs++;
    });
    vi.stubGlobal("imageProbe", {
      size: vi.fn(async () => ({ width: 3840, height: 2160 })),
    });
    render(<ResolutionBadge src="project-file://p/workflow-images/shot.png" />);
    expect(await screen.findByText("3840×2160")).toBeTruthy();
    expect(imageConstructs).toBe(0);
    expect(window.imageProbe?.size).toHaveBeenCalledWith("project-file://p/workflow-images/shot.png");
  });

  it("falls back to the image-element probe when the backend cannot parse", async () => {
    installFakeImage({ "asset-file://a/unknown.bin": [2016, 1536] });
    vi.stubGlobal("imageProbe", {
      size: vi.fn(async () => null),
    });
    render(<ResolutionBadge src="asset-file://a/unknown.bin" />);
    expect(await screen.findByText("2016×1536")).toBeTruthy();
  });

  it("falls back when the backend IPC throws", async () => {
    installFakeImage({ "local-image://m/gone.png": [1280, 720] });
    vi.stubGlobal("imageProbe", {
      size: vi.fn(async () => {
        throw new Error("IPC dead");
      }),
    });
    render(<ResolutionBadge src="local-image://m/gone.png" />);
    expect(await screen.findByText("1280×720")).toBeTruthy();
  });


  it("issues zero probes while an interaction is active, and probes after the 5s settle", async () => {
    vi.useFakeTimers();
    let imageConstructs = 0;
    installFakeImage({}, () => {
      imageConstructs++;
    });
    const probe = vi.fn(async () => ({ width: 3840, height: 2160 }));
    vi.stubGlobal("imageProbe", { size: probe });
    // 交互进行中挂载角标:不得有任何探测(IPC/文件头读取都不发生)
    act(() => interactionDeferBegin());
    render(<ResolutionBadge src="project-file://p/gated.png" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(probe).not.toHaveBeenCalled();
    expect(imageConstructs).toBe(0);
    // 停手 + 5s 防抖走完:探测放行,角标出档
    act(() => interactionDeferEnd());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });
    expect(probe).toHaveBeenCalledWith("project-file://p/gated.png");
    // 假定时器到此为止(findByText 轮询依赖真定时器)
    vi.useRealTimers();
    expect(await screen.findByText("3840×2160")).toBeTruthy();
  });
});

describe("useImagePixelSize", () => {
  it("resolves the real pixel size from a probe", async () => {
    installFakeImage({ "local-image://m/hook.png": [2352, 3520] });
    function Probe() {
      const size = useImagePixelSize("local-image://m/hook.png");
      return <span data-testid="size">{size ? `${size.width}×${size.height}` : "pending"}</span>;
    }
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("size").textContent).toBe("2352×3520");
    });
  });
});
