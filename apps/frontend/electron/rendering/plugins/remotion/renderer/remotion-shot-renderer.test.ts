import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import { makeChapterManifest } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { RemotionShotRenderer, selectRemotionShotVideoDuration } from "./remotion-shot-renderer";

class FakeUtilityProcess {
  posted: unknown[] = [];
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();

  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    (event === "message" ? this.messageListeners : this.exitListeners).add(listener);
    return this;
  }

  off(event: "message", listener: (message: unknown) => void): this;
  off(event: "exit", listener: (code: number) => void): this;
  off(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    (event === "message" ? this.messageListeners : this.exitListeners).delete(listener);
    return this;
  }

  postMessage(message: unknown): void { this.posted.push(message); }
  kill(): boolean { return true; }
  reply(message: unknown): void { this.messageListeners.forEach((listener) => listener(message)); }
}

describe("RemotionShotRenderer", () => {
  it("uses the video stream duration before container duration", () => {
    expect(selectRemotionShotVideoDuration({
      format: { duration: 2.048 },
      streams: [{ codec_type: "video", duration: 2 }],
    })).toBe(2);
    expect(selectRemotionShotVideoDuration({
      format: { duration: 2.048 },
      streams: [{ codec_type: "audio", duration: 2.048 }],
    })).toBe(2.048);
  });

  it("renders StoryboardShot through Remotion and publishes one current slot", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-shot-renderer-"));
    const bundlePath = path.join(root, "bundle");
    const imagePath = path.join(root, "shot.png");
    const audioPath = path.join(root, "voice.wav");
    const child = new FakeUtilityProcess();
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.writeFileSync(imagePath, "image", "utf8");
    fs.writeFileSync(audioPath, "audio", "utf8");
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "a".repeat(64),
    }), "utf8");
    const chapter = makeChapterManifest();
    const plan = await makePlan(chapter);
    const renderer = new RemotionShotRenderer({
      workspaceRoot: path.join(root, "workspace"),
      bundlePath,
      workerPath: "/app/remotion-render-worker.cjs",
      cwd: "/runtime/remotion",
      binariesDirectory: "/app/binaries",
      remotionVersion: "4.0.499",
      resolveSourcePath: (source) => source.endsWith("images/shot-001.png") ? imagePath : audioPath,
      probeBrowser: async () => ({
        status: { state: "ready", remotionVersion: "4.0.499" },
        executablePath: "/runtime/headless-shell",
      }),
      fork: () => child,
      emitProgress: () => undefined,
      probeMedia: async () => ({
        duration: 2,
        width: 1080,
        height: 1920,
        streams: [
          { kind: "video", codec: "h264", width: 1080, height: 1920 },
          { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
        ],
      }),
    });

    try {
      const renderPromise = renderer.render(plan);
      await waitFor(() => child.posted.length === 1);
      const command = child.posted[0] as { requestId: string; input: { outputPath: string } };
      fs.mkdirSync(path.dirname(command.input.outputPath), { recursive: true });
      fs.writeFileSync(command.input.outputPath, "remotion-mp4", "utf8");
      child.reply({
        kind: "result",
        requestId: command.requestId,
        result: {
          success: true,
          jobId: (child.posted[0] as { input: { jobId: string } }).input.jobId,
          outputPath: command.input.outputPath,
          composition: { id: "StoryboardShot", width: 1080, height: 1920, fps: 30, durationInFrames: 60 },
        },
      });
      const result = await renderPromise;
      if (!result.success) throw new Error(result.error);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.slot.target).toMatchObject({ kind: "shot", chapterId: "chapter-001", shotId: "shot-001" });
      expect(result.slot.evidence.renderer).toEqual({ requested: "remotion", actual: "remotion" });
      expect(fs.existsSync(path.join(root, "workspace", result.slot.outputPath))).toBe(true);
      expect(fs.existsSync(path.join(root, "workspace", result.slot.jobPath))).toBe(true);
      expect(fs.existsSync(path.join(root, "workspace", result.slot.evidencePath))).toBe(true);
    } finally {
      await renderer.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

async function makePlan(chapter: ReturnType<typeof makeChapterManifest>): Promise<RemotionShotPlanV1> {
  const shot = chapter.shots[0]!;
  const hashInput = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId: chapter.projectId,
    chapterId: chapter.chapterId,
    renderSettings: chapter.renderSettings,
    visualKind: "image" as const,
    shot,
    sharedAudioTracks: chapter.sharedAudioTracks,
  };
  return {
    schemaVersion: 1,
    target: "shot",
    projectId: chapter.projectId,
    chapterId: chapter.chapterId,
    chapterRevision: chapter.revision,
    sourceSnapshotHash: chapter.sourceSnapshotHash,
    renderSettings: chapter.renderSettings,
    visualKind: "image",
    shot,
    sharedAudioTracks: chapter.sharedAudioTracks,
    inputHash: await sha256CanonicalJson(hashInput),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for shot render worker");
}
