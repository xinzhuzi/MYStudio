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

const {
  PullBackIsolation,
  VSC_PULL_BACK_ISOLATION_ID,
  pullBackIsolationBackdropAtFrame,
  pullBackIsolationStyleAtFrame,
} = await import("./pull-back-isolation");
const { pullBackAtFrame } = await import("./vsc-helpers");
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

describe("pull-back-isolation 配方组件(单镜版)", () => {
  afterEach(() => cleanup());

  it("命名锚:全链 id 为 vsc:pull-back-isolation", () => {
    expect(VSC_PULL_BACK_ISOLATION_ID).toBe("vsc:pull-back-isolation");
  });

  it("媒体=分镜静图:Img 直接消费 media bridge capability URL,cover 满幅,主体无压暗滤镜", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(<PullBackIsolation src={SRC} />);
    expect(getByTestId("img").getAttribute("src")).toBe(SRC);
    const imgStyle = JSON.parse(getByTestId("img").getAttribute("data-style") ?? "{}");
    expect(imgStyle.objectFit).toBe("cover");
    expect(imgStyle.filter).toBeUndefined(); // 主体留光:无 brightness 压暗
  });

  it("组件样式 = 纯采样函数的薄包装(外框沉黑+主体层,全帧核对)", () => {
    const props = { src: SRC, originX: 0.4, originY: 0.6 };
    for (const frame of [0, 20, 60, 85, 100, 110, 140]) {
      currentFrame.value = frame;
      const { getAllByTestId } = render(<PullBackIsolation {...props} />);
      const fills = getAllByTestId("absolute-fill");
      expect(fills).toHaveLength(2); // 外框(沉黑)+ 主体层
      expect(JSON.parse(fills[0].getAttribute("data-style") ?? "{}")).toEqual(
        pullBackIsolationBackdropAtFrame(frame, props),
      );
      expect(JSON.parse(fills[1].getAttribute("data-style") ?? "{}")).toEqual(
        pullBackIsolationStyleAtFrame(frame, props),
      );
      cleanup();
    }
  });

  it("后拉语义:0f scale=2.2 → 110f=0.62;origin 锁主体锚点", () => {
    const startStyle = pullBackIsolationStyleAtFrame(0, { src: SRC, originX: 0.3, originY: 0.7 });
    expect(String(startStyle.transform)).toContain(`scale(${trimScale.trimScale(2.2)})`);
    expect(startStyle.transformOrigin).toBe("30% 70%");
    const endStyle = pullBackIsolationStyleAtFrame(110, { src: SRC });
    expect(String(endStyle.transform)).toContain(`scale(${trimScale.trimScale(0.62)})`);
  });

  it("主体留光背景沉黑:背景 60–110f rgb(236)→rgb(20);光晕 60–100f 双层白 shadow 淡入", () => {
    expect(String(pullBackIsolationBackdropAtFrame(59, { src: SRC }).background)).toBe("rgb(236,236,236)");
    expect(String(pullBackIsolationBackdropAtFrame(110, { src: SRC }).background)).toBe("rgb(20,20,20)");
    // 光晕在沉黑前夜才开始,与沉黑同步(卡片:与沉黑同步才成立)。
    expect(String(pullBackIsolationStyleAtFrame(59, { src: SRC }).boxShadow)).not.toContain("0.0");
    expect(String(pullBackIsolationStyleAtFrame(80, { src: SRC }).boxShadow)).toContain(
      `rgba(255,255,255,${trimScale.trimScale(pullBackAtFrame(80).glow)})`,
    );
  });

  it("曲线接线:组件内曲线即 vsc-helpers 的 pullBackAtFrame(防双实现漂移)", () => {
    const props = { src: SRC, pullFrames: 90, toScale: 0.7 };
    for (const frame of [0, 45, 90, 120]) {
      const sample = pullBackAtFrame(frame, props);
      const style = pullBackIsolationStyleAtFrame(frame, props);
      expect(String(style.transform)).toContain(`scale(${trimScale.trimScale(sample.scale)})`);
      expect(String(style.boxShadow)).toContain(`rgba(255,255,255,${trimScale.trimScale(sample.glow)})`);
    }
  });

  it("帧级确定性:同 props 两次渲染,全帧 HTML 树同哈希(铁律:无 Math.random/Date.now)", () => {
    const variants = [
      { src: SRC },
      { src: SRC, pullFrames: 90 },
      { src: SRC, pullFrames: 100, originX: 0.35, originY: 0.65, glowMax: 0.3 },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame <= 140; frame++) {
        currentFrame.value = frame;
        const firstPass = render(<PullBackIsolation {...props} />);
        runA.push(firstPass.container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        const secondPass = render(<PullBackIsolation {...props} />);
        runB.push(secondPass.container.innerHTML);
        cleanup();
      }
      expect(runA.length).toBe(141);
      // 逐帧两次渲染同哈希;整段序列(帧序列)也稳定。
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });
});
