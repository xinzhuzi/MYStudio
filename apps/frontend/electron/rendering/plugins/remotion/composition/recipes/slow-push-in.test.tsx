// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// 与 crash-zoom-punch.test.tsx 同式:mock remotion 模块边界(受控帧+可断言
// 占位),Easing/interpolate 走真实现——组件 → vsc-helpers 的曲线要在测试里
// 逐值核对,只 mock React 侧边界(帧上下文与媒体组件)。
const currentFrame = { value: 0 };

vi.mock("remotion", async (importOriginal) => ({
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

const { SlowPushIn, VSC_SLOW_PUSH_IN_ID, slowPushInStyleAtFrame, slowPushVignetteStyleAtFrame } =
  await import("./slow-push-in");
const { slowPushAtFrame } = await import("./vsc-helpers");
const trimScale = { trimScale: (v: number) => Math.round(v * 1e5) / 1e5 };

const SRC = "http://127.0.0.1:1/tok/storyboard-still";

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

describe("slow-push-in 配方组件", () => {
  afterEach(() => cleanup());

  it("命名锚:全链 id 为 vsc:slow-push-in", () => {
    expect(VSC_SLOW_PUSH_IN_ID).toBe("vsc:slow-push-in");
  });

  it("媒体=分镜静图:Img 直接消费 media bridge capability URL,cover 满幅", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(<SlowPushIn src={SRC} />);
    expect(getByTestId("img").getAttribute("src")).toBe(SRC);
    expect(JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}").objectFit).toBe("cover");
  });

  it("组件样式 = 纯采样函数的薄包装(媒体层+暗角层,全帧核对)", () => {
    const props = { src: SRC };
    for (const frame of [0, 1, 30, 60, 90, 119, 120, 150]) {
      currentFrame.value = frame;
      const { getAllByTestId } = render(<SlowPushIn {...props} />);
      const fills = getAllByTestId("absolute-fill");
      expect(fills).toHaveLength(3); // 外框 + 媒体层 + 暗角层
      expect(JSON.parse(fills[1].getAttribute("data-style") ?? "{}")).toEqual(
        slowPushInStyleAtFrame(frame, props),
      );
      expect(JSON.parse(fills[2].getAttribute("data-style") ?? "{}")).toEqual(
        slowPushVignetteStyleAtFrame(frame, props),
      );
      cleanup();
    }
  });

  it("推近语义:0f scale=1.00,120f=1.14;前半程几乎不可察(中点<线性中点)", () => {
    const scaleAt = (f: number) => Number(/scale\(([\d.]+)\)/.exec(String(slowPushInStyleAtFrame(f, { src: SRC }).transform))?.[1] ?? NaN);
    expect(scaleAt(0)).toBe(1);
    expect(scaleAt(60)).toBeLessThan(1.07);
    expect(scaleAt(120)).toBe(trimScale.trimScale(1.14));
  });

  it("暗角渐深:opacity 与推近同曲线 0→0.5,渐变形状=上游同串", () => {
    expect(slowPushVignetteStyleAtFrame(0, { src: SRC }).opacity).toBe(0);
    expect(slowPushVignetteStyleAtFrame(60, { src: SRC }).opacity).toBeCloseTo(0.5 * (slowPushAtFrame(60).scale - 1) / 0.14, 4);
    expect(slowPushVignetteStyleAtFrame(120, { src: SRC }).opacity).toBe(trimScale.trimScale(0.5));
    expect(slowPushVignetteStyleAtFrame(0, { src: SRC }).background).toBe(
      "radial-gradient(ellipse 62% 55% at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.95) 100%)",
    );
  });

  it("顶点零过渡硬切留给转场链:120f 后钳制持住终点,不自造景 B", () => {
    const held = slowPushInStyleAtFrame(150, { src: SRC });
    expect(held).toEqual(slowPushInStyleAtFrame(120, { src: SRC }));
    expect(slowPushVignetteStyleAtFrame(150, { src: SRC }).opacity).toBe(trimScale.trimScale(0.5));
  });

  it("曲线接线:组件内曲线即 vsc-helpers 的 slowPushAtFrame(防双实现漂移)", () => {
    const props = { src: SRC, durationFrames: 90, toScale: 1.2 };
    for (const frame of [0, 45, 90, 100]) {
      const sample = slowPushAtFrame(frame, props);
      expect(String(slowPushInStyleAtFrame(frame, props).transform)).toBe(
        `scale(${trimScale.trimScale(sample.scale)})`,
      );
      expect(slowPushVignetteStyleAtFrame(frame, props).opacity).toBe(trimScale.trimScale(sample.vignetteOpacity));
    }
  });

  it("帧级确定性:同 props 两次渲染,全帧 HTML 树同哈希(铁律:无 Math.random/Date.now)", () => {
    const variants = [
      { src: SRC },
      { src: SRC, durationFrames: 90 },
      { src: SRC, durationFrames: 100, toScale: 1.18, vignetteMax: 0.4 },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame <= 130; frame++) {
        currentFrame.value = frame;
        const firstPass = render(<SlowPushIn {...props} />);
        runA.push(firstPass.container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        const secondPass = render(<SlowPushIn {...props} />);
        runB.push(secondPass.container.innerHTML);
        cleanup();
      }
      expect(runA.length).toBe(131);
      // 逐帧两次渲染同哈希;整段序列(帧序列)也稳定。
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });
});
