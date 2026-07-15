import { describe, expect, it } from "vitest";
import { compileTimelineRenderPlan } from "../lib/studio/editing/timeline-render-compiler";
import type { EditingClip, EditingProjectV1 } from "../types/editing";
import {
  buildTimelineFfmpegCommand,
  buildTimelineSubtitleSrt,
} from "./timeline-ffmpeg-command";

describe("timeline ffmpeg command", () => {
  it("builds a vertical five-shot filter graph with transition, pan zoom, audio and subtitle", () => {
    const compiled = compileTimelineRenderPlan(project(), { jobId: "job-1", createdAt: 2 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const command = buildTimelineFfmpegCommand({
      plan: compiled.value,
      resolvedInputs: compiled.value.clips
        .filter((clip) => clip.source.path)
        .map((clip) => ({ clipId: clip.id, sourcePath: clip.source.path! })),
      outputPath: "/owned/output.mp4",
      subtitlePath: "/owned/subtitle.srt",
    });

    expect(command.totalDurationUs).toBe(19_700_000);
    expect(command.filterGraph).toContain("scale=1080:1920");
    expect(command.filterGraph).toContain("zoompan=");
    expect(command.filterGraph).toContain("blend=all_expr='A*(1-min(T/0.3,1))+B*min(T/0.3,1)'");
    expect(command.filterGraph).toContain("concat=n=3:v=1:a=0");
    expect(command.filterGraph).toContain("concat=n=2:v=1:a=0");
    expect(command.filterGraph).toContain("adelay=0|0");
    expect(command.filterGraph).toContain("volume='1*(if(lt(t,2),0.5+(1-0.5)*(t-0)/2,1))*(if(lt(t,0.12),1-(1-0.251189)*(t-0)/0.12");
    expect(command.filterGraph).toContain("if(lte(t,3.5),0.251189,if(lt(t,3.9),0.251189+(1-0.251189)*(t-3.5)/0.4,1))");
    expect(command.filterGraph).toContain("afade=t=in:st=0:d=0.12");
    expect(command.filterGraph).toContain("afade=t=out:st=3.26:d=0.24");
    expect(command.filterGraph).toContain("loudnorm=I=-14:TP=-1.5");
    expect(command.filterGraph).toContain("subtitles='/owned/subtitle.srt'");
    expect(command.args.at(-1)).toBe("/owned/output.mp4");
    expect(command.args).not.toContain("shell");
    expect(command.inputManifest).toHaveLength(7);
  });

  it("leaves BGM unchanged when no active voice exists and excludes muted clips", () => {
    const value = project();
    value.clips.find((clip) => clip.id === "voice-1")!.muted = true;
    const compiled = compileTimelineRenderPlan(value, { jobId: "job-no-voice", createdAt: 4 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const command = buildTimelineFfmpegCommand({
      plan: compiled.value,
      resolvedInputs: compiled.value.clips
        .filter((clip) => clip.source.path)
        .map((clip) => ({ clipId: clip.id, sourcePath: clip.source.path! })),
      outputPath: "/owned/output.mp4",
    });

    expect(command.inputManifest.map((item) => item.clipId)).not.toContain("voice-1");
    expect(command.filterGraph).not.toContain("0.251189");
    expect(command.filterGraph).toContain("volume='1*(if(lt(t,2),0.5+(1-0.5)*(t-0)/2,1))':eval=frame");
  });

  it("serializes timeline subtitle clips as SRT", () => {
    const compiled = compileTimelineRenderPlan(project(), { jobId: "job-2", createdAt: 3 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(buildTimelineSubtitleSrt(compiled.value)).toContain(
      "00:00:00,000 --> 00:00:03,500\n第一句",
    );
  });

  it("maps deterministic clip effects and playback speed before transitions", () => {
    const value = project();
    const second = value.clips.find((clip) => clip.id === "visual-2")!;
    second.source = { kind: "storyboardVideo", path: "/shot-2.mp4", evidence: { storyboardId: "sb-2" } };
    const voice = value.clips.find((clip) => clip.id === "voice-1")!;
    voice.speed = 0.25;
    value.effects.push(
      { id: "effect-blur", effectId: "blur", targetClipId: "visual-1", startUs: 0, durationUs: 1_000_000, params: { radius: 4 }, enabled: true },
      { id: "effect-chromatic", effectId: "chromaticAberration", targetClipId: "visual-1", startUs: 1_000_000, durationUs: 1_000_000, params: { offset: 3 }, enabled: true },
      { id: "effect-glitch", effectId: "glitch", targetClipId: "visual-1", startUs: 2_000_000, durationUs: 500_000, params: { intensity: 0.35 }, enabled: true },
      { id: "effect-glow", effectId: "glow", targetClipId: "visual-1", startUs: 2_500_000, durationUs: 500_000, params: { intensity: 0.4 }, enabled: true },
      { id: "effect-grain", effectId: "grain", targetClipId: "visual-1", startUs: 3_000_000, durationUs: 500_000, params: { amount: 0.12 }, enabled: true },
      { id: "effect-shake", effectId: "shake", targetClipId: "visual-1", startUs: 3_500_000, durationUs: 500_000, params: { intensity: 0.25, frequency: 8 }, enabled: true },
      { id: "effect-speed", effectId: "speed", targetClipId: "visual-2", startUs: 4_000_000, durationUs: 4_000_000, params: { rate: 2 }, enabled: true },
      { id: "effect-disabled", effectId: "blur", targetClipId: "visual-3", startUs: 8_000_000, durationUs: 1_000_000, params: { radius: 64 }, enabled: false },
    );
    const compiled = compileTimelineRenderPlan(value, { jobId: "job-effects", createdAt: 5 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const command = buildTimelineFfmpegCommand({
      plan: compiled.value,
      resolvedInputs: compiled.value.clips
        .filter((clip) => clip.source.path)
        .map((clip) => ({ clipId: clip.id, sourcePath: clip.source.path! })),
      outputPath: "/owned/effects.mp4",
    });

    expect(command.filterGraph).toContain("gblur=sigma=4");
    expect(command.filterGraph).toContain("rgbashift=rh=3:bh=-3");
    expect(command.filterGraph).toContain("all_seed=1337");
    expect(command.filterGraph).toContain("eq=brightness=0.08:saturation=1.2");
    expect(command.filterGraph).toContain("crop=w='");
    expect(command.filterGraph).toContain("setpts=(PTS-STARTPTS)/2");
    expect(command.filterGraph).toContain("atempo=0.5,atempo=0.5");
    expect(command.filterGraph).not.toContain("sigma=64");
    expect(command.args.join(" ")).toContain("-t 8 -i /shot-2.mp4");
    expect(command.filterGraph.indexOf("gblur=sigma=4")).toBeLessThan(
      command.filterGraph.indexOf("concat=n=3:v=1:a=0"),
    );
  });
});

function project(): EditingProjectV1 {
  const visuals = Array.from({ length: 5 }, (_, index): EditingClip => ({
    id: `visual-${index + 1}`,
    trackId: "visual-track",
    name: `镜头 ${index + 1}`,
    source: { kind: "storyboardImage", path: `/shot-${index + 1}.png`, evidence: { storyboardId: `sb-${index + 1}` } },
    startUs: index * 4_000_000,
    durationUs: 4_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
  }));
  const voice: EditingClip = {
    id: "voice-1",
    trackId: "voice-track",
    name: "口播",
    source: { kind: "audio", path: "/voice.wav", evidence: { storyboardId: "sb-1" } },
    startUs: 0,
    durationUs: 3_500_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeInUs: 120_000,
    fadeOutUs: 240_000,
  };
  const bgm: EditingClip = {
    id: "bgm-1",
    trackId: "bgm-track",
    name: "配乐",
    source: { kind: "audio", path: "/bgm.wav", evidence: { mediaId: "bgm-1" } },
    startUs: 0,
    durationUs: 10_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
    envelope: [
      { timeUs: 0, gain: 0.5 },
      { timeUs: 2_000_000, gain: 1 },
    ],
  };
  const subtitle: EditingClip = {
    id: "subtitle-1",
    trackId: "subtitle-track",
    name: "字幕",
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
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "五镜",
    revision: 1,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: { width: 1080, height: 1920, fps: 30, codec: "h264", subtitleMode: "burn-in", loudnessLufs: -14, truePeakDbtp: -1.5 },
    tracks: [
      { id: "visual-track", kind: "video", name: "主画面", order: 0, clipIds: visuals.map((clip) => clip.id), muted: false, locked: false },
      { id: "voice-track", kind: "voice", name: "口播", order: 1, clipIds: [voice.id], muted: false, locked: false },
      { id: "bgm-track", kind: "bgm", name: "配乐", order: 2, clipIds: [bgm.id], muted: false, locked: false },
      { id: "subtitle-track", kind: "text", name: "字幕", order: 3, clipIds: [subtitle.id], muted: false, locked: false },
    ],
    clips: [...visuals, voice, bgm, subtitle],
    transitions: [{ id: "transition-1", fromClipId: "visual-1", toClipId: "visual-2", effectId: "crossfade", durationUs: 300_000, params: { curve: "linear" } }],
    effects: [{ id: "pan-zoom-1", effectId: "panZoom", targetClipId: "visual-1", startUs: 0, durationUs: 4_000_000, params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 }, enabled: true }],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
