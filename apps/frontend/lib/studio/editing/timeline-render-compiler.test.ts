import { describe, expect, it } from "vitest";
import type { EditingClip, EditingProjectV1 } from "@/types/editing";
import { compileTimelineRenderPlan } from "./timeline-render-compiler";

describe("timeline render compiler", () => {
  it("compiles a deterministic vertical five-shot plan with audio and subtitles", () => {
    const project = fiveShotProject();
    const result = compileTimelineRenderPlan(project, {
      jobId: "render-five-shot",
      createdAt: 42,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.renderSettings).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
      audioDucking: {
        reductionDb: -12,
        attackUs: 120_000,
        releaseUs: 400_000,
      },
    });
    expect(result.value.clips.map((clip) => clip.id)).toEqual([
      "visual-1",
      "visual-2",
      "visual-3",
      "visual-4",
      "visual-5",
      "voice-1",
      "subtitle-1",
    ]);
    expect(result.value.clips.find((clip) => clip.id === "voice-1")?.trackKind).toBe("voice");
    expect(result.value.clips.find((clip) => clip.id === "subtitle-1")?.source.text).toBe("第一句");
    expect(result.value.transitions[0]).toMatchObject({ effectId: "crossfade", durationUs: 300_000 });
    expect(result.value.effects).toEqual([
      expect.objectContaining({ effectId: "panZoom", targetClipId: "visual-1" }),
    ]);
  });

  it("rejects overlapping main visuals and transitions above the conservative limit", () => {
    const project = fiveShotProject();
    project.clips.find((clip) => clip.id === "visual-2")!.startUs = 3_000_000;
    project.transitions[0]!.durationUs = 700_000;

    const result = compileTimelineRenderPlan(project, {
      jobId: "render-invalid",
      createdAt: 43,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "editing.render.main_visual_overlap",
        "editing.render.transition_too_long",
      ]),
    );
  });

  it("rejects a plan without a main visual before IPC", () => {
    const project = fiveShotProject();
    project.tracks = project.tracks.filter((track) => track.kind !== "video");
    project.clips = project.clips.filter((clip) => clip.trackId !== "track-visual");
    project.transitions = [];
    project.effects = [];

    const result = compileTimelineRenderPlan(project, {
      jobId: "render-audio-only",
      createdAt: 44,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.render.main_visual_missing" }),
      ]),
    );
  });
});

function fiveShotProject(): EditingProjectV1 {
  const visualClips = Array.from({ length: 5 }, (_, index): EditingClip => ({
    id: `visual-${index + 1}`,
    trackId: "track-visual",
    name: `镜头 ${index + 1}`,
    source: {
      kind: index === 1 ? "storyboardVideo" : "storyboardImage",
      path: index === 1 ? "/shot-2.mp4" : `/shot-${index + 1}.png`,
      evidence: { storyboardId: `sb-${index + 1}` },
    },
    startUs: index * 4_000_000,
    durationUs: 4_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
  }));
  const voice: EditingClip = {
    id: "voice-1",
    trackId: "track-voice",
    name: "口播 1",
    source: { kind: "audio", path: "/voice-1.wav", evidence: { storyboardId: "sb-1" } },
    startUs: 0,
    durationUs: 3_500_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  const subtitle: EditingClip = {
    id: "subtitle-1",
    trackId: "track-subtitle",
    name: "字幕 1",
    source: { kind: "text", text: "第一句", evidence: { storyboardId: "sb-1" } },
    startUs: 0,
    durationUs: 3_500_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  return {
    schemaVersion: 1,
    id: "editing-five-shot",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "五镜测试",
    revision: 1,
    sourceSnapshotHash: "snapshot-five-shot",
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [
      { id: "track-visual", kind: "video", name: "主画面", order: 0, clipIds: visualClips.map((clip) => clip.id), muted: false, locked: false },
      { id: "track-voice", kind: "voice", name: "口播", order: 1, clipIds: [voice.id], muted: false, locked: false },
      { id: "track-subtitle", kind: "text", name: "字幕", order: 2, clipIds: [subtitle.id], muted: false, locked: false },
    ],
    clips: [...visualClips, voice, subtitle],
    transitions: [{ id: "transition-1", fromClipId: "visual-1", toClipId: "visual-2", effectId: "crossfade", durationUs: 300_000, params: { curve: "linear" } }],
    effects: [{ id: "effect-1", effectId: "panZoom", targetClipId: "visual-1", startUs: 0, durationUs: 4_000_000, params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 }, enabled: true }],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
