import { describe, expect, it } from "vitest";
import { HYPERFRAMES_DECORATIVE_TEMPLATE_IDS } from "@rendering/contracts/video-workflow";
import { SUPPORTED_TEMPLATES } from "./hyperframes-worker";

/**
 * 三镜像同步守护(08-22 修):TS 契约白名单(HYPERFRAMES_DECORATIVE_TEMPLATE_IDS)
 * 必须全部能过 worker 的 SUPPORTED_TEMPLATES 门。08-21 剪映风扩容 20 新模板时
 * 漏改 worker Set,重跑撞上即 blocked「不支持的 templateId」——本测试防回归。
 * (worker 渲染 switch 的 case 覆盖由 hyperframes-worker.test.ts 行为测试兜底。)
 */
describe("hyperframes 模板三镜像同步", () => {
  it("契约装饰白名单 ⊆ worker SUPPORTED_TEMPLATES", () => {
    const missing = HYPERFRAMES_DECORATIVE_TEMPLATE_IDS.filter((id) => !SUPPORTED_TEMPLATES.has(id));
    expect(missing).toEqual([]);
  });

  it("08-21 扩容 20 新模板全部在门内(点名防再漏)", () => {
    const expansion = [
      "glitch-rgb", "glitch-slice", "glitch-scanline", "vhs-rewind", "pixel-blur",
      "strobe-flash", "neon-glow", "bokeh-lights", "star-twinkle", "confetti-burst",
      "heart-float", "bubble-rise", "zoom-pulse", "shake-earthquake", "wobble-jelly",
      "spin-hypnotic", "ripple-water", "fade-dip-black", "flash-white", "dream-soft",
    ];
    expect(expansion.filter((id) => !SUPPORTED_TEMPLATES.has(id))).toEqual([]);
  });
});
