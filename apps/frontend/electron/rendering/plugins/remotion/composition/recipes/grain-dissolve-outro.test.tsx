// @vitest-environment jsdom
// 章尾砂化凝聚(10-10 批D)——上游 GrainDissolve.tsx @ 5ddbf521 四段曲线烧金样
// + 确定性(seed=floor(t·46) 帧号派生,同帧同噪声图;铁律:无 Math.random/Date.now)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const currentFrame = { value: 0 };
const videoConfig = { durationInFrames: 60, fps: 30, width: 1920, height: 1080 };

vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => currentFrame.value,
  useVideoConfig: () => videoConfig,
  AbsoluteFill: ({ children, style }: { children?: unknown; style?: unknown }) =>
    <div data-testid="absolute-fill" data-style={JSON.stringify(style)}>
      {children as never}
    </div>,
}));

const { GrainDissolve, GRAIN_DISSOLVE_DURATION, VSC_GRAIN_DISSOLVE_ID, grainDissolveSampleAtFrame } =
  await import("./grain-dissolve-outro");

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

describe("grain-dissolve 章尾砂化凝聚", () => {
  afterEach(() => cleanup());

  it("命名锚与定稿时长(2s@30fps=60f)", () => {
    expect(VSC_GRAIN_DISSOLVE_ID).toBe("vsc:grain-dissolve");
    expect(GRAIN_DISSOLVE_DURATION).toBe(60);
  });

  it("四段曲线烧金样:burst 0.13–0.28/cond 0.60–0.71/lock 0.68–0.90/settle 0.88–1", () => {
    const props = { tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" };
    const sample = (frame: number) => grainDissolveSampleAtFrame(frame, 60, props);
    // 段前 0、段后 1(t=frame/60)。
    expect(sample(7).burst).toBe(0);   // t≈0.117 < 0.13
    expect(sample(8).burst).toBeGreaterThan(0); // t≈0.133
    expect(sample(20).burst).toBeCloseTo(1, 3); // t≈0.333(段后保持 1)
    expect(sample(35).cond).toBe(0);   // t≈0.583 < 0.60
    expect(sample(45).cond).toBeCloseTo(1, 3);  // t=0.75(段后保持 1)
    expect(sample(50).lock).toBeGreaterThan(0); // t≈0.833
    expect(sample(54).lock).toBeCloseTo(1, 3);  // t=0.9
    expect(sample(59).settle).toBeGreaterThan(0); // t≈0.983
    // 辉光包络 burst·0.3 + cond·0.7 − settle·0.45(帧 20:0.3·1+0−0=0.3)。
    expect(sample(20).glow).toBeCloseTo(0.3, 3);
    // 凝聚冲高点(帧 45:0.3+0.7−0=1.0);凝固定格余温(帧 59≈1−0.45·settle)。
    expect(sample(45).glow).toBeCloseTo(1, 3);
  });

  it("feTurbulence seed=floor(t·46) 帧号派生(确定性:同帧同噪声图,换帧必换图)", () => {
    const props = { tagline: "x", shortMark: "y" };
    expect(grainDissolveSampleAtFrame(0, 60, props).seed).toBe(0);
    expect(grainDissolveSampleAtFrame(2, 60, props).seed).toBe(1);   // 2/60·46≈1.53
    expect(grainDissolveSampleAtFrame(20, 60, props).seed).toBe(15); // 20/60·46≈15.3
    expect(grainDissolveSampleAtFrame(20, 60, props).seed)
      .toBe(grainDissolveSampleAtFrame(20, 60, props).seed);
    // 2s 内 46 次换图(卡片:换图率 ≥20 次/秒)。
    expect(grainDissolveSampleAtFrame(59, 60, props).seed).toBe(45);
  });

  it("短标字号自适应(卡片已知坑:>6 字符每字缩 3px,下限 36px)", () => {
    const base = { tagline: "x" } as const;
    expect(grainDissolveSampleAtFrame(0, 60, { ...base, shortMark: "道劫" }).shortMarkFontSize).toBe(54);
    expect(grainDissolveSampleAtFrame(0, 60, { ...base, shortMark: "一二三四五六七" }).shortMarkFontSize).toBe(51);
    expect(grainDissolveSampleAtFrame(0, 60, { ...base, shortMark: "一二三四五六七八九十甲乙" }).shortMarkFontSize).toBe(36);
  });

  it("选区框:砂化浮现、凝聚前撤掉(opacity=burst·(1−seg(0.55,0.64)))", () => {
    const props = { tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" };
    const sample = (frame: number) => grainDissolveSampleAtFrame(frame, 60, props);
    expect(sample(0).boxOpacity).toBe(0);
    expect(sample(34).boxOpacity).toBeGreaterThan(0); // t≈0.567:浮现中
    expect(sample(40).boxOpacity).toBeCloseTo(0, 3);  // t≈0.667>0.64:已撤
  });

  it("组件渲染两行文案且整行/终字交叉淡化(换字发生在最沸腾段)", () => {
    currentFrame.value = 0;
    const { container, rerender } = render(
      <GrainDissolve tagline="{ 道劫 · 本章完 }" shortMark="道劫" />,
    );
    expect(container.textContent).toContain("本章完");
    expect(container.textContent).toContain("道劫");
    // 帧 0(凝前):整行 opacity=1−cond=1,终字 opacity=0——数值经采样函数核对。
    expect(grainDissolveSampleAtFrame(0, 60, { tagline: "x", shortMark: "y" }).cond).toBe(0);
    currentFrame.value = 45;
    rerender(<GrainDissolve tagline="{ 道劫 · 本章完 }" shortMark="道劫" />);
    expect(grainDissolveSampleAtFrame(45, 60, { tagline: "x", shortMark: "y" }).cond).toBeCloseTo(1, 3);
  });

  it("帧级确定性:同 props 两次渲染全帧 HTML 同哈希(铁律)", () => {
    const variants = [
      { tagline: "{ 道劫 · 本章完 }", shortMark: "道劫" },
      { tagline: "{ ACME. Now Live }", shortMark: "ACME" },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame < GRAIN_DISSOLVE_DURATION; frame++) {
        currentFrame.value = frame;
        runA.push(render(<GrainDissolve {...props} />).container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        runB.push(render(<GrainDissolve {...props} />).container.innerHTML);
        cleanup();
      }
      expect(runA).toHaveLength(GRAIN_DISSOLVE_DURATION);
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });
});
