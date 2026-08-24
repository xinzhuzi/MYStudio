import { describe, expect, it } from "vitest";
import {
  DAOJIE_RUNTIME_CONTRACT,
  DaojiePromptContractError,
  compileDaojiePrompt,
  compileDaojieStoryboardFramePrompt,
  evaluateDaojiePromptLength,
  mapDaojieLibraryAssetType,
  mapDaojieRuntimeTrack,
  validateDaojieRuntimeContract,
} from "./daojie-prompt-contract";

describe("Daojie three-track boundary", () => {
  it.each([
    ["role", { libraryType: "role", runtimeTrack: "character", maTrack: "person" }],
    ["scene", { libraryType: "scene", runtimeTrack: "scene", maTrack: "scene" }],
    ["tool", { libraryType: "tool", runtimeTrack: "prop", maTrack: "prop" }],
  ] as const)("maps %s without a fallback track", (input, expected) => {
    expect(mapDaojieLibraryAssetType(input)).toEqual(expected);
  });

  it.each(["clip", "audio", "任务", "", "unknown", null, undefined])(
    "rejects unsupported library type %j before compilation",
    (input) => {
      expect(() => mapDaojieLibraryAssetType(input)).toThrowError(
        expect.objectContaining<Partial<DaojiePromptContractError>>({
          code: "unsupported_asset_type",
        }),
      );
    },
  );

  it.each([
    ["character", "person"],
    ["scene", "scene"],
    ["prop", "prop"],
  ] as const)("keeps runtime track %s aligned with MA %s", (runtimeTrack, maTrack) => {
    expect(mapDaojieRuntimeTrack(runtimeTrack)).toEqual({ runtimeTrack, maTrack });
  });

  it("rejects an unknown runtime track instead of defaulting", () => {
    expect(() => mapDaojieRuntimeTrack("任务")).toThrowError(
      expect.objectContaining({ code: "unsupported_track" }),
    );
  });
});

describe("Daojie ma-gongbi-v1 runtime contract", () => {
  it("ships a bounded, source-fingerprinted machine contract", () => {
    expect(DAOJIE_RUNTIME_CONTRACT.contractVersion).toBe("ma-gongbi-v1");
    expect(DAOJIE_RUNTIME_CONTRACT.contractSha256).toBe(
      "57e49bc6c92937e50bc5e195e938ce3d098b8cd681bd4571a500fd4788fff9f0",
    );
    expect(DAOJIE_RUNTIME_CONTRACT.avoidSeparator).toBe("\nAvoid: ");
    expect(DAOJIE_RUNTIME_CONTRACT.length).toEqual({ warningBelow: 300, min: 300, max: 800 });
    expect(DAOJIE_RUNTIME_CONTRACT.maSources.length).toBeGreaterThanOrEqual(3);
    expect(DAOJIE_RUNTIME_CONTRACT.moduleOrder).toEqual([
      "subject.body",
      "palette.source-facts-only",
      "style.gongbi-base",
      "style.gongbi-track.{maTrack}",
      "finish.quality",
      "reference.denoise",
      "negative.universal",
    ]);
    expect(DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].text).toContain("浅净哑光平涂底");
    expect(DAOJIE_RUNTIME_CONTRACT.modules["style.gongbi-base"].moduleId).toBe("style.gongbi-base");
    expect(DAOJIE_RUNTIME_CONTRACT.modules["negative.universal"].text).toContain("压缩伪影");
  });

  it("validates the shipped schema and rejects missing required module metadata", () => {
    expect(validateDaojieRuntimeContract(DAOJIE_RUNTIME_CONTRACT)).toBe(DAOJIE_RUNTIME_CONTRACT);
    const invalid = structuredClone(DAOJIE_RUNTIME_CONTRACT) as typeof DAOJIE_RUNTIME_CONTRACT;
    invalid.modules["finish.quality"].singletonKey = "";
    expect(() => validateDaojieRuntimeContract(invalid)).toThrowError(
      expect.objectContaining({ code: "invalid_contract" }),
    );
  });

  it("assembles one deterministic module owner per automatic layer", async () => {
    const withoutReference = await compileDaojiePrompt({
      runtimeTrack: "character",
      subjectBody: "晏燎立于矿场入口，身份、姿态、服饰与构图事实清晰可读。",
      negativeTerms: ["水印", "自定义负面", "水印"],
      hasReferenceImage: false,
    });
    const withReference = await compileDaojiePrompt({
      runtimeTrack: "character",
      subjectBody: "晏燎立于矿场入口，身份、姿态、服饰与构图事实清晰可读。",
      hasReferenceImage: true,
    });

    expect(withoutReference.moduleIds).toEqual([
      "subject.body",
      "palette.source-facts-only",
      "style.gongbi-base",
      "style.gongbi-track.person",
      "finish.quality",
      "negative.universal",
    ]);
    expect(withReference.moduleIds).toEqual([
      "subject.body",
      "palette.source-facts-only",
      "style.gongbi-base",
      "style.gongbi-track.person",
      "finish.quality",
      "reference.denoise",
      "negative.universal",
    ]);
    expect(new Set(withReference.moduleIds).size).toBe(withReference.moduleIds.length);
    expect(withReference.providerPrompt).toBe(
      `${withReference.positive}\nAvoid: ${withReference.negative}`,
    );
    expect(withReference.providerPrompt.match(/Avoid:/g)).toHaveLength(1);
    expect(withReference.negative.match(/水印/g)).toHaveLength(1);
    expect(withReference.moduleLengths["reference.denoise"]).toBeGreaterThan(0);
    expect(withoutReference.moduleLengths["reference.denoise"]).toBeUndefined();
    expect(withReference.moduleAudit.map(({ singletonKey }) => singletonKey)).toEqual([
      "subject_body",
      "gongbi_palette_scheme",
      "gongbi_style_base",
      "gongbi_style_track",
      "finish_quality",
      "reference_denoise",
      "universal_negative",
    ]);
    expect(withReference.moduleAudit.every(({ required }) => required)).toBe(true);
    expect(withReference.contractSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(withReference.totalChars).toBe(withReference.providerPrompt.length);
    expect(withReference.moduleLengths["negative.universal"]).toBe(withReference.negative.length);
  });

  it.each([
    ["character", "person"],
    ["scene", "scene"],
    ["prop", "prop"],
  ] as const)("compiles %s with exactly one matching MA track module", async (runtimeTrack, maTrack) => {
    const compiled = await compileDaojiePrompt({ runtimeTrack, subjectBody: "题材事实、身份与构图。" });
    expect(compiled.maTrack).toBe(maTrack);
    expect(compiled.moduleIds.filter((moduleId) => moduleId.startsWith("style.gongbi-track."))).toEqual([
      `style.gongbi-track.${maTrack}`,
    ]);
  });
});

