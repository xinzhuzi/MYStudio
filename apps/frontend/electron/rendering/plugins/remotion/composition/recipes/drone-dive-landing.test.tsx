// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// 与 crash-zoom-punch.test.tsx 同式:mock remotion 模块边界(受控帧+可断言
// 占位;本卡另 mock useVideoConfig=composition 固定 1920×1080),
// 另 mock @remotion/motion-blur 以断言「全场包 CameraMotionBlur(220/9)」。
const currentFrame = { value: 0 };

vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => currentFrame.value,
  useVideoConfig: () => ({ width: 1920, height: 1080, fps: 30, durationInFrames: 300 }),
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

const {
  DroneDiveLanding,
  VSC_DRONE_DIVE_LANDING_ID,
  droneDivePlaneStyleAtFrame,
  droneDiveShadowStyleAtFrame,
} = await import("./drone-dive-landing");
const { droneDiveAtFrame, droneDiveProgressAtFrame } = await import("./vsc-helpers");
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

/** 外框(第 1 个 absolute-fill)下第 1 个子元素 = 地面软影 div(jsdom 内联样式)。 */
function shadowElement(container: HTMLElement): HTMLElement {
  const outer = container.querySelector<HTMLElement>('[data-testid="absolute-fill"]');
  expect(outer).not.toBeNull();
  const shadow = outer?.firstElementChild as HTMLElement;
  expect(shadow.tagName).toBe("DIV");
  return shadow;
}

