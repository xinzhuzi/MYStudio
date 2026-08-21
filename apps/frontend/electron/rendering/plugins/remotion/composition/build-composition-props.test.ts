import { describe, expect, it } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";
import {
  makeChapterAudioBindingV2,
  makeChapterManifestV2,
  makeCurrentSlot,
  makeShotAudioBindingV2,
} from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import type { RemotionChapterGateAcceptedV1 } from "@rendering/contracts/video-workflow";
import { createProjectFileUrl } from "@/electron/storage/storage-paths";
import { remotionCurrentSlotPaths } from "@/lib/studio/remotion/remotion-current-slot";
import {
  buildChapterVideoCompositionProps,
  buildCompositionProps,
  mapEditedVoiceIntervals,
  readableSubtitleCues,
  validateSubtitleAuthorityForTimeline,
} from "./build-composition-props";

const token = "a".repeat(64);
const mediaUrl = `http://127.0.0.1:43123/${token}/shot`;

describe("validateSubtitleAuthorityForTimeline", () => {
  it("blocks a visual interval whose authority is missing", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    delete plan.clips[0]!.source.evidence!.subtitleAuthority;

    const result = validateSubtitleAuthorityForTimeline(plan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.message).join(";")).toContain("字幕归属未知");
      expect(result.issues[0]?.path).toContain("visualIntervals[0].authority.mode");
    }
  });

  it("allows non-text HyperFrames effects for source-embedded footage", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips[0]!.source.evidence!.subtitleAuthority = {
      mode: "source-embedded",
      evidence: {
        mode: "source-embedded",
        decision: "human",
        sourceFingerprint: "a".repeat(64),
        evidencePaths: ["/tmp/source-embedded-review.json"],
        reviewedAt: 1,
      },
    };

    const decorative = validateSubtitleAuthorityForTimeline(plan, [{
      slotId: "effect-shot-001",
      cueId: "decorative-effect-1",
      startUs: 250_000,
      durationUs: 500_000,
      templateId: "highlight-box",
      parameters: { color: "#f4d06f" },
    }]);
    expect(decorative.success).toBe(true);

    const textOverlay = validateSubtitleAuthorityForTimeline(plan, [{
      slotId: "caption-shot-001",
      cueId: "caption-1",
      startUs: 250_000,
      durationUs: 500_000,
      templateId: "kinetic-caption",
      parameters: { text: "重复字幕" },
    }]);
    expect(textOverlay.success).toBe(false);
    if (!textOverlay.success) {
      expect(textOverlay.issues.map((issue) => issue.message).join(";")).toContain("HyperFrames overlay");
    }
  });
});

