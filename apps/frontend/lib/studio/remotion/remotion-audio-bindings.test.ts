import { describe, expect, it } from "vitest";
import type {
  RemotionChapterAudioBindingV2,
  RemotionChapterManifestV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import {
  createRemotionAudioBindingFingerprint,
  createRemotionChapterManifestFingerprint,
  validateRemotionAudioBindingFingerprint,
  validateRemotionChapterManifestFingerprint,
} from "./remotion-audio-fingerprint";
import {
  validateRemotionChapterManifestV2,
  validateRemotionShotAudioBindingV2,
} from "./remotion-manifest-validation";
import { makeWorkspaceManifest } from "./remotion-workspace-test-fixtures";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function media(relativePath: string, sha256 = SHA_A) {
  return {
    kind: "project-file" as const,
    projectId: "project-a",
    relativePath,
    contentSha256: sha256,
    provenance: {
      sourceKind: "generated" as const,
      sourceId: sha256,
      sourceVersion: "revision-1",
    },
  };
}

async function shotBinding(
  overrides: Partial<RemotionShotAudioBindingV2> = {},
): Promise<RemotionShotAudioBindingV2> {
  const binding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: "voice-shot-001",
    bindingFingerprint: SHA_B,
    renderScope: "shot",
    projectId: "project-a",
    chapterId: "chapter-001",
    shotId: "shot-001",
    shotRevision: 3,
    role: "voice",
    source: media("remotion/audio/chapter-001/shots/shot-001/voice/a.wav"),
    sourceFingerprint: SHA_A,
    sourceDurationUs: 1_600_000,
    sourceStartUs: 100_000,
    shotStartUs: 0,
    durationUs: 1_500_000,
    volume: 1,
    fadeInUs: 20_000,
    fadeOutUs: 40_000,
    envelope: [
      { timeUs: 0, gain: 1 },
      { timeUs: 1_500_000, gain: 0.9 },
    ],
    ttsInputFingerprint: SHA_B,
    ...overrides,
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  return binding;
}

async function chapterBinding(
  overrides: Partial<RemotionChapterAudioBindingV2> = {},
): Promise<RemotionChapterAudioBindingV2> {
  const binding: RemotionChapterAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: "bgm-chapter-001",
    bindingFingerprint: SHA_B,
    renderScope: "chapter",
    projectId: "project-a",
    chapterId: "chapter-001",
    role: "bgm",
    source: media("remotion/audio/chapter-001/shared/bgm/a.wav"),
    sourceFingerprint: SHA_A,
    sourceDurationUs: 8_000_000,
    sourceStartUs: 0,
    chapterStartUs: 250_000,
    durationUs: 7_000_000,
    volume: 0.25,
    fadeInUs: 500_000,
    fadeOutUs: 800_000,
    envelope: [{ timeUs: 0, gain: 1 }],
    ducking: {
      enabled: true,
      reductionDb: -12,
      attackUs: 120_000,
      releaseUs: 400_000,
    },
    ...overrides,
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  return binding;
}

async function manifest(): Promise<RemotionChapterManifestV2> {
  const voice = await shotBinding();
  const bgm = await chapterBinding();
  const value: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: SHA_B,
    projectId: "project-a",
    chapterId: "chapter-001",
    revision: 1,
    sourceSnapshotHash: SHA_A,
    requiredShotIds: ["shot-001"],
    sharedAudioBindings: [bgm],
    shots: [{
      shotId: "shot-001",
      storyboardId: "storyboard-001",
      index: 0,
      revision: 3,
      sourceFingerprint: SHA_A,
      durationUs: 2_000_000,
      visualSource: media("images/shot-001.png"),
      subtitleText: "第一镜",
      audioBindings: [voice],
      motion: { kind: "static" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    }],
    renderSettings: makeWorkspaceManifest().defaultRenderSettings,
    createdAt: 100,
    updatedAt: 100,
  };
  value.manifestFingerprint = await createRemotionChapterManifestFingerprint(value);
  return value;
}

describe("Remotion V2 audio binding contracts", () => {
  it("validates every render field and detects a stale canonical fingerprint", async () => {
    const binding = await shotBinding();
    expect(validateRemotionShotAudioBindingV2(binding, {
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      shotRevision: 3,
      shotDurationUs: 2_000_000,
    }).success).toBe(true);
    expect((await validateRemotionAudioBindingFingerprint(binding)).success).toBe(true);

    const stale = { ...binding, volume: 0.75 };
    expect((await validateRemotionAudioBindingFingerprint(stale)).success).toBe(false);
  });

  it("rejects missing voice input fingerprint, wrong roles, cross-scope paths and source SHA drift", async () => {
    const binding = await shotBinding();
    const missingTts = { ...binding } as Record<string, unknown>;
    delete missingTts.ttsInputFingerprint;
    expect(validateRemotionShotAudioBindingV2(missingTts, {
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      shotRevision: 3,
      shotDurationUs: 2_000_000,
    }).success).toBe(false);

    for (const drift of [
      { ...binding, role: "bgm" },
      { ...binding, chapterId: "chapter-002" },
      { ...binding, sourceFingerprint: SHA_B },
      { ...binding, source: media("remotion/audio/chapter-001/shared/voice/a.wav") },
    ]) {
      expect(validateRemotionShotAudioBindingV2(drift, {
        projectId: "project-a",
        chapterId: "chapter-001",
        shotId: "shot-001",
        shotRevision: 3,
        shotDurationUs: 2_000_000,
      }).success).toBe(false);
    }
  });

  it("accepts a canonical V2 manifest and rejects V1, duplicate shared tracks and cross-chapter shared audio", async () => {
    const value = await manifest();
    expect(validateRemotionChapterManifestV2(value).success).toBe(true);
    expect((await validateRemotionChapterManifestFingerprint(value)).success).toBe(true);

    const legacy = { ...value, schemaVersion: 1 };
    const legacyResult = validateRemotionChapterManifestV2(legacy);
    expect(legacyResult.success).toBe(false);
    expect(legacyResult.success ? [] : legacyResult.issues.map((issue) => issue.code))
      .toContain("schema_upgrade_required");

    const duplicate = { ...value, sharedAudioBindings: [value.sharedAudioBindings[0], value.sharedAudioBindings[0]] };
    expect(validateRemotionChapterManifestV2(duplicate).success).toBe(false);

    const crossChapterBinding = await chapterBinding({ chapterId: "chapter-002" });
    const crossChapter = { ...value, sharedAudioBindings: [crossChapterBinding] };
    expect(validateRemotionChapterManifestV2(crossChapter).success).toBe(false);
  });
});