describe("Daojie provider-visible length policy", () => {
  it.each([
    [299, "warning", true],
    [300, "ok", true],
    [800, "ok", true],
    [801, "over_limit", false],
  ] as const)("counts the full prompt at %i characters", (total, status, ok) => {
    const result = evaluateDaojiePromptLength("x".repeat(total - "\nAvoid: ".length - 1), "x");
    expect(result).toMatchObject({ totalChars: total, status, ok });
  });

  it("fails closed from the composer when required content is over 800", async () => {
    try {
      await compileDaojiePrompt({ runtimeTrack: "prop", subjectBody: "x".repeat(500) });
      throw new Error("expected the required prompt to exceed the provider limit");
    } catch (error) {
      expect(error).toEqual(expect.objectContaining<Partial<DaojiePromptContractError>>({ code: "length_exceeded" }));
      expect((error as DaojiePromptContractError).details).toEqual(expect.objectContaining({
        totalChars: expect.any(Number),
        moduleLengths: expect.objectContaining({ "subject.body": 500 }),
      }));
    }
  });

  it("uses Python-equivalent Unicode code-point counts and owns the only Avoid label", async () => {
    expect(evaluateDaojiePromptLength("😀", "x")).toMatchObject({
      positiveChars: 1,
      totalChars: 10,
    });
    const compiled = await compileDaojiePrompt({
      runtimeTrack: "character",
      subjectBody: "人物事实",
      negativeTerms: "Avoid: 水印, Avoid: 自定义缺陷",
    });
    expect(compiled.providerPrompt.match(/Avoid:/g)).toHaveLength(1);
    expect(compiled.negative).toContain("自定义缺陷");
  });
});

describe("Daojie storyboard frame transport compile", () => {
  it("keeps the storyboard positive as-is with one shared Avoid tail", async () => {
    const compiled = await compileDaojieStoryboardFramePrompt({
      positive: "【画面】晏燎立于矿场入口。【构图】中景,浅净平涂底。",
      negativeTerms: "watermark, low quality",
    });
    expect(compiled.positive).toBe("【画面】晏燎立于矿场入口。【构图】中景,浅净平涂底。");
    // 不套静态资产七段/轨道锁——分镜保留自己的模板选择
    expect(compiled.positive).not.toContain("风格底座");
    expect(compiled.positive).not.toContain("TRACK=");
    expect(compiled.moduleIds).toEqual(["storyboard.frame", "negative.universal"]);
    expect(compiled.providerPrompt.match(/Avoid:/g)).toHaveLength(1);
    // 负面唯一所有者:提供帧负面时不再叠加通用负面(避免双占与必然超 800)
    expect(compiled.negative).toContain("watermark");
    expect(compiled.negative).not.toContain("压缩伪影");
    // 未提供帧负面时回退合同通用负面
    const fallback = await compileDaojieStoryboardFramePrompt({ positive: "【画面】题材正文" });
    expect(fallback.negative).toContain("压缩伪影");
    expect(fallback.contractSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("enforces the same 800 gate before the network", async () => {
    await expect(
      compileDaojieStoryboardFramePrompt({ positive: "长".repeat(800) }),
    ).rejects.toThrowError(expect.objectContaining({ code: "length_exceeded" }));
  });

  it("rejects a positive that already carries a terminal Avoid section", async () => {
    await expect(
      compileDaojieStoryboardFramePrompt({ positive: "正文\nAvoid: 水印" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "invalid_subject" }));
  });
});