describe("buildChapterVideoCompositionProps", () => {
  it("accepts current Remotion shot MP4s, rejects EditingProject audio, and keeps baked shot audio audible", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.target).toBe("chapter");
      expect(result.value.visualClips[0]?.muted).toBe(false);
      expect(result.value.audioClips).toEqual([]);
    }

    // grade（成片调色）投影链：效果→clip.grade（lutId 闭集/URL 注入/hashInput 覆盖=
    // plan.effects 序列化进 chapter hash,remotion-chapter-renderer.ts:171）。
    plan.effects.push({
      id: "grade-1",
      effectId: "grade",
      targetClipId: "visual-shot-001",
      enabled: true,
      params: { lutId: "film-teal-orange", blend: 0.75 },
    } as never);
    const graded = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
      lutUrlById: { "film-teal-orange": `http://127.0.0.1:43123/${token}/lut.png` },
    });
    expect(graded.success).toBe(true);
    if (graded.success) {
      expect(graded.value.visualClips[0]?.grade).toEqual({
        lutId: "film-teal-orange",
        lutSrc: `http://127.0.0.1:43123/${token}/lut.png`,
        blend: 0.75,
      });
    }
    // 转场音效派生（08-18-sfx-beat）：sfxUrlById 提供时非 cut 转场各一声；
    // kind="sfx"、起点=转场窗起点；sfxUrlById 缺省时零派生（回退语义）。
    const secondSlot = slotForShot("shot-002");
    const sfxPlan = twoShotPlan(slot, secondSlot);
    const sfxVoice = await makeShotAudioBindingV2({ shotId: "shot-002", shotStartUs: 500_000, durationUs: 500_000 });
    const sfxManifest = await manifestForTwoShotPlan(sfxPlan, sfxVoice);
    const withSfx = buildChapterVideoCompositionProps({
      plan: sfxPlan,
      currentShotSlots: [slot, secondSlot],
      chapterManifest: sfxManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "visual-shot-002": mediaUrl },
      mediaUrlByBindingId: {},
      sfxUrlById: { "sfx-soft": `http://127.0.0.1:43123/${token}/sfx.ogg` },
      transitionSfxEnabled: true,
    });
    expect(withSfx.success).toBe(true);
    if (withSfx.success) {
      const sfxClips = withSfx.value.audioClips.filter((c) => c.kind === "sfx");
      expect(sfxClips).toHaveLength(1);
      expect(sfxClips[0]!.clipId).toBe("sfx-transition-0");
      expect(sfxClips[0]!.volume).toBe(1);
    }
    const withoutSfx = buildChapterVideoCompositionProps({
      plan: sfxPlan,
      currentShotSlots: [slot, secondSlot],
      chapterManifest: sfxManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "visual-shot-002": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(withoutSfx.success).toBe(true);
    if (withoutSfx.success) {
      expect(withoutSfx.value.audioClips.filter((c) => c.kind === "sfx")).toHaveLength(0);
    }

    // lutId 越闭集 → fail-closed throw。
    plan.effects[0]!.params = { lutId: "film-not-exist", blend: 0.5 } as never;
    expect(() => buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
      lutUrlById: { "film-not-exist": mediaUrl },
    })).toThrow("LUT 闭集");

    plan.clips.push(audioPlanClip("voice-1", "voice"));
    const duplicate = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) expect(duplicate.issues.map((issue) => issue.message).join(";")).toContain("EditingProject");
  });

  it("rejects legacy candidate visuals", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "videoCandidate");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("Remotion shot MP4");
  });

  it("accepts a byte-tracked video-use derived input only with the matching gate", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const artifactSha256 = "c".repeat(64);
    const derivedPath = "/tmp/video-use-derived-shot-001.mp4";
    plan.clips[0]!.source.path = derivedPath;
    plan.clips[0]!.source.evidence.sourceFingerprint = artifactSha256;
    const target = slot.target;
    if (target.kind !== "shot") throw new Error("fixture target must be shot");
    const gate: RemotionChapterGateAcceptedV1 = {
      accepted: true,
      mode: "editable-edl",
      videoUseArtifactSha256: artifactSha256,
      hyperFramesStatus: "noop",
      videoUseDerivedInputs: [{
        schemaVersion: 1,
        kind: "padded-video",
        derivation: "ffmpeg-tpad-clone-apad",
        sourcePath: "/tmp/original-shot-001.mp4",
        sourceSha256: "d".repeat(64),
        sourceDurationUs: 1_000_000,
        derivedPath,
        derivedSha256: "e".repeat(64),
        derivedDurationUs: 1_000_000,
        derivedRevision: target.shotRevision,
        createdAt: 2,
      }],
    };
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      videoWorkflowGate: gate,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts an absolute projected shot path when the host supplies the slot identity", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const absoluteSlotPath = "/private/var/folders/test/remotion/outputs/shots/shot-001/current.mp4";
    plan.clips[0]!.source.path = "/var/folders/test/remotion/outputs/shots/shot-001/current.mp4";
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      currentShotSlotPaths: { "shot-001": absoluteSlotPath },
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts a same-project project-file URL projected from the current shot slot", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips[0]!.source.path = createProjectFileUrl(slot.projectId, slot.outputPath);
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects a project-file URL from another project before media registration", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips[0]!.source.path = createProjectFileUrl("other-project", slot.outputPath);
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("路径与 current shot slot");
  });

  it("projects an accepted HyperFrames overlay into the ChapterVideo composition", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "hyperframes-overlay": mediaUrl },
      mediaUrlByBindingId: {},
      hyperFramesOverlay: {
        src: mediaUrl,
        windows: [{
          slotId: "shot-001",
          cueId: "overlay-cue-1",
          startUs: 250_000,
          durationUs: 500_000,
          templateId: "kinetic-caption",
          parameters: { text: "字幕" },
        }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.overlayClips).toEqual([{
        clipId: "hyperframes-overlay",
        src: mediaUrl,
        from: 0,
        durationInFrames: 23,
      }]);
    }
  });

  it("consumes a decorative HyperFrames overlay without creating a second subtitle track", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips[0]!.source.evidence!.subtitleAuthority = {
      mode: "source-embedded",
      evidence: {
        mode: "source-embedded",
        decision: "human",
        sourceFingerprint: "a".repeat(64),
        evidencePaths: ["/tmp/source-embedded-review.json"],
        reviewedAt: 1,
      },
    };
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "hyperframes-overlay": mediaUrl },
      mediaUrlByBindingId: {},
      hyperFramesOverlay: {
        src: mediaUrl,
        windows: [{
          slotId: "effect-shot-001",
          cueId: "decorative-effect-1",
          startUs: 250_000,
          durationUs: 500_000,
          templateId: "highlight-box",
          parameters: { color: "#f4d06f" },
        }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.subtitles).toEqual([]);
      expect(result.value.overlayClips).toHaveLength(1);
    }
  });

  it("derives subtitle-driven sfx clips when subtitleSfxEnabled (每镜≤1条, cue 帧偏移, 音量克制)", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.renderSettings.subtitleSfxEnabled = true;
    const textCue = (id: string, startUs: number) => ({
      id,
      trackId: "subtitles",
      trackKind: "text" as const,
      source: { kind: "text" as const, text: "雷声炸响", evidence: { storyboardId: "shot-001", sourceFingerprint: "c".repeat(64) } },
      startUs,
      durationUs: 500_000,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
      subtitle: { sourceFormat: "generated" as const },
    });
    plan.clips.push(textCue("cue-1", 250_000), textCue("cue-2", 900_000));
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
      sfxUrlById: { boom: `http://127.0.0.1:43123/${token}/boom.ogg` },
      sfxCategoryByStoryboardId: { "shot-001": "explosion" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const sfxClips = result.value.audioClips.filter((clip) => clip.kind === "sfx");
      // 同镜两条 cue 只派生第一条（每镜最多 1 条）
      expect(sfxClips).toHaveLength(1);
      expect(sfxClips[0]).toMatchObject({
        clipId: "sfx-subtitle-cue-1",
        volume: 0.4,
        durationInFrames: 15,
      });
      // from = cue 帧(250ms@30fps=8) + 2 帧起振，无转场零压缩偏移
      expect(sfxClips[0]!.from).toBe(10);
    }
    // 开关关闭（缺省）→ 类别表与资产齐全也零派生
    plan.renderSettings.subtitleSfxEnabled = undefined;
    const disabled = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
      sfxUrlById: { boom: `http://127.0.0.1:43123/${token}/boom.ogg` },
      sfxCategoryByStoryboardId: { "shot-001": "explosion" },
    });
    expect(disabled.success).toBe(true);
    if (disabled.success) {
      expect(disabled.value.audioClips.filter((clip) => clip.kind === "sfx")).toHaveLength(0);
    }
    // 无资产类别（雨声 rain）→ 分类在表但派生跳过
    plan.renderSettings.subtitleSfxEnabled = true;
    const noAsset = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
      sfxUrlById: { boom: `http://127.0.0.1:43123/${token}/boom.ogg` },
      sfxCategoryByStoryboardId: { "shot-001": "rain" },
    });
    expect(noAsset.success).toBe(true);
    if (noAsset.success) {
      expect(noAsset.value.audioClips.filter((clip) => clip.kind === "sfx")).toHaveLength(0);
    }
  });

  it("burns the canonical Remotion subtitle track only when subtitleMode is enabled", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips.push({
      id: "video-use-subtitle-1-cue-1",
      trackId: "subtitles",
      trackKind: "text",
      source: { kind: "text", text: "对齐后的字幕", evidence: { storyboardId: "shot-001", sourceFingerprint: "c".repeat(64) } },
      startUs: 250_000,
      durationUs: 500_000,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
      subtitle: { sourceFormat: "generated" },
    });
    const chapterManifest = await manifestForPlan(plan);
    const enabled = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(enabled.success).toBe(true);
    if (enabled.success) {
      expect(enabled.value.subtitles).toEqual([
        expect.objectContaining({ cueId: "video-use-subtitle-1-cue-1", text: "对齐后的字幕" }),
      ]);
      // 缺省字体回落注册表默认（毛笔楷书），显式设置原样透传。
      expect(enabled.value.subtitleFont).toBe("liu-jian-mao-cao");
      plan.renderSettings.subtitleFont = "noto-serif-sc";
      const serif = buildChapterVideoCompositionProps({
        plan,
        currentShotSlots: [slot],
        chapterManifest,
        mediaUrlByClipId: { "visual-shot-001": mediaUrl },
        mediaUrlByBindingId: {},
      });
      expect(serif.success).toBe(true);
      if (serif.success) expect(serif.value.subtitleFont).toBe("noto-serif-sc");
    }

    plan.renderSettings.subtitleMode = "none";
    const disabled = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(disabled.success).toBe(true);
    if (disabled.success) expect(disabled.value.subtitles).toEqual([]);
  });

  it("requires exact manifest, plan and shot-slot identities", async () => {
    const slot = makeCurrentSlot();
    const extraSlot = slotForShot("shot-002");
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const chapterManifest = await manifestForPlan(plan);
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot, extraSlot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("额外 shot");

    plan.clips[0]!.source.evidence.outputVersion = 2;
    const revisionResult = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(revisionResult.success).toBe(false);
    if (!revisionResult.success) expect(revisionResult.issues.map((issue) => issue.message).join(";")).toContain("revision");
  });

  it("accepts a flat clean MP4 projection without requiring every storyboard slot", async () => {
    const firstSlot = makeCurrentSlot();
    const plan = chapterPlan(firstSlot, "shot-001", "storyboardVideo");
    const flatPath = "/tmp/video-use-clean-flat.mp4";
    const artifactSha256 = "f".repeat(64);
    plan.clips[0]!.source.path = flatPath;
    plan.clips[0]!.source.evidence = {
      sourceFingerprint: artifactSha256,
      subtitleAuthority: {
        mode: "clean-remotion",
        evidence: {
          mode: "clean-remotion",
          decision: "imported-manifest",
          sourceFingerprint: artifactSha256,
          evidencePaths: ["/tmp/subtitle-evidence.json"],
        },
      },
    };
    const chapterManifest = await manifestForPlan(plan);
    const gate: RemotionChapterGateAcceptedV1 = {
      accepted: true,
      mode: "flat-shot-mp4",
      videoUseArtifactSha256: artifactSha256,
      videoUseFlatShotMp4Path: flatPath,
      videoUseFlatShotMp4Sha256: "e".repeat(64),
      hyperFramesStatus: "noop",
    };
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [firstSlot, slotForShot("shot-002")],
      chapterManifest,
      videoWorkflowGate: gate,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
    expect(mapEditedVoiceIntervals({
      plan,
      currentShotSlots: [firstSlot, slotForShot("shot-002")],
      chapterManifest,
    })).toEqual({ success: true, value: [] });
  });

  it("projects manifest BGM range, trim, fades, user envelope and per-track ducking", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const voice = await makeShotAudioBindingV2({
      shotId: "shot-001",
      shotStartUs: 500_000,
      durationUs: 500_000,
    });
    const bgm = await makeChapterAudioBindingV2({
      bindingId: "chapter-bgm",
      sourceStartUs: 500_000,
      sourceDurationUs: 3_000_000,
      chapterStartUs: 0,
      durationUs: 2_000_000,
      fadeInUs: 200_000,
      fadeOutUs: 300_000,
      envelope: [{ timeUs: 0, gain: 0.8 }, { timeUs: 2_000_000, gain: 0.4 }],
      ducking: { enabled: true, reductionDb: -12, attackUs: 100_000, releaseUs: 200_000 },
    });
    const ambience = await makeChapterAudioBindingV2({
      bindingId: "chapter-ambience",
      role: "ambience",
      sourceDurationUs: 2_000_000,
      durationUs: 2_000_000,
      chapterStartUs: 0,
      ducking: { enabled: false, reductionDb: -18, attackUs: 50_000, releaseUs: 50_000 },
    });
    const chapterManifest = await manifestForPlan(plan, { voice, sharedAudioBindings: [bgm, ambience] });
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: { "chapter-bgm": mediaUrl, "chapter-ambience": mediaUrl },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.audioClips).toHaveLength(2);
    const clip = result.value.audioClips.find((audio) => audio.clipId === "chapter-bgm")!;
    expect(clip).toMatchObject({
      clipId: "chapter-bgm",
      kind: "bgm",
      renderScope: "chapter",
      from: 0,
      durationInFrames: 60,
      trimStartFrames: 15,
      volume: 0.25,
      fade: { fadeInFrames: 6, fadeOutFrames: 9 },
      envelope: [{ frame: 0, gain: 0.8 }, { frame: 60, gain: 0.4 }],
    });
    const holdGain = 10 ** (-12 / 20);
    expect(clip.duckingEnvelope).toEqual(expect.arrayContaining([
      { frame: 12, gain: 1 },
      { frame: 15, gain: holdGain },
      { frame: 30, gain: holdGain },
      { frame: 36, gain: 1 },
    ]));
    expect(result.value.audioClips.find((audio) => audio.clipId === "chapter-ambience")?.duckingEnvelope)
      .toEqual([{ frame: 0, gain: 1 }, { frame: 60, gain: 1 }]);
  });

  it("clips a shared track that outlives a one-shot chapter at the composition boundary", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.clips[0]!.durationUs = 1_000_000;
    const bgm = await makeChapterAudioBindingV2({
      bindingId: "chapter-bgm-long",
      chapterStartUs: 0,
      durationUs: 2_000_000,
      fadeInUs: 0,
      fadeOutUs: 300_000,
      envelope: [{ timeUs: 0, gain: 0.8 }, { timeUs: 2_000_000, gain: 0.4 }],
    });
    const chapterManifest = await manifestForPlan(plan, { sharedAudioBindings: [bgm] });
    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl },
      mediaUrlByBindingId: { "chapter-bgm-long": mediaUrl },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.durationInFrames).toBe(30);
    expect(result.value.audioClips[0]).toMatchObject({
      durationInFrames: 30,
      fade: { fadeInFrames: 0, fadeOutFrames: 9 },
      envelope: [{ frame: 0, gain: 0.8 }, { frame: 30, gain: 0.8 }],
    });
  });

  it("maps voice through edited trim, speed and transition layout, then merges overlaps", async () => {
    const firstSlot = makeCurrentSlot();
    const secondSlot = slotForShot("shot-002");
    const plan = twoShotPlan(firstSlot, secondSlot);
    const voice = await makeShotAudioBindingV2({
      shotId: "shot-002",
      shotStartUs: 500_000,
      durationUs: 500_000,
    });
    const chapterManifest = await manifestForTwoShotPlan(plan, voice);

    expect(mapEditedVoiceIntervals({ plan, currentShotSlots: [firstSlot, secondSlot], chapterManifest })).toEqual({
      success: true,
      // 7508a43 转场调优: 时长上限 800ms→1.2s → 重叠加大, 语音区间起点前移 41→39。
      value: [{ startFrame: 39, endFrame: 54 }],
    });
  });

  it("fail-closes when a transition overlap intrudes into the outgoing shot's voice", async () => {
    const firstSlot = makeCurrentSlot();
    const secondSlot = slotForShot("shot-002");
    const plan = twoShotPlan(firstSlot, secondSlot);
    // shot-001 时长 1s、转场 200ms → 下一镜提前到第 24 帧；语音到第 30 帧才结束。
    const voice = await makeShotAudioBindingV2({
      shotId: "shot-001",
      shotStartUs: 900_000,
      durationUs: 500_000,
    });
    const chapterManifest = await manifestForPlan(plan);
    chapterManifest.requiredShotIds = ["shot-001", "shot-002"];
    chapterManifest.shots = [
      { ...chapterManifest.shots[0]!, audioBindings: [voice] },
      { ...chapterManifest.shots[0]!, shotId: "shot-002", storyboardId: "shot-002", index: 1, audioBindings: [] },
    ];

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [firstSlot, secondSlot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "visual-shot-002": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.message).join(";")).toContain("静默尾");
    }
  });

  it("uses sentence-aligned text end instead of WAV tail silence", async () => {
    const firstSlot = makeCurrentSlot();
    const secondSlot = slotForShot("shot-002");
    const plan = twoShotPlan(firstSlot, secondSlot);
    const voice = await makeShotAudioBindingV2({ shotId: "shot-001", shotStartUs: 0, durationUs: 1_000_000 });
    plan.clips.push(textPlanClip("aligned-voice-1", "shot-001", 0, 700_000));
    const chapterManifest = await manifestForPlan(plan);
    chapterManifest.requiredShotIds = ["shot-001", "shot-002"];
    chapterManifest.shots = [
      { ...chapterManifest.shots[0]!, audioBindings: [voice] },
      { ...chapterManifest.shots[0]!, shotId: "shot-002", storyboardId: "shot-002", index: 1, audioBindings: [] },
    ];

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [firstSlot, secondSlot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "visual-shot-002": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
  });

  it("still rejects when an aligned text clip overlaps the transition", async () => {
    const firstSlot = makeCurrentSlot();
    const secondSlot = slotForShot("shot-002");
    const plan = twoShotPlan(firstSlot, secondSlot);
    const voice = await makeShotAudioBindingV2({ shotId: "shot-001", shotStartUs: 0, durationUs: 1_000_000 });
    plan.clips.push(textPlanClip("aligned-voice-1", "shot-001", 0, 900_000));
    const chapterManifest = await manifestForPlan(plan);
    chapterManifest.requiredShotIds = ["shot-001", "shot-002"];
    chapterManifest.shots = [
      { ...chapterManifest.shots[0]!, audioBindings: [voice] },
      { ...chapterManifest.shots[0]!, shotId: "shot-002", storyboardId: "shot-002", index: 1, audioBindings: [] },
    ];

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [firstSlot, secondSlot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "visual-shot-002": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.message).join(";")).toContain("静默尾");
  });

  it("allows a transition that only consumes the outgoing shot's silent tail (J-cut)", async () => {
    const firstSlot = makeCurrentSlot();
    const secondSlot = slotForShot("shot-002");
    const plan = twoShotPlan(firstSlot, secondSlot);
    // 语音 0.7s 结束、转场 200ms：重叠只吃静默尾，属于合法 J-cut。
    const voice = await makeShotAudioBindingV2({
      shotId: "shot-001",
      shotStartUs: 0,
      durationUs: 700_000,
    });
    const chapterManifest = await manifestForPlan(plan);
    chapterManifest.requiredShotIds = ["shot-001", "shot-002"];
    chapterManifest.shots = [
      { ...chapterManifest.shots[0]!, audioBindings: [voice] },
      { ...chapterManifest.shots[0]!, shotId: "shot-002", storyboardId: "shot-002", index: 1, audioBindings: [] },
    ];

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [firstSlot, secondSlot],
      chapterManifest,
      mediaUrlByClipId: { "visual-shot-001": mediaUrl, "visual-shot-002": mediaUrl },
      mediaUrlByBindingId: {},
    });
    expect(result.success).toBe(true);
  });

  it("maps plan.effects fx entries onto the visual clip fx prop (contract front door)", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const clipId = plan.clips[0]!.id;
    plan.clips[0]!.startUs = 0;
    plan.clips[0]!.durationUs = 1_000_000;
    plan.effects = [
      {
        id: "effect-shot-fx-shake",
        effectId: "shake",
        targetClipId: clipId,
        startUs: 0,
        durationUs: 1_000_000,
        params: { intensity: 0.25 },
        enabled: true,
      },
      {
        id: "effect-shot-fx-glow",
        effectId: "glow",
        targetClipId: clipId,
        startUs: 0,
        durationUs: 1_000_000,
        params: { intensity: 0.5 },
        enabled: true,
      },
      {
        id: "effect-shot-fx-grain",
        effectId: "grain",
        targetClipId: clipId,
        startUs: 0,
        durationUs: 1_000_000,
        params: { amount: 0.035 },
        enabled: true,
      },
      {
        id: "effect-shot-fx-chroma",
        effectId: "chromaticAberration",
        targetClipId: clipId,
        startUs: 0,
        durationUs: 1_000_000,
        params: { offset: 3 },
        enabled: true,
      },
      {
        id: "effect-shot-fx-disabled-glow",
        effectId: "glow",
        targetClipId: clipId,
        startUs: 0,
        durationUs: 1_000_000,
        params: { intensity: 0.9 },
        enabled: false,
      },
    ];
    const chapterManifest = await manifestForPlan(plan);

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { [clipId]: mediaUrl },
      mediaUrlByBindingId: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // registry → 合成层换算：shake intensity 0.25 → amplitudePx 6；其余数值域直传。
      expect(result.value.visualClips[0]?.fx).toEqual({
        shake: { amplitudePx: 6 },
        glow: { intensity: 0.5 },
        grain: { opacity: 0.035 },
        chroma: { offsetPx: 3 },
      });
    }
  });

  it("panZoom 效果带 easing=spring 时透传，非法值回退缺省 cubic（08-21 spring 接入）", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const clipId = plan.clips[0]!.id;
    plan.effects = [{
      id: "effect-shot-panzoom-spring",
      effectId: "panZoom",
      targetClipId: clipId,
      startUs: 0,
      durationUs: 2_000_000,
      params: { scaleFrom: 1, scaleTo: 1.12, x: 0.5, y: 0.5, easing: "spring" },
      enabled: true,
    }];
    const chapterManifest = await manifestForPlan(plan);

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { [clipId]: mediaUrl },
      mediaUrlByBindingId: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.visualClips[0]?.panZoom)
        .toMatchObject({ fromScale: 1, toScale: 1.12, easing: "spring" });
    }
  });

  it("panZoom 效果 easing 非法/缺省时不透传——出片默认曲线不变", async () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    const clipId = plan.clips[0]!.id;
    plan.effects = [{
      id: "effect-shot-panzoom-bad-easing",
      effectId: "panZoom",
      targetClipId: clipId,
      startUs: 0,
      durationUs: 2_000_000,
      params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5, easing: "bounce" },
      enabled: true,
    }];
    const chapterManifest = await manifestForPlan(plan);

    const result = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: [slot],
      chapterManifest,
      mediaUrlByClipId: { [clipId]: mediaUrl },
      mediaUrlByBindingId: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.visualClips[0]?.panZoom?.easing).toBeUndefined();
    }
  });
});

