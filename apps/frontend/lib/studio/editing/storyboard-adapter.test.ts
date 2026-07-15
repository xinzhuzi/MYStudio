import { describe, expect, it } from "vitest";
import type {
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import { validateEditingProject } from "./validation";
import {
  buildStoryboardEditingProject,
  migrateLegacySimpleTimeline,
} from "./storyboard-adapter";

describe("storyboard editing adapter", () => {
  it("uses the selected ready candidate first and segments grouped tracks", () => {
    const storyboards = [
      storyboard(1, {
        mediaRef: { kind: "video", path: "/shot-1.mp4" },
      }),
      storyboard(2),
    ];
    const result = buildStoryboardEditingProject({
      ...baseInput(storyboards),
      productionTracks: [track(storyboards, "candidate-1")],
      videoCandidates: [candidate("candidate-1")],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const visualClips = result.project.clips.filter(
      (clip) => clip.trackId === "editing-1-main-visual",
    );
    expect(visualClips).toHaveLength(2);
    expect(visualClips.map((clip) => clip.source.kind)).toEqual([
      "videoCandidate",
      "videoCandidate",
    ]);
    expect(visualClips.map((clip) => clip.trimStartUs)).toEqual([
      0,
      4_000_000,
    ]);
    expect(visualClips.every((clip) => clip.muted && clip.volume === 0)).toBe(
      true,
    );

    const staleResult = buildStoryboardEditingProject({
      ...baseInput(storyboards),
      productionTracks: [track(storyboards, "candidate-1")],
      videoCandidates: [{ ...candidate("candidate-1"), stale: true }],
    });
    expect(staleResult.success).toBe(true);
    if (!staleResult.success) return;
    expect(
      staleResult.project.clips
        .filter((clip) => clip.trackId === "editing-1-main-visual")
        .map((clip) => clip.source.kind),
    ).toEqual(["storyboardVideo", "storyboardImage"]);
  });

  it("expands for long voice, preserves director timing and maps subtitle priority", () => {
    const storyboards = [
      storyboard(1, {
        ttsSpokenText: "首选口播",
        line: "备用台词",
        lines: "备用多行",
        audioRef: { kind: "audio", path: "/voice-1.wav" },
        sound: "approved-hit",
      }),
      storyboard(2, {
        ttsSpokenText: " ",
        line: "第二句",
        audioRef: { kind: "audio", path: "/voice-2.wav" },
      }),
      storyboard(3, {
        ttsSpokenText: undefined,
        line: undefined,
        lines: undefined,
        audioRef: undefined,
      }),
    ];
    const result = buildStoryboardEditingProject({
      ...baseInput(storyboards),
      voiceDurationsUs: {
        "sb-1": 5_000_000,
        "sb-2": 2_000_000,
      },
      directorPlan: directorPlan(),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const visualClips = result.project.clips.filter(
      (clip) => clip.trackId === "editing-1-main-visual",
    );
    expect(visualClips.map((clip) => clip.durationUs)).toEqual([
      5_200_000,
      4_000_000,
      4_000_000,
    ]);
    expect(visualClips.map((clip) => clip.startUs)).toEqual([
      0,
      5_200_000,
      9_200_000,
    ]);
    const subtitles = result.project.clips.filter(
      (clip) => clip.trackId === "editing-1-subtitles",
    );
    expect(subtitles.map((clip) => clip.source.text)).toEqual([
      "首选口播",
      "第二句",
    ]);
    expect(result.hints).toEqual({
      transitions: "硬切，场尾黑场",
      soundDirection: "雨声压低",
      storyboardSounds: [{ storyboardId: "sb-1", sound: "approved-hit" }],
    });
  });

  it("returns exact storyboard ids for missing media, voice and invalid duration", () => {
    const invalid = storyboard(1, {
      durationTarget: 0,
      duration: 0,
      mediaRef: undefined,
      ttsSpokenText: "必须配音",
      audioRef: undefined,
    });
    const invalidVoice = storyboard(2, {
      audioRef: { kind: "audio", path: "/voice-2.wav" },
    });
    const result = buildStoryboardEditingProject({
      ...baseInput([invalid, invalidVoice]),
      voiceDurationsUs: { "sb-2": Number.NaN },
    });

    expect(result).toEqual({
      success: false,
      missingVisualStoryboardIds: ["sb-1"],
      missingAudioStoryboardIds: ["sb-1"],
      invalidDurationStoryboardIds: ["sb-1"],
      invalidVoiceDurationStoryboardIds: ["sb-2"],
    });
    expect("project" in result).toBe(false);
  });

  it("rejects an empty episode and treats explicit no-dialogue markers as silent", () => {
    const empty = buildStoryboardEditingProject({
      ...baseInput([]),
      storyboards: [storyboard(1, { episodeId: "episode-2" })],
    });
    expect(empty).toMatchObject({ success: false, episodeMissing: true });

    const silent = storyboard(1, {
      ttsSpokenText: "无台词",
      line: undefined,
      lines: undefined,
      audioRef: undefined,
    });
    const silentResult = buildStoryboardEditingProject({
      ...baseInput([silent]),
      directorPlan: { ...directorPlan(), episodeId: "episode-2" },
    });
    expect(silentResult.success).toBe(true);
    if (!silentResult.success) return;
    expect(silentResult.project.tracks.map((track) => track.kind)).toEqual([
      "video",
    ]);
    expect(silentResult.hints.transitions).toBeUndefined();
  });

  it("creates a valid vertical EditingProject with source evidence", () => {
    const storyboards = [storyboard(1)];
    const result = buildStoryboardEditingProject({
      ...baseInput(storyboards),
      aspectRatio: undefined,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.renderSettings).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    });
    expect(result.project.clips[0]?.source.evidence).toMatchObject({
      storyboardId: "sb-1",
      sourceRunId: "storyboard-run-1",
      sourceFingerprint: "storyboard-fingerprint-1",
      outputVersion: 2,
    });
    expect(validateEditingProject(result.project).success).toBe(true);
  });
});

describe("legacy SimpleTimeline migration", () => {
  it("preserves seconds-based placement as a protected manual project", () => {
    const result = migrateLegacySimpleTimeline({
      projectId: "project-1",
      episodeId: "episode-1",
      editingProjectId: "legacy-editing-1",
      sourceSnapshotHash: "legacy-snapshot-1",
      createdAt: 10,
      clips: [
        {
          id: "legacy-2",
          mediaId: "media-2",
          name: "片段 2",
          url: "/legacy-2.mp4",
          duration: 3,
          startTime: 2,
        },
        {
          id: "legacy-1",
          mediaId: "media-1",
          name: "片段 1",
          url: "/legacy-1.mp4",
          duration: 2,
          startTime: 0,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value).toMatchObject({
      createdBy: "manual",
      manuallyEdited: true,
      revision: 1,
    });
    expect(result.value.clips.map((clip) => [clip.startUs, clip.durationUs])).toEqual([
      [0, 2_000_000],
      [2_000_000, 3_000_000],
    ]);
    expect(validateEditingProject(result.value).success).toBe(true);
  });

  it("rejects an invalid legacy clip without returning a project", () => {
    const result = migrateLegacySimpleTimeline({
      projectId: "project-1",
      episodeId: "episode-1",
      editingProjectId: "legacy-editing-1",
      sourceSnapshotHash: "legacy-snapshot-1",
      createdAt: 10,
      clips: [
        {
          id: "legacy-1",
          mediaId: "media-1",
          name: "坏片段",
          url: "/legacy.mp4",
          duration: 0,
          startTime: Number.NaN,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.legacy.duration" }),
        expect.objectContaining({ code: "editing.legacy.start_time" }),
      ]),
    );
  });
});

function storyboard(
  index: number,
  updates: Partial<StoryboardItem> = {},
): StoryboardItem {
  return {
    id: `sb-${index}`,
    episodeId: "episode-1",
    index,
    trackKey: "scene-1",
    trackId: "track-1",
    duration: 4,
    durationTarget: 4,
    prompt: `prompt-${index}`,
    videoDesc: `shot-${index}`,
    assetIds: [],
    mediaRef: { kind: "image", path: `/shot-${index}.png` },
    audioRef: { kind: "audio", path: `/voice-${index}.wav` },
    ttsSpokenText: `台词 ${index}`,
    state: "ready",
    sourceRunId: `storyboard-run-${index}`,
    sourceFingerprint: `storyboard-fingerprint-${index}`,
    outputVersion: 2,
    ...updates,
  };
}

function baseInput(storyboards: StoryboardItem[]) {
  return {
    projectId: "project-1",
    episodeId: "episode-1",
    editingProjectId: "editing-1",
    sourceSnapshotHash: "snapshot-1",
    sourceRunId: "auto-run-1",
    createdAt: 10,
    aspectRatio: "9:16",
    storyboards,
    productionTracks: [] as ProductionTrack[],
    videoCandidates: [] as VideoCandidate[],
  };
}

function track(
  storyboards: StoryboardItem[],
  selectedVideoId?: string,
): ProductionTrack {
  return {
    id: "track-1",
    episodeId: "episode-1",
    trackKey: "scene-1",
    storyboardIds: storyboards.map((item) => item.id),
    prompt: "track prompt",
    duration: 8,
    candidateVideoIds: selectedVideoId ? [selectedVideoId] : [],
    selectedVideoId,
    state: "ready",
    stale: false,
  };
}

function candidate(id: string): VideoCandidate {
  return {
    id,
    trackId: "track-1",
    provider: "model-placeholder",
    filePath: "/selected-candidate.mp4",
    state: "ready",
    stale: false,
    sourceRunId: "candidate-run-1",
    sourceFingerprint: "candidate-fingerprint-1",
    outputVersion: 3,
    createdAt: 1,
  };
}

function directorPlan(): ScriptPlan {
  return {
    id: "director-1",
    episodeId: "episode-1",
    theme: "test",
    visualStyle: "ink",
    narrativeRhythm: "steady",
    sceneIntents: [],
    soundDirection: "雨声压低",
    transitions: "硬切，场尾黑场",
    derivedAssetPlan: [],
  };
}
