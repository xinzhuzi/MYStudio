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

const { DutchRollToLevel, VSC_DUTCH_ROLL_TO_LEVEL_ID, dutchRollToLevelStyleAtFrame } =
  await import("./dutch-roll-to-level");
const { dutchRollAtFrame } = await import("./vsc-helpers");
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

describe("dutch-roll-to-level 配方组件", () => {
  afterEach(() => cleanup());

  it("命名锚:全链 id 为 vsc:dutch-roll-to-level", () => {
    expect(VSC_DUTCH_ROLL_TO_LEVEL_ID).toBe("vsc:dutch-roll-to-level");
  });

  it("媒体=分镜静图:Img 直接消费 media bridge capability URL,cover 满幅", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(<DutchRollToLevel src={SRC} />);
    expect(getByTestId("img").getAttribute("src")).toBe(SRC);
    expect(JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}").objectFit).toBe("cover");
  });

  it("组件样式 = 纯采样函数的薄包装(全帧核对,含斜置/滚正/过冲/收零各段)", () => {
    const props = { src: SRC, rollFrame: 40 };
    for (const frame of [0, 20, 40, 47, 54, 56, 64, 80, 110, 130]) {
      currentFrame.value = frame;
      const { getAllByTestId } = render(<DutchRollToLevel {...props} />);
      const fills = getAllByTestId("absolute-fill");
      expect(fills).toHaveLength(2); // 外框(防露边底)+ 媒体层
      expect(JSON.parse(fills[1].getAttribute("data-style") ?? "{}")).toEqual(
        dutchRollToLevelStyleAtFrame(frame, props),
      );
      cleanup();
    }
  });

  it("斜置语义:70f 前 rotate 恒在 -10.8°..-9.2° 悬着,scale=1.15 防露边", () => {
    for (const frame of [0, 17, 45, 69]) {
      const style = dutchRollToLevelStyleAtFrame(frame, { src: SRC });
      const rot = Number(/rotate\((-?[\d.]+)deg\)/.exec(String(style.transform))?.[1] ?? NaN);
      const scale = Number(/scale\(([\d.]+)\)/.exec(String(style.transform))?.[1] ?? NaN);
      expect(rot).toBeGreaterThanOrEqual(-10.8);
      expect(rot).toBeLessThanOrEqual(-9.2);
      expect(scale).toBe(trimScale.trimScale(1.15));
    }
  });

  it("滚正语义:84f 到 +1.2° 过冲 → 94f 收 0;transform 含 translateY 纵漂通道", () => {
    const at = (f: number) => Number(/rotate\((-?[\d.]+)deg\)/.exec(String(dutchRollToLevelStyleAtFrame(f, { src: SRC }).transform))?.[1] ?? NaN);
    expect(at(84)).toBeCloseTo(1.2, 5);
    expect(at(94)).toBeCloseTo(0, 5);
    expect(at(120)).toBeCloseTo(0, 5);
    expect(String(dutchRollToLevelStyleAtFrame(30, { src: SRC }).transform)).toMatch(/^translateY\(/);
  });

  it("曲线接线:组件内曲线即 vsc-helpers 的 dutchRollAtFrame(防双实现漂移)", () => {
    const props = { src: SRC, rollFrame: 55, overshootDeg: 2 };
    for (const frame of [54, 55, 62, 69, 80, 95]) {
      const sample = dutchRollAtFrame(frame, props);
      const style = dutchRollToLevelStyleAtFrame(frame, props);
      expect(String(style.transform)).toContain(`rotate(${trimScale.trimScale(sample.rotateDeg)}deg)`);
      expect(String(style.transform)).toContain(`scale(${trimScale.trimScale(sample.scale)})`);
    }
  });

  it("帧级确定性:同 props 两次渲染,全帧 HTML 树同哈希(铁律:无 Math.random/Date.now)", () => {
    const variants = [
      { src: SRC },
      { src: SRC, rollFrame: 30 },
      { src: SRC, rollFrame: 50, pushFrames: 12, settleFrames: 8, tiltDeg: -8, overshootDeg: 1.5 },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame <= 110; frame++) {
        currentFrame.value = frame;
        const firstPass = render(<DutchRollToLevel {...props} />);
        runA.push(firstPass.container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        const secondPass = render(<DutchRollToLevel {...props} />);
        runB.push(secondPass.container.innerHTML);
        cleanup();
      }
      expect(runA.length).toBe(111);
      // 逐帧两次渲染同哈希;整段序列(帧序列)也稳定。
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });
});