describe("readableSubtitleCues", () => {
  it("extends a rapid cue to the minimum readable duration", () => {
    const [cue] = readableSubtitleCues(
      [{ cueId: "cue-1", text: "找死！", from: 100, audioSpanFrames: 10 }],
      300,
      30,
    );
    // max(0.9s, 3字/4.5字每秒) = 0.9s = 27 帧
    expect(cue).toMatchObject({ cueId: "cue-1", from: 100, durationInFrames: 27 });
  });

  it("never extends a cue past the next cue's start or the composition end", () => {
    const cues = readableSubtitleCues([
      { cueId: "cue-1", text: "站出来！", from: 100, audioSpanFrames: 12 },
      { cueId: "cue-2", text: "下一句", from: 115, audioSpanFrames: 30 },
    ], 150, 30);
    expect(cues[0]).toMatchObject({ durationInFrames: 14 });
    expect(cues[1]).toMatchObject({ durationInFrames: 30 });
  });

  it("keeps the audio span when it already exceeds the readable minimum", () => {
    const [cue] = readableSubtitleCues(
      [{ cueId: "cue-1", text: "五个字", from: 0, audioSpanFrames: 90 }],
      300,
      30,
    );
    expect(cue).toMatchObject({ durationInFrames: 90 });
  });
});

