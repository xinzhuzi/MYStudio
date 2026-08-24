import { describe, expect, it } from "vitest";
import parityFixture from "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/three-track-parity-fixture.json";
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

  it("matches the shared MYStudio-MA three-track parity fixture", async () => {
    expect(parityFixture.contractVersion).toBe(DAOJIE_RUNTIME_CONTRACT.contractVersion);
    for (const fixture of parityFixture.tracks) {
      const mapping = mapDaojieLibraryAssetType(fixture.libraryType);
      expect(mapping).toEqual({
        libraryType: fixture.libraryType,
        runtimeTrack: fixture.runtimeTrack,
        maTrack: fixture.maTrack,
      });
      const compiled = await compileDaojiePrompt({
        runtimeTrack: mapping.runtimeTrack,
        subjectBody: parityFixture.subjectBody,
        negativeTerms: parityFixture.negative,
        paletteSchemeId: fixture.paletteSchemeId,
        hasReferenceImage: true,
      });
      expect(compiled.moduleIds).toEqual(
        parityFixture.moduleOrder.map((moduleId) => moduleId
          .replace("{maTrack}", fixture.maTrack)
          .replace("{paletteSchemeId}", fixture.paletteSchemeId)),
      );
    }
    for (const fixture of parityFixture.lengthCases) {
      const positive = "x".repeat(fixture.totalChars - "\nAvoid: ".length - 1);
      expect(evaluateDaojiePromptLength(positive, "n")).toMatchObject({
        totalChars: fixture.totalChars,
        status: fixture.status,
        ok: fixture.ok,
      });
    }
  });
});

describe("Daojie ma-gongbi-v1 runtime contract", () => {
  it("ships a bounded, source-fingerprinted machine contract", () => {
    expect(DAOJIE_RUNTIME_CONTRACT.contractVersion).toBe("ma-gongbi-v1");
    expect(DAOJIE_RUNTIME_CONTRACT.contractSha256).toBe(
      "65e70c47aea41c74075be7f7abef49d6461901b9f09ff35098eda02bfa4646bb",
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
    // MA 传输形态:核心模块空格相连,成片/参考图锁以换行追加
    expect(withReference.positive).toMatch(/% light。?\n成片质量（硬）/);
    expect(withReference.positive).toMatch(/清晰度。\n参考图降噪（硬）/);
    expect(withoutReference.positive.match(/\n/g)).toHaveLength(1);
    expect(withoutReference.positive).not.toContain("参考图降噪");
    // MA transport 负面方言:作业负面在前,词条以 ", " 连接
    expect(withoutReference.negative).toMatch(/^水印, 自定义负面, AI 泥糊噪点/);
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

describe("Daojie palette scheme compilation (ma-gongbi-palette-v1)", () => {
  it("emits the MA-shaped recipe module when a scheme is selected", async () => {
    const compiled = await compileDaojiePrompt({
      runtimeTrack: "character",
      subjectBody: "焚香仪式中的符修，面部与手势清晰。",
      negativeTerms: ["水印"],
      paletteSchemeId: "person.02",
    });
    expect(compiled.moduleIds).toContain("palette.person.02");
    expect(compiled.moduleIds).not.toContain("palette.source-facts-only");
    expect(compiled.positive).toContain("配料方案（朱砂法脉）：底色用米白；墨线用浓墨；主色用朱砂；辅色用赭石；点睛色用暗金。");
    expect(compiled.moduleLengths["palette.person.02"]).toBeGreaterThan(0);
    expect(compiled.moduleAudit.find((m) => m.moduleId === "palette.person.02")?.singletonKey).toBe("gongbi_palette_scheme");
    expect(compiled.providerPrompt.match(/Avoid:/g)).toHaveLength(1);
  });

  it("defaults to source-facts-only without a scheme (byte-stable legacy path)", async () => {
    const compiled = await compileDaojiePrompt({
      runtimeTrack: "character",
      subjectBody: "题材正文。",
    });
    expect(compiled.moduleIds).toContain("palette.source-facts-only");
    expect(compiled.positive).toContain("不注入默认色相或默认职责色");
  });

  it.each([
    ["unknown id", "person.99", "character"],
    ["cross-track", "person.02", "scene"],
  ] as const)("rejects %s scheme usage before compilation", (_label, schemeId, runtimeTrack) => {
    void expect(
      compileDaojiePrompt({ runtimeTrack, subjectBody: "题材正文。", paletteSchemeId: schemeId }),
    ).rejects.toThrow(/daojie palette scheme/);
  });
});

describe("Daojie subject ownership (MA _assert_clean_primary 对齐)", () => {
  it.each(["风格底座（硬）", "TRACK=person", "配料方案", "Avoid: 水印", "成片质量（硬"])(
    "rejects subject body carrying automatic owner marker %j",
    (fragment) => {
      void expect(
        compileDaojiePrompt({ runtimeTrack: "character", subjectBody: `题材正文。${fragment}。` }),
      ).rejects.toThrowError(expect.objectContaining({ code: "invalid_subject" }));
    },
  );
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
      subjectBody: "x".repeat(5),
      negativeTerms: "Avoid: 水印, Avoid: 自定义缺陷",
    });
    expect(compiled.providerPrompt.match(/Avoid:/g)).toHaveLength(1);
    expect(compiled.negative).toContain("自定义缺陷");
    // status 必须由完整 provider-visible 文本决定，而非只看 positive。
    expect(compiled.positive.length).toBeLessThan(300);
    expect(compiled.status).toBe("ok");
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

  it.each([
    [299, "warning"],
    [300, "ok"],
    [800, "ok"],
  ] as const)("gates a %i-character storyboard 正文(frame negative excluded) as %s", async (positiveChars, status) => {
    // 帧门只算正文(固定帧负面 680/686 不计门,2026-08-25 死锁根修)
    const positive = "x".repeat(positiveChars);
    await expect(
      compileDaojieStoryboardFramePrompt({ positive, negativeTerms: "n" }),
    ).resolves.toMatchObject({ status, providerPrompt: `${positive}\nAvoid: n` });
  });

  it("fails closed at 801 storyboard 正文 characters before the network", async () => {
    const positive = "x".repeat(801);
    await expect(
      compileDaojieStoryboardFramePrompt({ positive, negativeTerms: "n" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "length_exceeded" }));
  });

  it("accepts a realistic frame whose fixed manual negative pushes total over 800 (deadlock regression)", async () => {
    // 实弹死锁形态: 正文 540 + 手册帧负面 680 = 总 1228,正文门下必须放行
    const compiled = await compileDaojieStoryboardFramePrompt({
      positive: "x".repeat(540),
      negativeTerms: "n".repeat(680),
    });
    expect(compiled.status).toBe("ok");
    expect(compiled.totalChars).toBe(540 + "\nAvoid: ".length + 680);
  });

  it("rejects a positive that already carries a terminal Avoid section", async () => {
    await expect(
      compileDaojieStoryboardFramePrompt({ positive: "正文\nAvoid: 水印" }),
    ).rejects.toThrowError(expect.objectContaining({ code: "invalid_subject" }));
  });
});
