// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResolutionBadge,
  __resetImageResolutionCacheForTests,
  useImageResolution,
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
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetImageResolutionCacheForTests();
});

describe("ResolutionBadge", () => {
  it("shows the tier for a 4K original even when display src is a thumb variant", async () => {
    installFakeImage({ "asset-file://a/b.png": [3840, 2160] });
    render(<ResolutionBadge src="asset-file://a/b.png?thumb=1" />);
    expect(await screen.findByText("4K")).toBeTruthy();
  });

  it("shows 1K for preset-tier images", async () => {
    installFakeImage({ "local-image://m/1k.png": [1280, 720] });
    render(<ResolutionBadge src="local-image://m/1k.png" />);
    expect(await screen.findByText("1K")).toBeTruthy();
  });

  it("renders nothing while unresolved, unknown, tiny, or failed", async () => {
    installFakeImage({
      "local-image://m/tiny.png": [200, 200],
      "local-image://m/broken.png": undefined,
    });
    const { container, rerender } = render(<ResolutionBadge src="local-image://m/pending.png" />);
    expect(container.querySelector("span")).toBeNull();

    await waitFor(() => {
      rerender(<ResolutionBadge src="local-image://m/tiny.png" />);
    });
    await waitFor(() => {
      rerender(<ResolutionBadge src="local-image://m/broken.png" />);
    });
    await waitFor(() => {
      rerender(<ResolutionBadge src={undefined} />);
    });
    expect(container.querySelector("span")).toBeNull();
  });

  it("probes each url once across mounts via the module cache", async () => {
    installFakeImage({ "local-image://m/cache.png": [2048, 1152] });
    const { unmount } = render(<ResolutionBadge src="local-image://m/cache.png" />);
    expect(await screen.findByText("2K")).toBeTruthy();
    unmount();

    let constructs = 0;
    installFakeImage({ "local-image://m/cache.png": [2048, 1152] }, () => {
      constructs++;
    });
    render(<ResolutionBadge src="local-image://m/cache.png" />);
    await waitFor(() => {
      expect(screen.getByText("2K")).toBeTruthy();
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
    expect(await screen.findByText("4K")).toBeTruthy();
    expect(imageConstructs).toBe(0);
    expect(window.imageProbe?.size).toHaveBeenCalledWith("project-file://p/workflow-images/shot.png");
  });

  it("falls back to the image-element probe when the backend cannot parse", async () => {
    installFakeImage({ "asset-file://a/unknown.bin": [2016, 1536] });
    vi.stubGlobal("imageProbe", {
      size: vi.fn(async () => null),
    });
    render(<ResolutionBadge src="asset-file://a/unknown.bin" />);
    expect(await screen.findByText("2K")).toBeTruthy();
  });

  it("falls back when the backend IPC throws", async () => {
    installFakeImage({ "local-image://m/gone.png": [1280, 720] });
    vi.stubGlobal("imageProbe", {
      size: vi.fn(async () => {
        throw new Error("IPC dead");
      }),
    });
    render(<ResolutionBadge src="local-image://m/gone.png" />);
    expect(await screen.findByText("1K")).toBeTruthy();
  });

});

describe("useImageResolution", () => {
  it("resolves the tier from a probe", async () => {
    installFakeImage({ "local-image://m/hook.png": [2352, 3520] });
    function Probe() {
      const resolution = useImageResolution("local-image://m/hook.png");
      return <span data-testid="tier">{resolution ?? "pending"}</span>;
    }
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("tier").textContent).toBe("4K");
    });
  });
});
