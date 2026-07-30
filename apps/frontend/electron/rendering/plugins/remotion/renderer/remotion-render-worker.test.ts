import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import { buildCompositionProps } from "../composition/build-composition-props";
import { RemotionRenderWorker } from "./remotion-render-worker";
import type { ChapterVideoCompositionProps } from "../composition/composition-props";

const TOKEN = "a".repeat(64);
const imageUrl = `http://127.0.0.1:43123/${TOKEN}/image-1`;
const audioUrl = `http://127.0.0.1:43123/${TOKEN}/audio-1`;

describe("buildCompositionProps", () => {
  it("projects visual, audio and subtitle clips onto one frame grid", () => {
    const props = buildCompositionProps(plan(), {
      "visual-1": imageUrl,
      "voice-1": audioUrl,
    });

    expect(props).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 60,
      visualClips: [{ clipId: "visual-1", kind: "image", from: 0, durationInFrames: 60 }],
      audioClips: [{ clipId: "voice-1", kind: "voice", from: 0, durationInFrames: 45 }],
      subtitles: [{ cueId: "subtitle-1", from: 0, durationInFrames: 45, text: "第一句" }],
    });
    expect(props.visualClips[0]?.panZoom).toEqual({
      fromScale: 1,
      toScale: 1.06,
      originX: 0.5,
      originY: 0.5,
    });
  });

  it("requires capability URLs instead of filesystem paths", () => {
    expect(() => buildCompositionProps(plan(), { "visual-1": "/tmp/shot.png" })).toThrow(
      "缺少 127.0.0.1 capability URL",
    );
  });
});

describe("RemotionRenderWorker", () => {
  it("accepts ChapterVideo input boundary", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-chapter-"));
    const bundlePath = path.join(root, "bundle");
    const outputPath = path.join(root, "chapter.mp4");
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({ schemaVersion: 2, templateId: "mystudio-remotion-v1", templateVersion: "1.0.0", remotionVersion: "4.0.499", compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"], compositionId: "DaojieTimeline", contentHash: "b".repeat(64) }));
    const props: ChapterVideoCompositionProps = { width: 1080, height: 1920, fps: 30, durationInFrames: 30, target: "chapter", projectId: "p", chapterId: "c", editingProjectId: "e", editingRevision: 1, visualClips: [{ clipId: "shot-1", kind: "video", src: `http://127.0.0.1:43123/${TOKEN}/current.mp4`, from: 0, durationInFrames: 30, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }], transitions: [], audioClips: [{ clipId: "bgm", kind: "bgm", renderScope: "chapter", src: audioUrl, from: 0, durationInFrames: 30, volume: 1 }], subtitles: [] };
    let renderOptions: Record<string, unknown> | undefined;
    const worker = new RemotionRenderWorker({ emitProgress: () => undefined, api: { makeCancelSignal: () => ({ cancelSignal: () => undefined, cancel: () => undefined }), selectComposition: async (o) => ({ id: o.id, width: 1080, height: 1920, fps: 30, durationInFrames: 30 } as never), renderMedia: async (o) => { renderOptions = o as unknown as Record<string, unknown>; fs.writeFileSync(outputPath, "mp4"); return {} as never; } } });
    const result = await worker.render({ target: "chapter", jobId: "chapter-job", compositionProps: props, compositionId: "ChapterVideo", bundlePath, outputPath, browserExecutable: "/bin/true", remotionVersion: "4.0.499" });
    expect(result.success).toBe(true);
    expect(renderOptions).toMatchObject({ codec: "h264", audioCodec: "aac", outputLocation: outputPath });
  });
  it("selects the fixed composition, renders H.264/AAC, and forwards progress", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-worker-"));
    const bundlePath = path.join(root, "bundle");
    const outputPath = path.join(root, "raw.mp4");
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "b".repeat(64),
    }), "utf8");
    const calls: Record<string, unknown>[] = [];
    const progress: string[] = [];
    const worker = new RemotionRenderWorker({
      emitProgress: (event) => progress.push(`${event.stage}:${event.ratio}`),
      api: {
        makeCancelSignal: () => ({ cancelSignal: () => undefined, cancel: () => undefined }),
        selectComposition: async (options) => {
          calls.push({ select: options });
          return { id: "DaojieTimeline", width: 1080, height: 1920, fps: 30, durationInFrames: 60 } as never;
        },
        renderMedia: async (options) => {
          calls.push({ render: options });
          options.onProgress?.({
            progress: 0.5,
            renderedFrames: 30,
            encodedFrames: 30,
            encodedDoneIn: 1,
            renderedDoneIn: 1,
            renderEstimatedTime: 1,
            stitchStage: "encoding",
          });
          fs.writeFileSync(outputPath, "mp4", "utf8");
          return {} as never;
        },
      },
    });

    try {
      const result = await worker.render({
        plan: plan(),
        bundlePath,
        outputPath,
        browserExecutable: "/opt/headless-shell",
        remotionVersion: "4.0.499",
        mediaUrlByClipId: { "visual-1": imageUrl, "voice-1": audioUrl },
      });
      expect(result.success).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.render).toMatchObject({
        codec: "h264",
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        outputLocation: outputPath,
      });
      expect(progress.some((event) => event.startsWith("rendering:"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("cancels the active Remotion job without starting FFmpeg", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-cancel-"));
    const bundlePath = path.join(root, "bundle");
    const outputPath = path.join(root, "raw.mp4");
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "c".repeat(64),
    }), "utf8");
    let rejectRender: ((error: Error) => void) | undefined;
    const worker = new RemotionRenderWorker({
      emitProgress: () => undefined,
      api: {
        makeCancelSignal: () => ({ cancelSignal: () => undefined, cancel: () => rejectRender?.(new Error("renderMedia() got cancelled")) }),
        selectComposition: async () => ({ id: "DaojieTimeline", width: 1080, height: 1920, fps: 30, durationInFrames: 60 } as never),
        renderMedia: async () => {
          fs.writeFileSync(outputPath, "partial", "utf8");
          return new Promise((_, reject) => { rejectRender = reject; });
        },
      },
    });
    const renderPromise = worker.render({
      plan: plan(),
      bundlePath,
      outputPath,
      browserExecutable: "/opt/headless-shell",
      remotionVersion: "4.0.499",
      mediaUrlByClipId: { "visual-1": imageUrl, "voice-1": audioUrl },
    });
    await waitFor(() => rejectRender !== undefined);
    expect(worker.cancel("render-1")).toMatchObject({ success: true, canceled: true });
    await expect(renderPromise).resolves.toMatchObject({ success: false, canceled: true });
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.existsSync(path.join(root, "raw.partial.mp4"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects and quarantines an empty render output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-empty-"));
    const bundlePath = path.join(root, "bundle");
    const outputPath = path.join(root, "raw.mp4");
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "d".repeat(64),
    }), "utf8");
    const worker = new RemotionRenderWorker({
      emitProgress: () => undefined,
      api: {
        makeCancelSignal: () => ({ cancelSignal: () => undefined, cancel: () => undefined }),
        selectComposition: async () => ({ id: "DaojieTimeline", width: 1080, height: 1920, fps: 30, durationInFrames: 60 } as never),
        renderMedia: async () => {
          fs.writeFileSync(outputPath, "", "utf8");
          return {} as never;
        },
      },
    });

    try {
      await expect(worker.render({
        plan: plan(),
        bundlePath,
        outputPath,
        browserExecutable: "/opt/headless-shell",
        remotionVersion: "4.0.499",
        mediaUrlByClipId: { "visual-1": imageUrl, "voice-1": audioUrl },
      })).resolves.toMatchObject({ success: false, canceled: false });
      expect(fs.existsSync(outputPath)).toBe(false);
      expect(fs.existsSync(path.join(root, "raw.partial.mp4"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a bundle version mismatch before selecting the composition", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-mismatch-"));
    const bundlePath = path.join(root, "bundle");
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.498",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "f".repeat(64),
    }), "utf8");
    let selectCalls = 0;
    const worker = new RemotionRenderWorker({
      emitProgress: () => undefined,
      api: {
        makeCancelSignal: () => ({ cancelSignal: () => undefined, cancel: () => undefined }),
        selectComposition: async () => {
          selectCalls += 1;
          return {} as never;
        },
        renderMedia: async () => ({} as never),
      },
    });

    try {
      await expect(worker.render({
        plan: plan(),
        bundlePath,
        outputPath: path.join(root, "raw.mp4"),
        browserExecutable: "/opt/headless-shell",
        remotionVersion: "4.0.499",
        mediaUrlByClipId: { "visual-1": imageUrl, "voice-1": audioUrl },
      })).resolves.toMatchObject({ success: false, canceled: false });
      expect(selectCalls).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for Remotion render to start");
}

