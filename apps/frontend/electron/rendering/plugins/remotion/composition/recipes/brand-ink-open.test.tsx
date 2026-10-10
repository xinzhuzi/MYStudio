// @vitest-environment jsdom
// 章头墨线开篇(10-10 批D)——上游 BrandInkOpen.tsx @ 5ddbf521 曲线常数烧金样
// + 帧级确定性(同帧两次渲染同哈希;铁律:无 Math.random/Date.now)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const currentFrame = { value: 0 };

vi.mock("remotion", async (importOriginal) => ({
  // Easing/interpolate 走真实现(曲线逐值核对),只 mock React 侧帧边界。
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => currentFrame.value,
  AbsoluteFill: ({ children, style }: { children?: unknown; style?: unknown }) =>
    <div data-testid="absolute-fill" data-style={JSON.stringify(style)}>
      {children as never}
    </div>,
}));

vi.mock("@fontsource/noto-serif-sc/900.css", () => ({}));

const { BrandInkOpen, BRAND_INK_OPEN_DURATION, VSC_BRAND_INK_OPEN_ID, brandInkOpenSampleAtFrame } =
  await import("./brand-ink-open");

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

describe("brand-ink-open 章头开篇", () => {
  afterEach(() => cleanup());

  it("命名锚与定稿时长(参考实现 104f,含 R1 完整标题停留)", () => {
    expect(VSC_BRAND_INK_OPEN_ID).toBe("vsc:brand-ink-open");
    expect(BRAND_INK_OPEN_DURATION).toBe(104);
  });

  it("十字准星描画曲线逐值对齐上游(竖 0→9f、横 8→18f,24→34f 淡出)", () => {
    const sample = (frame: number) => brandInkOpenSampleAtFrame(frame, { wordmark: "道劫" });
    expect(sample(0).crosshairVDashoffset).toBe(100);
    expect(sample(9).crosshairVDashoffset).toBe(0);
    expect(sample(0).crosshairHDashoffset).toBe(100);
    expect(sample(8).crosshairHDashoffset).toBe(100);
    expect(sample(18).crosshairHDashoffset).toBe(0);
    expect(sample(24).crosshairOpacity).toBe(1);
    expect(sample(29).crosshairOpacity).toBeCloseTo(0.5, 5);
    expect(sample(34).crosshairOpacity).toBe(0);
  });

  it("字标逐字 letterpress:delay=10+i·3、12f 压印,glint ±4f 短划", () => {
    const sample = brandInkOpenSampleAtFrame(0, { wordmark: "ABC" });
    expect(sample.glyphs.map((glyph) => glyph.char)).toEqual(["A", "B", "C"]);
    // 第 0 字 delay=10、第 1 字 delay=13、第 2 字 delay=16;帧 13 时 A 压印中
    // (eased 进度∈(0,1))而 B 未起,帧 22 时 A 落定(t=1)、B 已压印。
    const frame13 = brandInkOpenSampleAtFrame(13, { wordmark: "ABC" });
    expect(frame13.glyphs[0]!.t).toBeGreaterThan(0);
    expect(frame13.glyphs[0]!.t).toBeLessThan(1);
    expect(frame13.glyphs[1]!.t).toBe(0);
    expect(brandInkOpenSampleAtFrame(22, { wordmark: "ABC" }).glyphs[0]!.t).toBe(1);
    expect(brandInkOpenSampleAtFrame(22, { wordmark: "ABC" }).glyphs[1]!.t).toBeGreaterThan(0);
    // glint 中心=delay+12:A 的 glint 峰在帧 22。
    expect(brandInkOpenSampleAtFrame(22, { wordmark: "ABC" }).glyphs[0]!.glint).toBe(1);
    expect(brandInkOpenSampleAtFrame(18, { wordmark: "ABC" }).glyphs[0]!.glint).toBe(0);
    // 末字「C」(i=2)落定帧=10+2·3+12=28;全 3 字词的完整标题落定 ≤67f 卡片底线。
    expect(brandInkOpenSampleAtFrame(28, { wordmark: "ABC" }).glyphs[2]!.t).toBe(1);
  });

  it("kicker 打字机:0.7f/字符、28f 起;打字完 2f 周期闪,95f 停闪;缺省无 kicker 行", () => {
    const withKicker = brandInkOpenSampleAtFrame(28, { wordmark: "道劫", kicker: "ABC" });
    expect(withKicker.kickerChars).toBe(0);
    expect(brandInkOpenSampleAtFrame(28.8, { wordmark: "道劫", kicker: "ABC" }).kickerChars).toBe(1);
    // 0.7f/字符非整步:整数帧计数 floor 跳变(30→2 字、31→4 字;上游同式)。
    expect(brandInkOpenSampleAtFrame(30, { wordmark: "道劫", kicker: "ABC" }).kickerChars).toBe(2);
    expect(brandInkOpenSampleAtFrame(31, { wordmark: "道劫", kicker: "ABC" }).kickerChars).toBe(4);
    // 帧边界受 Math.floor 钳制:整数帧 29 → floor((29-28)/0.7)=1。
    expect(brandInkOpenSampleAtFrame(29, { wordmark: "道劫", kicker: "ABC" }).kickerChars).toBe(1);
    // 95f 后光标停闪。
    expect(brandInkOpenSampleAtFrame(96, { wordmark: "道劫", kicker: "ABC" }).cursorOn).toBe(false);
    // 组件侧:无 kicker → 不渲染打字机行(占位文本仅出现 wordmark)。
    currentFrame.value = 40;
    const { container } = render(<BrandInkOpen wordmark="道劫" />);
    expect(container.textContent).toBe("道劫");
  });

  it("品牌组退场:97→104f 上浮+缩+淡(97 前静止、104 完全退场)", () => {
    expect(brandInkOpenSampleAtFrame(96, { wordmark: "道劫" }).brandOut).toBe(0);
    expect(brandInkOpenSampleAtFrame(97, { wordmark: "道劫" }).brandOut).toBe(0);
    expect(brandInkOpenSampleAtFrame(104, { wordmark: "道劫" }).brandOut).toBe(1);
    // 组件样式=纯采样薄包装:帧 100 的组 opacity = 1−brandOut(100)。
    currentFrame.value = 100;
    const { getByTestId } = render(<BrandInkOpen wordmark="道劫" />);
    const style = JSON.parse(getByTestId("absolute-fill").getAttribute("data-style") ?? "{}");
    expect(style.backgroundColor).toBe("#faf7f2");
    expect(style.justifyContent).toBe("center");
  });

  it("帧级确定性:同 props 两次渲染全帧 HTML 同哈希(铁律)", () => {
    const variants = [
      { wordmark: "道劫" },
      { wordmark: "漫影工作室", kicker: "第一卷 · 风起云涌" },
      { wordmark: "AI Foundation Lab", kicker: "TEAM RESEARCH CONSOLE" },
    ];
    for (const props of variants) {
      const runA: string[] = [];
      const runB: string[] = [];
      for (let frame = 0; frame <= BRAND_INK_OPEN_DURATION; frame++) {
        currentFrame.value = frame;
        runA.push(render(<BrandInkOpen {...props} />).container.innerHTML);
        cleanup();
        currentFrame.value = frame;
        runB.push(render(<BrandInkOpen {...props} />).container.innerHTML);
        cleanup();
      }
      expect(runA).toHaveLength(BRAND_INK_OPEN_DURATION + 1);
      expect(runA.map(fnv1a)).toEqual(runB.map(fnv1a));
    }
  });
});