async function manifestForPlan(
  plan: TimelineRenderPlan,
  options: {
    voice?: Awaited<ReturnType<typeof makeShotAudioBindingV2>>;
    sharedAudioBindings?: RemotionChapterManifestV2["sharedAudioBindings"];
  } = {},
): Promise<RemotionChapterManifestV2> {
  const manifest = await makeChapterManifestV2();
  return {
    ...manifest,
    projectId: plan.projectId,
    chapterId: plan.episodeId,
    sourceSnapshotHash: plan.sourceSnapshotHash,
    requiredShotIds: ["shot-001"],
    sharedAudioBindings: options.sharedAudioBindings ?? [],
    shots: [{
      ...manifest.shots[0]!,
      shotId: "shot-001",
      storyboardId: "shot-001",
      audioBindings: options.voice ? [options.voice] : [],
    }],
  };
}

async function manifestForTwoShotPlan(
  plan: TimelineRenderPlan,
  voice: Awaited<ReturnType<typeof makeShotAudioBindingV2>>,
): Promise<RemotionChapterManifestV2> {
  const manifest = await manifestForPlan(plan);
  return {
    ...manifest,
    requiredShotIds: ["shot-001", "shot-002"],
    shots: [
      { ...manifest.shots[0]!, audioBindings: [] },
      {
        ...manifest.shots[0]!,
        shotId: "shot-002",
        storyboardId: "shot-002",
        index: 1,
        audioBindings: [voice],
      },
    ],
  };
}

