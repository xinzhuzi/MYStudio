import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import {
  makeChapterManifestV2,
  makeShotAudioBindingV2,
} from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import {
  RemotionShotRenderer,
  selectRemotionShotVideoDuration,
  type DepthAdapterLike,
} from "./remotion-shot-renderer";

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
    const projectRoot = path.join(root, "project");
    const bundlePath = path.join(root, "bundle");
    const imagePath = path.join(projectRoot, "images", "shot-001.png");
    const imageBytes = Buffer.from("image", "utf8");
    const imageSha256 = crypto.createHash("sha256").update(imageBytes).digest("hex");
    const audioBytes = Buffer.from("audio", "utf8");
    const audioSha256 = crypto.createHash("sha256").update(audioBytes).digest("hex");
    const voice = await makeShotAudioBindingV2({ sourceFingerprint: audioSha256 });
    const audioPath = path.join(projectRoot, voice.source.relativePath);
    const child = new FakeUtilityProcess();
    fs.mkdirSync(bundlePath, { recursive: true });
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, imageBytes);
    fs.writeFileSync(audioPath, audioBytes);
    fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
      schemaVersion: 2,
      templateId: "mystudio-remotion-v1",
      templateVersion: "1.0.0",
      remotionVersion: "4.0.499",
      compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      compositionId: "DaojieTimeline",
      contentHash: "a".repeat(64),
    }), "utf8");
    const chapter = await makeChapterManifestV2();
    chapter.shots[0]!.visualSource = {
      ...chapter.shots[0]!.visualSource,
      contentSha256: imageSha256,
    };
    chapter.shots[0]!.sourceFingerprint = imageSha256;
    chapter.shots[0]!.audioBindings = [voice];
    const plan = await makePlan(chapter);
    const renderer = new RemotionShotRenderer({
      workspaceRoot: path.join(root, "workspace"),
      projectRootForProject: () => projectRoot,
      bundlePath,
      workerPath: "/app/remotion-render-worker.cjs",
      cwd: "/runtime/remotion",
      binariesDirectory: "/app/binaries",
      remotionVersion: "4.0.499",
      resolveSourcePath: () => imagePath,
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

  it("rejects audio byte drift before invoking the render worker", async () => {
    const fixture = await makeRejectFixture("byte-drift");
    fs.writeFileSync(fixture.audioPath, "changed-after-binding", "utf8");
    try {
      const result = await fixture.renderer.render(fixture.plan);
      expect(result).toMatchObject({ success: false, canceled: false });
      if (!result.success) expect(result.error).toContain("source_sha256_mismatch");
      expect(fixture.child.posted).toHaveLength(0);
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked audio parent before invoking the render worker", async () => {
    const fixture = await makeRejectFixture("parent-symlink", true);
    try {
      const result = await fixture.renderer.render(fixture.plan);
      expect(result).toMatchObject({ success: false, canceled: false });
      if (!result.success) expect(result.error).toContain("path_escape");
      expect(fixture.child.posted).toHaveLength(0);
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects visual byte drift before invoking the render worker", async () => {
    const fixture = await makeRejectFixture("visual-byte-drift");
    fs.writeFileSync(fixture.imagePath, "changed-image", "utf8");
    try {
      const result = await fixture.renderer.render(fixture.plan);
      expect(result).toMatchObject({ success: false, canceled: false });
      if (!result.success) expect(result.error).toContain("visual_source_sha256_mismatch");
      expect(fixture.child.posted).toHaveLength(0);
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a visual source outside the project root before invoking the render worker", async () => {
    const fixture = await makeRejectFixture("visual-path-escape");
    const outsidePath = path.join(fixture.root, "outside.png");
    fs.writeFileSync(outsidePath, "outside-image", "utf8");
    fixture.setResolveSourcePath(outsidePath);
    try {
      const result = await fixture.renderer.render(fixture.plan);
      expect(result).toMatchObject({ success: false, canceled: false });
      if (!result.success) expect(result.error).toContain("path_escape");
      expect(fixture.child.posted).toHaveLength(0);
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not estimate depth for a plain image shot", async () => {
    const calls: Parameters<DepthAdapterLike["estimateDepth"]>[0][] = [];
    const adapter: DepthAdapterLike = {
      estimateDepth: async (request) => {
        calls.push(request);
        return { state: "blocked", code: "unexpected", message: "plain images must not request depth" };
      },
    };
    const fixture = await makeRejectFixture("plain-image-depth", false, adapter);
    try {
      const renderPromise = fixture.renderer.render(fixture.plan);
      await waitFor(() => fixture.child.posted.length === 1);
      expect(calls).toHaveLength(0);
      replyWithSuccessfulRender(fixture.child);
      await expect(renderPromise).resolves.toMatchObject({ success: true });
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("injects a localhost depth capability URL for a ready cinematic image shot", async () => {
    const calls: Parameters<DepthAdapterLike["estimateDepth"]>[0][] = [];
    const adapter: DepthAdapterLike = {
      estimateDepth: async (request) => {
        calls.push(request);
        await fs.promises.mkdir(path.dirname(request.outputDepthPath), { recursive: true });
        const depthBytes = Buffer.from("depth-png", "utf8");
        await fs.promises.writeFile(request.outputDepthPath, depthBytes);
        return {
          state: "ready",
          artifact: {
            schemaVersion: 1,
            projectId: request.projectId,
            shotId: request.shotId,
            status: "accepted",
            model: request.model,
            inputSha256: crypto.createHash("sha256").update("image").digest("hex"),
            outputPath: request.outputDepthPath,
            outputSha256: crypto.createHash("sha256").update(depthBytes).digest("hex"),
            width: 1080,
            height: 1920,
            depthRange: { min: 0, max: 1 },
            toolVersion: "0.1.0",
            generatedAt: 1,
          },
        };
      },
    };
    const fixture = await makeRejectFixture("cinematic-ready-depth", false, adapter);
    const plan = await makeCinematicPlan(fixture.plan);
    try {
      const renderPromise = fixture.renderer.render(plan);
      await waitFor(() => fixture.child.posted.length === 1);
      expect(calls).toHaveLength(1);
      const command = fixture.child.posted[0] as {
        input: { compositionProps: { visualClips: Array<{ cinematic?: { depthMapSrc?: string } }> } };
      };
      expect(command.input.compositionProps.visualClips[0]?.cinematic?.depthMapSrc)
        .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/[0-9a-f]{64}$/);
      replyWithSuccessfulRender(fixture.child);
      const result = await renderPromise;
      expect(result).toMatchObject({ success: true });
      if (!result.success) return;
      expect(result.slot.evidence.cinematic).toMatchObject({
        schemaVersion: 1,
        preset: "cinematic-dolly-in",
        model: "depth-anything-v2-small",
        inputSha256: fixture.plan.shot.visualSource.contentSha256,
        width: 1080,
        height: 1920,
      });
      const depthEvidence = result.slot.evidence.cinematic!;
      const publishedDepthPath = path.join(fixture.root, "workspace", depthEvidence.depthMapPath);
      expect(fs.existsSync(publishedDepthPath)).toBe(true);
      expect(crypto.createHash("sha256").update(fs.readFileSync(publishedDepthPath)).digest("hex"))
        .toBe(depthEvidence.outputSha256);
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when cinematic depth estimation is blocked", async () => {
    const adapter: DepthAdapterLike = {
      estimateDepth: async () => ({ state: "blocked", code: "model_not_ready", message: "depth model is unavailable" }),
    };
    const fixture = await makeRejectFixture("cinematic-blocked-depth", false, adapter);
    const plan = await makeCinematicPlan(fixture.plan);
    try {
      const result = await fixture.renderer.render(plan);
      expect(result).toMatchObject({ success: false, canceled: false });
      if (!result.success) expect(result.error).toContain("model_not_ready");
      expect(fixture.child.posted).toHaveLength(0);
    } finally {
      await fixture.renderer.dispose();
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

async function makePlan(chapter: Awaited<ReturnType<typeof makeChapterManifestV2>>): Promise<RemotionShotPlanV1> {
  const shot = chapter.shots[0]!;
  const hashInput = {
    schemaVersion: 1 as const,
    target: "shot" as const,
    projectId: chapter.projectId,
    chapterId: chapter.chapterId,
    renderSettings: chapter.renderSettings,
    visualKind: "image" as const,
    shot,
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
    inputHash: await sha256CanonicalJson(hashInput),
  };
}

async function makeCinematicPlan(plan: RemotionShotPlanV1): Promise<RemotionShotPlanV1> {
  const cinematic = {
    preset: "cinematic-dolly-in" as const,
    parallaxStrength: 0.5,
    dofAperture: 0.25,
  };
  return {
    ...plan,
    cinematic,
    inputHash: await sha256CanonicalJson({
      schemaVersion: 1 as const,
      target: "shot" as const,
      projectId: plan.projectId,
      chapterId: plan.chapterId,
      renderSettings: plan.renderSettings,
      visualKind: plan.visualKind,
      shot: plan.shot,
      cinematic,
    }),
  };
}

function replyWithSuccessfulRender(child: FakeUtilityProcess): void {
  const command = child.posted[0] as { requestId: string; input: { jobId: string; outputPath: string } };
  fs.mkdirSync(path.dirname(command.input.outputPath), { recursive: true });
  fs.writeFileSync(command.input.outputPath, "remotion-mp4", "utf8");
  child.reply({
    kind: "result",
    requestId: command.requestId,
    result: {
      success: true,
      jobId: command.input.jobId,
      outputPath: command.input.outputPath,
      composition: { id: "StoryboardShot", width: 1080, height: 1920, fps: 30, durationInFrames: 60 },
    },
  });
}

async function makeRejectFixture(label: string, symlinkParent = false, depthAdapter?: DepthAdapterLike) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mystudio-shot-${label}-`));
  const projectRoot = path.join(root, "project");
  const bundlePath = path.join(root, "bundle");
  const imagePath = path.join(projectRoot, "images", "shot-001.png");
  const imageBytes = Buffer.from("image", "utf8");
  const imageSha256 = crypto.createHash("sha256").update(imageBytes).digest("hex");
  const audioBytes = Buffer.from("bound-audio", "utf8");
  const audioSha256 = crypto.createHash("sha256").update(audioBytes).digest("hex");
  const voice = await makeShotAudioBindingV2({ sourceFingerprint: audioSha256 });
  const audioPath = path.join(projectRoot, voice.source.relativePath);
  const child = new FakeUtilityProcess();
  let resolvedVisualPath = imagePath;
  fs.mkdirSync(bundlePath, { recursive: true });
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, imageBytes);
  fs.writeFileSync(path.join(bundlePath, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
    compositionId: "DaojieTimeline",
    contentHash: "a".repeat(64),
  }), "utf8");
  if (symlinkParent) {
    const shotParent = path.dirname(path.dirname(audioPath));
    const outsideShot = path.join(root, "outside-shot");
    fs.mkdirSync(path.join(outsideShot, "voice"), { recursive: true });
    fs.mkdirSync(path.dirname(shotParent), { recursive: true });
    fs.symlinkSync(outsideShot, shotParent, "dir");
    fs.writeFileSync(path.join(outsideShot, "voice", path.basename(audioPath)), audioBytes);
  } else {
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    fs.writeFileSync(audioPath, audioBytes);
  }
  const chapter = await makeChapterManifestV2();
  chapter.shots[0]!.visualSource = {
    ...chapter.shots[0]!.visualSource,
    contentSha256: imageSha256,
  };
  chapter.shots[0]!.sourceFingerprint = imageSha256;
  chapter.shots[0]!.audioBindings = [voice];
  const plan = await makePlan(chapter);
  const renderer = new RemotionShotRenderer({
    workspaceRoot: path.join(root, "workspace"),
    projectRootForProject: () => projectRoot,
    bundlePath,
    workerPath: "/app/remotion-render-worker.cjs",
    cwd: "/runtime/remotion",
    binariesDirectory: "/app/binaries",
    remotionVersion: "4.0.499",
      resolveSourcePath: () => resolvedVisualPath,
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
    depthAdapter,
  });
  return {
    root,
    audioPath,
    imagePath,
    child,
    plan,
    renderer,
    setResolveSourcePath: (value: string) => { resolvedVisualPath = value; },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for shot render worker");
}