describe("drone-dive-landing 配方组件", () => {
  afterEach(() => cleanup());

  it("命名锚:全链 id 为 vsc:drone-dive-landing", () => {
    expect(VSC_DRONE_DIVE_LANDING_ID).toBe("vsc:drone-dive-landing");
  });

  it("媒体=分镜静图:Img 直接消费 media bridge capability URL,cover 满幅", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(<DroneDiveLanding src={SRC} />);
    expect(getByTestId("img").getAttribute("src")).toBe(SRC);
    expect(JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}").objectFit).toBe("cover");
  });

  it("全场 CameraMotionBlur:hold/俯冲/气垫/静止每帧都在 blur 包内(卡片氛围参数 220/9)", () => {
    for (const frame of [0, 19, 20, 45, 65, 80]) {
      currentFrame.value = frame;
      const { getByTestId } = render(<DroneDiveLanding src={SRC} />);
      expect(getByTestId("motion-blur")).not.toBeNull();
      cleanup();
    }
  });

  it("组件样式 = 纯采样函数的薄包装(perspective 容器 + 页面平面,全帧核对)", () => {
    const props = { src: SRC };
    for (const frame of [0, 20, 32, 45, 55, 65, 90]) {
      currentFrame.value = frame;
      const { getAllByTestId } = render(<DroneDiveLanding {...props} />);
      const fills = getAllByTestId("absolute-fill");
      expect(fills).toHaveLength(3); // 外框 + perspective 容器 + 页面平面
      expect(JSON.parse(fills[1].getAttribute("data-style") ?? "{}")).toEqual({ perspective: 1400 });
      expect(JSON.parse(fills[2].getAttribute("data-style") ?? "{}")).toEqual(
        droneDivePlaneStyleAtFrame(frame, props, 1920, 1080),
      );
      cleanup();
    }
  });

  it("一条 p 驱动三轴:hold 期 p=0(72°/0.42),切换帧 p=0.82,落地 0°/1.35 收干软影", () => {
    const transformAt = (frame: number, props?: { originX?: number; originY?: number }) =>
      String(droneDivePlaneStyleAtFrame(frame, { src: SRC, ...props }).transform);
    // 前置 hold:上帝视角悬停(p=0,起手偏移 (-186,-55))。
    expect(transformAt(0)).toContain(`translate(${trimScale.trimScale(-186)}px, ${trimScale.trimScale(-55)}px)`);
    expect(transformAt(0)).toContain("rotateX(72deg)");
    expect(transformAt(0)).toContain(`scale(${trimScale.trimScale(0.42)})`);
    // 切换帧与落地:rotateX/scale 同由 p 驱动。
    expect(droneDiveProgressAtFrame(45)).toBeCloseTo(0.82, 12);
    expect(transformAt(65)).toContain("rotateX(0deg)");
    expect(transformAt(65)).toContain(`scale(${trimScale.trimScale(1.35)})`);
    // 软影:悬空 0.32 → 落地收干 0。
    expect(droneDiveShadowStyleAtFrame(0, { src: SRC }).opacity).toBeCloseTo(0.32, 5);
    expect(droneDiveShadowStyleAtFrame(65, { src: SRC }).opacity).toBe(0);
  });

  it("上游等价:锚点取 hero(518,335) 时,组件平面 transform 逐字复刻上游起手/终位", () => {
    const props = { src: SRC, originX: 518 / 1920, originY: 335 / 1080 };
    // 上游 p=0:translate(256,150) rotateX(72°) scale(0.42);p=1:(442,205) 0° 1.35。
    expect(String(droneDivePlaneStyleAtFrame(20, props).transform)).toContain(
      `translate(${trimScale.trimScale(256)}px, ${trimScale.trimScale(150)}px) rotateX(72deg) scale(${trimScale.trimScale(0.42)})`,
    );
    expect(String(droneDivePlaneStyleAtFrame(65, props).transform)).toContain(
      `translate(${trimScale.trimScale(442)}px, ${trimScale.trimScale(205)}px) rotateX(0deg) scale(${trimScale.trimScale(1.35)})`,
    );
  });

  it("地面软影接线:div 内联样式即 droneDiveShadowStyleAtFrame 的投影(高度感线索)", () => {
    currentFrame.value = 32;
    const { container } = render(<DroneDiveLanding src={SRC} />);
    const shadow = shadowElement(container);
    const expected = droneDiveShadowStyleAtFrame(32, { src: SRC }, 1920, 1080);
    expect(shadow.style.left).toBe(String(expected.left));
    expect(shadow.style.opacity).toBe(`${expected.opacity}`);
    expect(shadow.style.width).toBe(String(expected.width));
    expect(shadow.style.height).toBe(String(expected.height));
    expect(shadow.style.borderRadius).toBe("50%");
    expect(shadow.style.filter).toContain("blur(18px)");
  });

  it("曲线接线:组件内曲线即 vsc-helpers 的 droneDiveAtFrame(防双实现漂移)", () => {
    const props = { src: SRC, diveFrames: 20, landFrames: 15, diveShare: 0.8 };
    for (const frame of [0, 20, 40, 55, 70]) {
      const sample = droneDiveAtFrame(frame, { diveFrames: 20, landFrames: 15, diveShare: 0.8 });
      const style = droneDivePlaneStyleAtFrame(frame, props);
      expect(String(style.transform)).toContain(`rotateX(${trimScale.trimScale(sample.rotateXDeg)}deg)`);
      expect(String(style.transform)).toContain(`scale(${trimScale.trimScale(sample.scale)})`);
    }
  });

  it("帧级确定性:同 props 两次渲染,全帧 HTML 树同哈希(铁律:无 Math.random/Date.now)", () => {
    const variants = [
      { src: SRC },
      { src: SRC, diveStartFrame: 10 },
      { src: SRC, originX: 0.27, originY: 0.31, diveShare: 0.85 },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame <= 80; frame++) {
        currentFrame.value = frame;
        const firstPass = render(<DroneDiveLanding {...props} />);
        runA.push(firstPass.container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        const secondPass = render(<DroneDiveLanding {...props} />);
        runB.push(secondPass.container.innerHTML);
        cleanup();
      }
      expect(runA.length).toBe(81);
      // 逐帧两次渲染同哈希;整段序列(帧序列)也稳定。
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });
});
