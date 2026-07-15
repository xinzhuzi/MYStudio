import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EditingClip, EditingProjectV1, TimelineRenderProgress } from "../types/editing";
import { compileTimelineRenderPlan } from "../lib/studio/editing/timeline-render-compiler";
import { createTimelineRenderRuntime } from "./timeline-render-runtime";

const execFileAsync = promisify(execFile);
const integrationDescribe = process.env.MYSTUDIO_TIMELINE_RENDER_INTEGRATION === "1"
  ? describe
  : describe.skip;

integrationDescribe("timeline render runtime integration", () => {
  let root = "";
  let imagePaths: string[] = [];
  let voicePath = "";
  let videoPath = "";

  beforeAll(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mystudio-timeline-render-"));
    imagePaths = await Promise.all(
      ["red", "green", "blue", "yellow", "purple"].map(async (color, index) => {
        const filePath = path.join(root, `shot-${index + 1}.png`);
        await execFileAsync("ffmpeg", [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", `color=c=${color}:s=64x64:d=0.1`,
          "-frames:v", "1", "-update", "1", filePath,
        ]);
        return filePath;
      }),
    );
    voicePath = path.join(root, "voice.wav");
    await execFileAsync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2.45",
      "-c:a", "pcm_s16le", voicePath,
    ]);
    videoPath = path.join(root, "source-video.mp4");
    await execFileAsync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=30:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
    ]);
  }, 30_000);

  afterAll(async () => {
    if (root) await fs.promises.rm(root, { recursive: true, force: true });
  });

  it("renders five shots with audio, subtitles and complete evidence", async () => {
    const project = projectFixture(imagePaths, voicePath, 500_000);
    const compiled = compileTimelineRenderPlan(project, { jobId: "integration-five-shot", createdAt: 2 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const progress: TimelineRenderProgress[] = [];
    const runtime = createTimelineRenderRuntime({
      renderRoot: path.join(root, "renders"),
      resolveSourcePath: (sourcePath) => sourcePath,
      emitProgress: (event) => progress.push(event),
      now: () => 3,
    });

    const result = await runtime.render(compiled.value);

    if (!result.success) throw new Error(result.error);
    expect(result.evidence).toMatchObject({
      width: 1080,
      height: 1920,
      streams: expect.arrayContaining(["video", "audio"]),
    });
    expect(Math.abs(result.evidence.duration - 2.45)).toBeLessThanOrEqual(1 / 30);
    expect(result.evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const artifactPath of [
      result.evidence.path,
      result.evidence.snapshotPath,
      result.evidence.renderPlanPath,
      result.evidence.inputManifestPath,
      result.evidence.filterGraphPath,
      result.evidence.logPath,
      result.evidence.ffprobePath,
    ]) {
      expect(artifactPath && fs.existsSync(artifactPath)).toBe(true);
    }
    expect(progress.map((item) => item.stage)).toEqual(
      expect.arrayContaining(["validating", "preparing", "rendering", "probing", "completed"]),
    );
  }, 120_000);

  it("renders deterministic style effects and speed through the real FFmpeg graph", async () => {
    const project = projectFixture(imagePaths, voicePath, 500_000);
    const second = project.clips.find((clip) => clip.id === "visual-2")!;
    second.source = { kind: "storyboardVideo", path: videoPath, evidence: { storyboardId: "storyboard-2" } };
    project.effects.push(
      { id: "blur-1", effectId: "blur", targetClipId: "visual-1", startUs: 0, durationUs: 150_000, params: { radius: 2 }, enabled: true },
      { id: "chromatic-1", effectId: "chromaticAberration", targetClipId: "visual-1", startUs: 150_000, durationUs: 150_000, params: { offset: 2 }, enabled: true },
      { id: "grain-1", effectId: "grain", targetClipId: "visual-1", startUs: 300_000, durationUs: 200_000, params: { amount: 0.1 }, enabled: true },
      { id: "speed-1", effectId: "speed", targetClipId: "visual-2", startUs: 500_000, durationUs: 500_000, params: { rate: 2 }, enabled: true },
    );
    const compiled = compileTimelineRenderPlan(project, { jobId: "integration-effects", createdAt: 6 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const runtime = createTimelineRenderRuntime({
      renderRoot: path.join(root, "renders"),
      resolveSourcePath: (sourcePath) => sourcePath,
      emitProgress: () => undefined,
      now: () => 7,
    });

    const result = await runtime.render(compiled.value);

    if (!result.success) throw new Error(result.error);
    expect(result.evidence).toMatchObject({
      width: 1080,
      height: 1920,
      streams: expect.arrayContaining(["video", "audio"]),
    });
    expect(Math.abs(result.evidence.duration - 2.45)).toBeLessThanOrEqual(1 / 30);
    const filterGraph = await fs.promises.readFile(result.evidence.filterGraphPath!, "utf8");
    expect(filterGraph).toContain("gblur=sigma=2");
    expect(filterGraph).toContain("rgbashift=rh=2:bh=-2");
    expect(filterGraph).toContain("all_seed=1337");
    expect(filterGraph).toContain("setpts=(PTS-STARTPTS)/2");
  }, 120_000);

  it("cancels only the active FFmpeg job and keeps the editing project intact", async () => {
    const project = projectFixture(imagePaths, voicePath, 30_000_000, false);
    const original = JSON.stringify(project);
    const compiled = compileTimelineRenderPlan(project, { jobId: "integration-cancel", createdAt: 4 });
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    const progress: TimelineRenderProgress[] = [];
    const runtimeRef: { current?: ReturnType<typeof createTimelineRenderRuntime> } = {};
    const runtime = createTimelineRenderRuntime({
      renderRoot: path.join(root, "renders"),
      resolveSourcePath: (sourcePath) => sourcePath,
      emitProgress: (event) => {
        progress.push(event);
        if (event.stage === "rendering" && event.ratio === 0.08) {
          setTimeout(() => runtimeRef.current?.cancel(event.jobId), 10);
        }
      },
      now: () => 5,
    });
    runtimeRef.current = runtime;

    const result = await runtime.render(compiled.value);

    expect(result).toMatchObject({ success: false, jobId: "integration-cancel", canceled: true });
    expect(progress.at(-1)?.stage).toBe("canceled");
    expect(JSON.stringify(project)).toBe(original);
  }, 30_000);
});

function projectFixture(
  images: string[],
  audio: string,
  shotDurationUs: number,
  includeAudioAndSubtitles = true,
): EditingProjectV1 {
  const visuals = images.map((imagePath, index): EditingClip => ({
    id: `visual-${index + 1}`,
    trackId: "visual-track",
    name: `镜头 ${index + 1}`,
    source: {
      kind: "storyboardImage",
      path: imagePath,
      evidence: { storyboardId: `storyboard-${index + 1}` },
    },
    startUs: index * shotDurationUs,
    durationUs: shotDurationUs,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
  }));
  const voice: EditingClip = {
    id: "voice-1",
    trackId: "voice-track",
    name: "口播",
    source: { kind: "audio", path: audio, evidence: { storyboardId: "storyboard-1" } },
    startUs: 0,
    durationUs: Math.min(2_450_000, shotDurationUs * 5),
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  const subtitle: EditingClip = {
    id: "subtitle-1",
    trackId: "subtitle-track",
    name: "字幕",
    source: { kind: "text", text: "第一句", evidence: { storyboardId: "storyboard-1" } },
    startUs: 0,
    durationUs: Math.min(450_000, shotDurationUs),
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  const transitionDurationUs = Math.min(50_000, Math.floor(shotDurationUs * 0.15));
  return {
    schemaVersion: 1,
    id: "editing-integration",
    projectId: "project-integration",
    episodeId: "episode-integration",
    name: "五镜纵向集成测试",
    revision: 1,
    sourceSnapshotHash: "snapshot-integration",
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: includeAudioAndSubtitles ? "burn-in" : "none",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
      audioDucking: {
        reductionDb: -12,
        attackUs: 120_000,
        releaseUs: 400_000,
      },
    },
    tracks: [
      { id: "visual-track", kind: "video", name: "主画面", order: 0, clipIds: visuals.map((clip) => clip.id), muted: false, locked: false },
      ...(includeAudioAndSubtitles ? [
        { id: "voice-track", kind: "voice" as const, name: "口播", order: 1, clipIds: [voice.id], muted: false, locked: false },
        { id: "subtitle-track", kind: "text" as const, name: "字幕", order: 2, clipIds: [subtitle.id], muted: false, locked: false },
      ] : []),
    ],
    clips: includeAudioAndSubtitles ? [...visuals, voice, subtitle] : visuals,
    transitions: [{
      id: "transition-1",
      fromClipId: "visual-1",
      toClipId: "visual-2",
      effectId: "crossfade",
      durationUs: transitionDurationUs,
      params: { curve: "linear" },
    }],
    effects: [{
      id: "pan-zoom-1",
      effectId: "panZoom",
      targetClipId: "visual-1",
      startUs: 0,
      durationUs: shotDurationUs,
      params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
      enabled: true,
    }],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
