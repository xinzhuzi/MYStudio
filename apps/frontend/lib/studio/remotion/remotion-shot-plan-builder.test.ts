import { describe, expect, it, vi } from "vitest";
import type { StoryboardItem } from "@/types/studio";
import type { SubtitleAuthority } from "@/types/editing";
import type { CinematicStoryboardItem } from "../cinematic-preset";
import { buildRemotionShotPlans } from "./remotion-shot-plan-builder";
import { makeShotAudioBindingV2 } from "./remotion-workspace-test-fixtures";

const HASH_A = "a".repeat(64);

function storyboard(index: number, chapterId = "chapter-001"): StoryboardItem & { subtitleAuthority: SubtitleAuthority } {
  return {
    id: `shot-${index}`,
    episodeId: chapterId,
    index,
    trackKey: "track-1",
    trackId: "track-1",
    duration: 2,
    prompt: `画面 ${index}`,
    videoDesc: "静态镜头",
    assetIds: [],
    mediaRef: { kind: "image", path: `project-file://project-a/shots/${index}.png`, contentSha256: HASH_A },
    state: "ready",
    lines: "",
    subtitleAuthority: {
      mode: "clean-remotion",
      evidence: { mode: "clean-remotion", decision: "imported-manifest", sourceFingerprint: HASH_A, evidencePaths: ["test"] },
    } satisfies SubtitleAuthority,
  };
}