function audioPlanClip(
  id: string,
  trackKind: "voice" | "bgm" | "sfx",
): TimelineRenderPlan["clips"][number] {
  return {
    id,
    trackId: trackKind,
    trackKind,
    source: { kind: "audio", path: `/tmp/${id}.wav`, evidence: {} },
    startUs: 0,
    durationUs: 1_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
}

function textPlanClip(id: string, storyboardId: string, startUs: number, durationUs: number): TimelineRenderPlan["clips"][number] {
  return {
    id,
    trackId: "subtitles",
    trackKind: "text",
    source: { kind: "text", text: "aligned", evidence: { storyboardId } },
    startUs,
    durationUs,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
    subtitle: { sourceFormat: "generated" },
  };
}

function twoShotPlan(
  firstSlot: ReturnType<typeof makeCurrentSlot>,
  secondSlot: ReturnType<typeof slotForShot>,
): TimelineRenderPlan {
  const plan = chapterPlan(firstSlot, "shot-001", "storyboardVideo");
  plan.clips[0]!.durationUs = 1_000_000;
  const secondTarget = secondSlot.target;
  if (secondTarget.kind !== "shot") throw new Error("fixture target must be shot");
  plan.clips.push({
    ...plan.clips[0]!,
    id: "visual-shot-002",
    source: {
      kind: "storyboardVideo",
      path: secondSlot.outputPath,
      evidence: {
        storyboardId: "shot-002",
        subtitleAuthority: plan.clips[0]!.source.evidence!.subtitleAuthority,
        remotionJobId: secondSlot.job.jobId,
        remotionEvidenceSha256: secondSlot.evidence.sha256,
        outputVersion: secondTarget.shotRevision,
      },
    },
    startUs: 1_000_000,
  });
  plan.transitions = [{
    id: "transition-1-2",
    fromClipId: "visual-shot-001",
    toClipId: "visual-shot-002",
    effectId: "fade",
    durationUs: 200_000,
    params: {},
  }];
  return plan;
}

function chapterPlan(
  slot: ReturnType<typeof makeCurrentSlot>,
  storyboardId: string,
  sourceKind: "storyboardVideo" | "videoCandidate",
): TimelineRenderPlan {
  const target = slot.target;
  if (target.kind !== "shot") throw new Error("fixture target must be shot");
  return {
    schemaVersion: 1,
    jobId: "chapter-job",
    projectId: slot.projectId,
    episodeId: target.chapterId,
    editingProjectId: "editing-001",
    editingRevision: 1,
    sourceSnapshotHash: "b".repeat(64),
    editingProjectSnapshot: {} as TimelineRenderPlan["editingProjectSnapshot"],
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
      audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
    },
    clips: [{
      id: `visual-${storyboardId}`,
      trackId: "visual",
      trackKind: "video",
      source: {
        kind: sourceKind,
        path: slot.outputPath,
        evidence: {
          storyboardId,
          subtitleAuthority: {
            mode: "clean-remotion",
            evidence: {
              mode: "clean-remotion",
              decision: "imported-manifest",
              sourceFingerprint: "a".repeat(64),
              evidencePaths: ["/tmp/subtitle-evidence.json"],
            },
          },
          remotionJobId: slot.job.jobId,
          remotionEvidenceSha256: slot.evidence.sha256,
          outputVersion: target.shotRevision,
        },
      },
      startUs: 0,
      durationUs: 2_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 0,
      muted: true,
    }],
    transitions: [],
    effects: [],
    createdAt: 1,
  };
}

