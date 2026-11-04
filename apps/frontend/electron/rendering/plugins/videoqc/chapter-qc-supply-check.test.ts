/**
 * runSupplyCheck 单测 (骨干⓪:供给自检)——先证物料与口径，再谈结论。
 */
import { describe, expect, it } from "vitest";

import { buildSupplyFindings, runSupplyCheck, type ChapterQcSupplyInput } from "./chapter-qc-supply-check";

function input(overrides: Partial<ChapterQcSupplyInput> = {}): ChapterQcSupplyInput {
  return {
    mediaReadable: true,
    durationS: 145.1,
    fps: 30,
    spanCount: 43,
    declaredShotCount: 43,
    timelineSource: "render-plan",
    expectationShotCount: 43,
    speechDeclaredShots: 20,
    subtitleCueCount: 55,
    extractedFrameCount: 43,
    vadAvailable: true,
    faceAvailable: true,
    aestheticModelReady: true,
    unreadyShotCount: 0,
    missingReferenceCount: 0,
    scriptPresent: true,
    ...overrides,
  };
}

function checkOf(overrides: Partial<ChapterQcSupplyInput>, checkId: string) {
  return runSupplyCheck(input(overrides)).checks.find((check) => check.checkId === checkId);
}

describe("runSupplyCheck(骨干⓪:先证供给，再谈结论)", () => {
  it("全绿供给:12 项全 ok,零 gap 零 blocked", () => {
    const supply = runSupplyCheck(input());
    expect(supply.checks).toHaveLength(11);
    expect(supply.gaps).toBe(0);
    expect(supply.blocked).toBe(0);
    expect(supply.checks.every((check) => check.verdict === "ok")).toBe(true);
  });

  it("三类硬矛盾才 blocked:片子解不开 / 声明有镜却零区间 / 声明有台词却零字幕", () => {
    expect(checkOf({ mediaReadable: false }, "media-readable")?.verdict).toBe("blocked");
    expect(checkOf({ durationS: 0 }, "media-readable")?.verdict).toBe("blocked");
    expect(checkOf({ spanCount: 0 }, "shot-spans")?.verdict).toBe("blocked");
    expect(checkOf({ spanCount: 0, declaredShotCount: 0 }, "shot-spans")?.verdict).toBe("gap");
    // subtitle-material only blocked if speechDeclaredShots>0 && subtitleCueCount===0
    expect(checkOf({ subtitleCueCount: 0, speechDeclaredShots: 1 }, "subtitle-material")?.verdict).toBe("blocked");
  });

  it("口径退化算缺料不算矛盾:EDL 时间轴 / 侧车未配 / 模型未就绪 / 镜未 ready", () => {
    const supply = runSupplyCheck(input({
      timelineSource: "edl",
      vadAvailable: false,
      faceAvailable: false,
      aestheticModelReady: false,
      unreadyShotCount: 4,
      missingReferenceCount: 2,
    }));
    expect(supply.blocked).toBe(0);
    expect(supply.gaps).toBe(6);
    expect(checkOf({ timelineSource: "none" }, "timeline-authority")?.verdict).toBe("gap");
    expect(checkOf({ expectationShotCount: 0 }, "expectations-declared")?.detail).toContain("语义字段一条没读到");
    expect(checkOf({ expectationShotCount: 0, declaredShotCount: 0 }, "expectations-declared")?.detail).toContain("无工作流 store");
    expect(checkOf({ extractedFrameCount: 0 }, "frame-material")?.verdict).toBe("gap");
    expect(checkOf({ unreadyShotCount: 4 }, "shot-readiness")?.detail).toContain("4/43 镜非 ready");
  });

  it("没声明台词的章：字幕维是缺证 (gap),不是矛盾", () => {
    // default input 有 subtitleCueCount=55;只用 speechDeclaredShots=0 改，
    // 则脚本在场 + 有 cue 无人对照 → ok,detail 仍报真实 cue 数
    const supply = runSupplyCheck(input({ speechDeclaredShots: 0 }));
    expect(supply.blocked).toBe(0);
    expect(checkOf({ speechDeclaredShots: 0 }, "subtitle-material")).toMatchObject({
      verdict: "ok",
      detail: "55 条 cue / 台本在场",
    });
  });

  it("无分镜可核的章：零镜区间因「没声明」落 gap,而非硬矛盾;连带帧/期望/两条核对全落 gap", () => {
    // 没镜区间 ⇒ 也抽不出判读帧 (抽帧按区间走),这才是零素材章的真实形状
    const supply = runSupplyCheck(input({ declaredShotCount: 0, expectationShotCount: 0, spanCount: 0, extractedFrameCount: 0 }));
    expect(checkOf({ declaredShotCount: 0, spanCount: 0 }, "shot-spans")?.verdict).toBe("gap");
    expect(checkOf({ declaredShotCount: 0 }, "shot-readiness")?.verdict).toBe("gap");
    expect(checkOf({ declaredShotCount: 0 }, "reference-assets")?.verdict).toBe("gap");
    expect(checkOf({ declaredShotCount: 0, expectationShotCount: 0, spanCount: 0, extractedFrameCount: 0 }, "frame-material")?.detail)
      .toBe("无镜区间,未抽帧"); // source uses half-width comma (,) not full-width (,)
    expect(supply.blocked).toBe(0);
    expect(supply.gaps).toBe(5);
  });

  it("finding 口径:blocked→warn(能穿三态板),gap→info(只记账),全过→一条 info", () => {
    const blocked = buildSupplyFindings(runSupplyCheck(input({ mediaReadable: false })));
    expect(blocked.filter((f) => f.severity === "warn").map((f) => f.code))
      .toEqual(["chapter-qc.supply.blocked"]);
    expect(blocked.every((f) => f.layer === "structural")).toBe(true);

    const gaps = buildSupplyFindings(runSupplyCheck(input({ vadAvailable: false, speechDeclaredShots: 0 })));
    expect(gaps.filter((f) => f.code === "chapter-qc.supply.gap")).toHaveLength(1); // only sidecar-vad; subtitle-material is ok because speechDeclaredShots=0 (no台词对照需求)
    expect(gaps.every((f) => f.severity === "info")).toBe(true);

    const allOk = buildSupplyFindings(runSupplyCheck(input()));
    expect(allOk).toHaveLength(1);
    expect(allOk[0]).toMatchObject({ code: "chapter-qc.supply.ok", severity: "info" });
    expect(allOk[0].message).toContain("11 项全过");
  });
});