describe("buildRemotionShotPlans", () => {
  it("renderSettings 携带 subtitleFont/chapterGrade/subtitleSfxEnabled 通过 manifest 校验（08-20 白名单回归）", async () => {
    // 08-19 字体链注入 subtitleFont、导演定调/字幕音效注入新字段后，App 一键成片经
    // shotValidationManifest 校验曾被"字段不属于当前 schema"全镜阻断——CLI 用硬编码
    // 窄形状不触发，故潜伏到首次真机 App 跑才炸。此用例锁住白名单补齐。
    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        subtitleFont: "liu-jian-mao-cao",
        chapterGrade: { lutId: "cn-zhusha", blend: 0.5 },
        subtitleSfxEnabled: true,
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [storyboard(1)],
      continuityPolicy: "skip",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plans[0]?.renderSettings.chapterGrade).toEqual({ lutId: "cn-zhusha", blend: 0.5 });
      expect(result.plans[0]?.renderSettings.subtitleSfxEnabled).toBe(true);
    }
  });

  it("chapterGrade 闭集外 lutId 被 manifest 校验拒绝（fail-closed）", async () => {
    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        chapterGrade: { lutId: "not-in-set", blend: 0.5 },
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [storyboard(1)],
      continuityPolicy: "skip",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.path.includes("renderSettings.chapterGrade"))).toBe(true);
    }
  });

  it("builds one parameterized plan per current-chapter storyboard", async () => {
    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [storyboard(1), storyboard(0)],
      continuityPolicy: "skip",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map((plan) => plan.shot.shotId)).toEqual(["shot-0", "shot-1"]);
    expect(result.plans.every((plan) => plan.target === "shot")).toBe(true);
    expect(result.plans[0]?.shot.visualSource.relativePath).toBe("shots/0.png");
  });

  it("preserves the storyboard cinematic contract in the compiled shot plan", async () => {
    const item = storyboard(0) as ReturnType<typeof storyboard> & CinematicStoryboardItem;
    item.cinematic = {
      preset: "cinematic-parallax-lr",
      parallaxStrength: 0.35,
      dofAperture: 2.8,
    };

    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [item],
      continuityPolicy: "skip",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plans[0]?.cinematic).toEqual(item.cinematic);
  });

  it("blocks missing fingerprint or cross-project media without fabricating a plan", async () => {
    const invalid = storyboard(0);
    invalid.mediaRef = { kind: "image", path: "project-file://project-b/shots/0.png", contentSha256: HASH_A };
    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [invalid],
      continuityPolicy: "skip",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((issue) => issue.code === "media.path")).toBe(true);
  });

  it("keeps independent valid shots when another shot is blocked", async () => {
    const invalid = storyboard(1);
    invalid.mediaRef = {
      kind: "image",
      path: "project-file://project-b/shots/1.png",
      contentSha256: HASH_A,
    };
    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [storyboard(0), invalid],
      continuityPolicy: "skip",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.plans.map((plan) => plan.shot.shotId)).toEqual(["shot-0"]);
    expect(result.blockedShotIds).toEqual(["shot-1"]);
  });

  it("requires first-chapter human approval but does not require it for later chapters", async () => {
    const firstChapter = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [storyboard(0)],
      requireHumanApproval: true,
      continuityPolicy: "skip",
    });
    expect(firstChapter.success).toBe(false);
    if (!firstChapter.success) expect(firstChapter.blockedShotIds).toEqual(["shot-0"]);

    const laterChapter = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-002",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [storyboard(0, "chapter-002")],
      requireHumanApproval: false,
      continuityPolicy: "skip",
    });
    expect(laterChapter.success).toBe(true);
  });

  it("supports zero, one, and arbitrary many shots without a fixed count", async () => {
    const renderSettings = {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264" as const,
      subtitleMode: "burn-in" as const,
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    };
    const empty = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings,
      storyboards: [],
      continuityPolicy: "skip",
    });
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.plans).toHaveLength(0);

    const one = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings,
      storyboards: [storyboard(0)],
      continuityPolicy: "skip",
    });
    expect(one.success).toBe(true);
    if (one.success) expect(one.plans).toHaveLength(1);

    const many = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings,
      storyboards: [storyboard(0), storyboard(1), storyboard(2)],
      continuityPolicy: "skip",
    });
    expect(many.success).toBe(true);
    if (many.success) expect(many.plans).toHaveLength(3);
  });

  it("projects canonical voice timing and extends the shot by the voice tail", async () => {
    const item = storyboard(0);
    item.duration = 1;
    item.lines = "逐镜对白";
    const voice = await makeShotAudioBindingV2({
      shotId: item.id,
      durationUs: 1_500_000,
      sourceStartUs: 0,
      sourceDurationUs: 1_500_000,
      volume: 0.8,
      fadeInUs: 100_000,
      fadeOutUs: 200_000,
      envelope: [
        { timeUs: 0, gain: 0.5 },
        { timeUs: 1_500_000, gain: 1 },
      ],
    });
    item.shotAudioBindings = [voice];
    item.audioRef = {
      kind: "audio",
      path: `project-file://project-a/${voice.source.relativePath}`,
      contentSha256: voice.source.contentSha256,
    };
    item.ttsJob = {
      schemaVersion: 1,
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: item.id,
      shotRevision: 1,
      inputFingerprint: voice.ttsInputFingerprint!,
      status: "completed",
      attempt: 1,
      createdAt: 100,
      updatedAt: 200,
    };

    const result = await buildRemotionShotPlans({
      projectId: "project-a",
      chapterId: "chapter-001",
      chapterRevision: 1,
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codec: "h264",
        subtitleMode: "burn-in",
        loudnessLufs: -14,
        truePeakDbtp: -1.5,
      },
      storyboards: [item],
      continuityPolicy: "skip",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plans[0]?.shot.durationUs).toBe(1_900_000);
    expect(result.plans[0]?.shot.audioBindings).toMatchObject([{
      role: "voice",
      volume: 0.8,
      fadeInUs: 100_000,
      fadeOutUs: 200_000,
      envelope: [
        { timeUs: 0, gain: 0.5 },
        { timeUs: 1_500_000, gain: 1 },
      ],
    }]);
  });

  it("recovers a blank mediaRef SHA-256 by hashing the actual project file", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const digest = await crypto.subtle.digest("SHA-256", payload);
    const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const item = storyboard(0);
    item.mediaRef = { kind: "image", path: "project-file://project-a/shots/0.png", contentSha256: "" };
    vi.stubGlobal("window", {
      projectFiles: {
        readAsBase64: async () => ({
          success: true,
          base64: `data:image/png;base64,${Buffer.from(payload).toString("base64")}`,
          mimeType: "image/png",
          size: payload.length,
        }),
      },
    });
    try {
      const result = await buildRemotionShotPlans({
        projectId: "project-a",
        chapterId: "chapter-001",
        chapterRevision: 1,
        renderSettings: {
          width: 1080,
          height: 1920,
          fps: 30,
          codec: "h264",
          subtitleMode: "burn-in",
          loudnessLufs: -14,
          truePeakDbtp: -1.5,
        },
        storyboards: [item],
        continuityPolicy: "skip",
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plans[0]?.shot.visualSource.contentSha256).toBe(expected);
      expect(item.mediaRef.contentSha256).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still blocks media.fingerprint when the referenced file cannot be read", async () => {
    const item = storyboard(0);
    item.mediaRef = { kind: "image", path: "project-file://project-a/shots/0.png", contentSha256: "" };
    vi.stubGlobal("window", {
      projectFiles: { readAsBase64: async () => ({ success: false, error: "not found" }) },
    });
    try {
      const result = await buildRemotionShotPlans({
        projectId: "project-a",
        chapterId: "chapter-001",
        chapterRevision: 1,
        renderSettings: {
          width: 1080,
          height: 1920,
          fps: 30,
          codec: "h264",
          subtitleMode: "burn-in",
          loudnessLufs: -14,
          truePeakDbtp: -1.5,
        },
        storyboards: [item],
        continuityPolicy: "skip",
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.issues.some((issue) => issue.code === "media.fingerprint")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("storyboardEffectiveDurationUs(D-1 单源:决策/选择两侧同一条时长)", () => {
  // 动态 import 探测锁:新增导出前静态 import 会 TS2305 全文件带红,探测锁让
  // 失败落在「expected function, got undefined」正确原因上(与 D5 探测锁同款)。
  const load = async () =>
    (await import("./remotion-shot-plan-builder")).storyboardEffectiveDurationUs;

  it("导出存在(RED:现实现无此导出)", async () => {
    expect(await load()).toBeTypeOf("function");
  });

  it("requested 主导:durationTarget 优先于 duration;floor 1", async () => {
    const fn = await load();
    expect(fn({ duration: 2 })).toBe(2_000_000);
    expect(fn({ duration: 3, durationTarget: 2 })).toBe(2_000_000);
    expect(fn({ duration: 0 })).toBe(1);
  });

  it("audioEnd 兜底:非 voice binding 端点超画面→取端点,无 +400ms 尾", async () => {
    const fn = await load();
    const sfx = await makeShotAudioBindingV2({ role: "sfx", shotId: "shot-sfx-1", durationUs: 2_500_000 });
    expect(fn({ duration: 2, shotAudioBindings: [sfx] })).toBe(2_500_000);
  });

  it("voice 尾:voice 端点 +400ms;多 binding 取最大端点", async () => {
    const fn = await load();
    const voice = await makeShotAudioBindingV2({ role: "voice", shotId: "shot-voice-1", durationUs: 3_500_000 });
    expect(fn({ duration: 2, shotAudioBindings: [voice] })).toBe(3_900_000);
    const short = await makeShotAudioBindingV2({ role: "sfx", shotId: "shot-sfx-2", durationUs: 1_000_000 });
    expect(fn({ duration: 2, shotAudioBindings: [voice, short] })).toBe(3_900_000);
  });

  it("与成片镜长等价:duration 1s + voice 1.5s@0 → 1_900_000(voice-tail 锁同值,AC3)", async () => {
    const fn = await load();
    const voice = await makeShotAudioBindingV2({ role: "voice", shotId: "shot-tail-1", durationUs: 1_500_000 });
    expect(fn({ duration: 1, shotAudioBindings: [voice] })).toBe(1_900_000);
  });
});