function slotForShot(shotId: string) {
  const base = makeCurrentSlot();
  if (base.target.kind !== "shot") throw new Error("fixture target must be shot");
  const target = { ...base.target, shotId };
  const paths = remotionCurrentSlotPaths(target);
  const job = {
    ...base.job,
    jobId: `shot:${"f".repeat(64)}`,
    target,
    outputPath: paths.outputPath,
    evidencePath: paths.evidencePath,
  };
  return {
    ...base,
    target,
    job,
    evidence: {
      ...base.evidence,
      jobId: job.jobId,
      target,
      outputPath: paths.outputPath,
    },
    ...paths,
  };
}

describe("layerStackFromLegacyTuple(08-19 multilayer Child1)", () => {
  it("旧二元组→layerStack:背景 damp=1-0.4·parallax(与旧 bgDamp 逐值一致),主体 damp=1", async () => {
    const { layerStackFromLegacyTuple } = await import("./build-composition-props");
    const parallax = 0.6;
    const stack = layerStackFromLegacyTuple({
      backgroundSrc: "http://127.0.0.1:1/" + "a".repeat(64) + "/bg.png",
      subjectSrc: "http://127.0.0.1:1/" + "a".repeat(64) + "/subj.png",
      parallax,
    });
    expect(stack).toHaveLength(2);
    expect(stack[0]).toMatchObject({ role: "background" });
    expect(stack[0]!.panZoomDamp).toBeCloseTo(1 - 0.4 * parallax, 10);
    expect(stack[1]).toMatchObject({ role: "subject", panZoomDamp: 1 });
  });

  it("parallax 缺省 0.5→damp 0.8(旧默认视差折减);越界钳制 0..1", async () => {
    const { layerStackFromLegacyTuple } = await import("./build-composition-props");
    const token = "b".repeat(64);
    const stack = layerStackFromLegacyTuple({
      backgroundSrc: `http://127.0.0.1:1/${token}/bg.png`,
      subjectSrc: `http://127.0.0.1:1/${token}/subj.png`,
    });
    expect(stack[0]!.panZoomDamp).toBeCloseTo(0.8, 10);
    const clamped = layerStackFromLegacyTuple({
      backgroundSrc: `http://127.0.0.1:1/${token}/bg.png`,
      subjectSrc: `http://127.0.0.1:1/${token}/subj.png`,
      parallax: 5,
    });
    expect(clamped[0]!.panZoomDamp).toBeCloseTo(0.6, 10);
  });
});