function plan(): TimelineRenderPlan {
  const visual = {
    id: "visual-1",
    trackId: "track-visual",
    name: "镜头 1",
    source: { kind: "storyboardImage" as const, path: "/tmp/shot.png", evidence: {} },
    startUs: 0,
    durationUs: 2_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
  };
  const voice = {
    id: "voice-1",
    trackId: "track-voice",
    name: "口播",
    source: { kind: "audio" as const, path: "/tmp/voice.wav", evidence: {} },
    startUs: 0,
    durationUs: 1_500_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  const subtitle = {
    id: "subtitle-1",
    trackId: "track-subtitle",
    name: "字幕",
    source: { kind: "text" as const, text: "第一句", evidence: {} },
    startUs: 0,
    durationUs: 1_500_000,
    trimStartUs: 0,
    speed: 1,
    volume: 0,
    muted: true,
  };
  const project = {
    schemaVersion: 1 as const,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "测试",
    revision: 1,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "auto" as const,
    manuallyEdited: false,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264" as const,
      subtitleMode: "burn-in" as const,
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [
      { id: "track-visual", kind: "video" as const, name: "画面", order: 0, clipIds: ["visual-1"], muted: false, locked: false },
      { id: "track-voice", kind: "voice" as const, name: "口播", order: 1, clipIds: ["voice-1"], muted: false, locked: false },
      { id: "track-subtitle", kind: "text" as const, name: "字幕", order: 2, clipIds: ["subtitle-1"], muted: false, locked: false },
    ],
    clips: [visual, voice, subtitle],
    transitions: [],
    effects: [{ id: "effect-1", effectId: "panZoom" as const, targetClipId: "visual-1", startUs: 0, durationUs: 2_000_000, params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 }, enabled: true }],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    schemaVersion: 1,
    jobId: "render-1",
    projectId: project.projectId,
    episodeId: project.episodeId,
    editingProjectId: project.id,
    editingRevision: project.revision,
    sourceSnapshotHash: project.sourceSnapshotHash,
    editingProjectSnapshot: structuredClone(project),
    renderSettings: {
      ...project.renderSettings,
      audioDucking: { reductionDb: -12, attackUs: 120_000, releaseUs: 400_000 },
    },
    clips: [
      { ...visual, trackKind: "video" as const },
      { ...voice, trackKind: "voice" as const },
      { ...subtitle, trackKind: "text" as const },
    ],
    transitions: [],
    effects: [{ ...project.effects[0]! }],
    createdAt: 2,
  };
}
