import { describe, expect, it } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import { buildEditingEffectPreview } from "./effect-preview";

describe("editing effect preview", () => {
  it("sorts enabled effects and exposes honest browser capability", () => {
    const project = previewProject();
    const preview = buildEditingEffectPreview(project, "clip-1");

    expect(preview.effects.map((effect) => effect.id)).toEqual([
      "blur-1",
      "speed-1",
      "glitch-1",
    ]);
    expect(preview.capability).toBe("approximate");
    expect(preview.filter).toContain("blur(4px)");
    expect(preview.filter).toContain("contrast(1.12)");
    expect(preview.playbackRate).toBe(2);
    expect(preview.notice).toBe("近似预览，最终效果以 FFmpeg 成片为准");
  });

  it("ignores disabled and other-clip effects", () => {
    const project = previewProject();
    project.effects.push(
      { id: "disabled", effectId: "blur", targetClipId: "clip-1", startUs: 0, durationUs: 1_000_000, params: { radius: 64 }, enabled: false },
      { id: "other", effectId: "glow", targetClipId: "clip-2", startUs: 0, durationUs: 1_000_000, params: { intensity: 1 }, enabled: true },
    );

    const preview = buildEditingEffectPreview(project, "clip-1");
    expect(preview.effects.map((effect) => effect.id)).not.toEqual(expect.arrayContaining(["disabled", "other"]));
    expect(preview.filter).not.toContain("64px");
  });
});

function previewProject(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-preview",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "preview",
    revision: 1,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "manual",
    manuallyEdited: true,
    stale: false,
    renderSettings: { width: 1080, height: 1920, fps: 30, codec: "h264", subtitleMode: "none", loudnessLufs: -14, truePeakDbtp: -1.5 },
    tracks: [{ id: "visual", kind: "video", name: "主画面", order: 0, clipIds: ["clip-1", "clip-2"], muted: false, locked: false }],
    clips: [
      { id: "clip-1", trackId: "visual", name: "clip-1", source: { kind: "storyboardVideo", path: "/clip-1.mp4", evidence: {} }, startUs: 0, durationUs: 4_000_000, trimStartUs: 0, speed: 1, volume: 0, muted: true },
      { id: "clip-2", trackId: "visual", name: "clip-2", source: { kind: "storyboardVideo", path: "/clip-2.mp4", evidence: {} }, startUs: 4_000_000, durationUs: 4_000_000, trimStartUs: 0, speed: 1, volume: 0, muted: true },
    ],
    transitions: [],
    effects: [
      { id: "speed-1", effectId: "speed", targetClipId: "clip-1", startUs: 0, durationUs: 4_000_000, params: { rate: 2 }, enabled: true },
      { id: "glitch-1", effectId: "glitch", targetClipId: "clip-1", startUs: 1_000_000, durationUs: 1_000_000, params: { intensity: 0.4 }, enabled: true },
      { id: "blur-1", effectId: "blur", targetClipId: "clip-1", startUs: 0, durationUs: 1_000_000, params: { radius: 4 }, enabled: true },
    ],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