describe("atmosphere 效果投影进 layerStack(08-19 multilayer Child2)", () => {
  const atmosEffect = (template: string, intensity: number) => ({
    id: `fx-atmo-${template}`,
    effectId: "atmosphere" as const,
    targetClipId: "visual-shot-001",
    startUs: 0,
    durationUs: 1_000_000,
    params: { template, intensity },
    enabled: true,
  });

  it("atmosphere 效果→模板层(参数经 scaledTemplateParams 归一),首层 blend screen", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.effects.push(atmosEffect("atmo:fog-band", 2));
    const props = buildCompositionProps(plan, { "visual-shot-001": mediaUrl });
    const clip = props.visualClips[0]!;
    expect(clip.layerStack).toBeDefined();
    expect(clip.layerStack!).toHaveLength(1);
    const layer = clip.layerStack![0]!;
    expect(layer.role).toBe("atmosphere");
    expect(layer.template!.id).toBe("atmo:fog-band");
    expect(layer.template!.params!.opacity).toBeCloseTo(0.4, 5); // 0.2 缺省 × intensity 2
    expect(layer.blendMode).toBe("screen");
  });

  it("未知模板 fail-closed throw(不静默丢层)", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.effects.push(atmosEffect("atmo:bogus", 1));
    expect(() => buildCompositionProps(plan, { "visual-shot-001": mediaUrl }))
      .toThrow("atmosphere 效果的模板不在闭集");
  });
});

describe("氛围-only 栈垫底渲染(08-20 修:视频镜不丢本体)", () => {
  it("视频 clip 带 atmosphere 效果 → layerStack 只有氛围层(垫底媒体由渲染端渲染)", () => {
    const slot = makeCurrentSlot();
    const plan = chapterPlan(slot, "shot-001", "storyboardVideo");
    plan.effects.push({
      id: "fx-atmo-v",
      effectId: "atmosphere",
      targetClipId: "visual-shot-001",
      startUs: 0,
      durationUs: 1_000_000,
      params: { template: "atmo:light-dust", intensity: 1 },
      enabled: true,
    });
    const props = buildCompositionProps(plan, { "visual-shot-001": mediaUrl });
    const clip = props.visualClips[0]!;
    expect(clip.kind).toBe("video");
    expect(clip.layerStack).toBeDefined();
    expect(clip.layerStack!.every((layer) => layer.role === "atmosphere" && !layer.src)).toBe(true);
    // src 保留(垫底媒体位),不会被 layerStack 覆盖掉语义
    expect(clip.src).toBe(mediaUrl);
  });
});
