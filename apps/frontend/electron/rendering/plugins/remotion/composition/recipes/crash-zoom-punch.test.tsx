// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// 与 VisualClip.test.tsx 同式:mock remotion 模块边界(受控帧+可断言占位),
// 另 mock @remotion/motion-blur 以断言「blur 只包急推段」的窗口接线。
const currentFrame = { value: 0 };

vi.mock("remotion", async (importOriginal) => ({
  // Easing/interpolate 走真实现:组件 → vsc-helpers 的曲线要在测试里逐值核对,
  // 只 mock React 侧边界(帧上下文与媒体组件)。
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => currentFrame.value,
  AbsoluteFill: ({ children, style }: { children?: unknown; style?: unknown }) =>
    <div data-testid="absolute-fill" data-style={JSON.stringify(style)}>
      {children as never}
    </div>,
  Img: ({ src, style }: { src: string; style?: unknown }) => (
    <img data-testid="img" data-style={JSON.stringify(style)} src={src} alt="" />
  ),
}));

vi.mock("@remotion/motion-blur", () => ({
  CameraMotionBlur: ({ children }: { children?: unknown }) =>
    <div data-testid="motion-blur">{children as never}</div>,
}));

const { CrashZoomPunch, VSC_CRASH_ZOOM_PUNCH_ID, crashZoomBlurWindow, crashZoomPunchStyleAtFrame } =
  await import("./crash-zoom-punch");
const { crashZoomScaleAtFrame, impactShakeAtFrame } = await import("./vsc-helpers");
const { trimScale } = { trimScale: (v: number) => Math.round(v * 1e5) / 1e5 };

const SRC = "http://127.0.0.1:1/tok/storyboard-still";

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

describe("crash-zoom-punch 样板组件", () => {
  afterEach(() => cleanup());

  it("命名锚:全链 id 为 vsc:crash-zoom-punch", () => {
    expect(VSC_CRASH_ZOOM_PUNCH_ID).toBe("vsc:crash-zoom-punch");
  });

  it("终点吃分镜静图:Img 直接消费 media bridge capability URL", () => {
    currentFrame.value = 0;
    const { getByTestId, queryByTestId } = render(<CrashZoomPunch src={SRC} />);
    expect(getByTestId("img").getAttribute("src")).toBe(SRC);
    expect(JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}").objectFit).toBe("cover");
    // 前 hold 段不在 blur 窗口内。
    expect(queryByTestId("motion-blur")).toBeNull();
  });

  it("组件样式 = 纯采样函数的薄包装(rebound 缺省款,全帧核对)", () => {
    const props = { src: SRC, landing: "rebound" as const, originX: 0.4, originY: 0.7 };
    for (const frame of [0, 29, 30, 33, 36, 38, 41, 60, 90]) {
      currentFrame.value = frame;
      const { getByTestId } = render(<CrashZoomPunch {...props} />);
      const style = JSON.parse(getByTestId("absolute-fill").getAttribute("data-style") ?? "{}");
      expect(style).toEqual(crashZoomPunchStyleAtFrame(frame, props));
      cleanup();
    }
  });

  it("impact 款:hit 帧起叠撞停震屏(14px·e^(−t/1.8)),hit 前零偏移", () => {
    const props = { src: SRC, landing: "impact" as const };
    currentFrame.value = 35; // hit 前一帧:急推末段(scale≈2.43)但震屏必须为 0
    let style = JSON.parse(render(<CrashZoomPunch {...props} />).getByTestId("absolute-fill").getAttribute("data-style") ?? "{}");
    expect(style.transform).toBe(`translate(0px, 0px) scale(${trimScale(crashZoomScaleAtFrame(35, { startFrame: 30 }))})`);
    cleanup();

    currentFrame.value = 37; // since=1:env=14·e^(−1/1.8)≈8.24
    style = JSON.parse(render(<CrashZoomPunch {...props} />).getByTestId("absolute-fill").getAttribute("data-style") ?? "{}");
    const shake = impactShakeAtFrame(37, { hitFrame: 36 });
    expect(style.transform).toBe(`translate(${shake.x}px, ${shake.y}px) scale(2.6)`);
  });

  it("CameraMotionBlur 只包急推段:impact 款 [start−2, hit],rebound 款 [start−2, hit+2]", () => {
    expect(crashZoomBlurWindow({ src: SRC, landing: "impact" })).toEqual({ from: 28, to: 36 });
    expect(crashZoomBlurWindow({ src: SRC, landing: "rebound" })).toEqual({ from: 28, to: 38 });
    expect(crashZoomBlurWindow({ src: SRC })).toEqual({ from: 28, to: 38 }); // 缺省=rebound

    const impact = { src: SRC, landing: "impact" as const };
    for (const frame of [0, 27, 28, 33, 36, 37, 60]) {
      currentFrame.value = frame;
      const { queryByTestId } = render(<CrashZoomPunch {...impact} />);
      const inWindow = frame >= 28 && frame <= 36;
      expect(Boolean(queryByTestId("motion-blur"))).toBe(inWindow);
      cleanup();
    }
  });

  it("帧级确定性:同 props 两次渲染,全帧 HTML 树同哈希(铁律:无 Math.random/Date.now)", () => {
    const variants = [
      { src: SRC, landing: "rebound" as const },
      { src: SRC, landing: "impact" as const },
      { src: SRC, landing: "rebound" as const, zoomFrames: 8, toScale: 2.4, originX: 0.3, originY: 0.6 },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame <= 60; frame++) {
        currentFrame.value = frame;
        const firstPass = render(<CrashZoomPunch {...props} />);
        runA.push(firstPass.container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        const secondPass = render(<CrashZoomPunch {...props} />);
        runB.push(secondPass.container.innerHTML);
        cleanup();
      }
      expect(runA.length).toBe(61);
      // 逐帧两次渲染同哈希;整段序列(帧序列)也稳定。
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });

  it("曲线接线:组件内 zoom 曲线即 vsc-helpers 的 crashZoomScaleAtFrame(防双实现漂移)", () => {
    const props = { src: SRC, landing: "rebound" as const };
    for (const frame of [29, 33, 36, 41]) {
      const style = crashZoomPunchStyleAtFrame(frame, props);
      const scale = Number(/scale\(([\d.]+)\)/.exec(String(style.transform))?.[1] ?? NaN);
      expect(scale).toBeCloseTo(crashZoomScaleAtFrame(frame, {
        startFrame: 30,
        rebound: {},
      }), 5);
    }
  });
});
