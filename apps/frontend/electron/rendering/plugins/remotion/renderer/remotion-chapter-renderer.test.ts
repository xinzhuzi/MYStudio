// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EditingProjectV1, TimelineRenderPlan } from "@/types/editing";
import type { RemotionChapterManifestV2, RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import {
  makeChapterManifestV2,
  makeCurrentSlot,
} from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import {
  createRemotionChapterRenderIdentity,
  RemotionChapterRenderer,
  pathsEquivalent,
  resolveEditableChapterVisualInput,
} from "./remotion-chapter-renderer";

describe("Remotion chapter identity", () => {
  it("changes for manifest rendering fields, mapped voice intervals and shot output SHA", async () => {
    const slot = makeCurrentSlot();
    const plan = makePlan(slot);
    const manifest = await manifestForPlan(plan);
    const base = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: [slot],
      chapterManifest: manifest,
      bundleContentHash: "d".repeat(64),
    });

    const manifestChanged = structuredClone(manifest);
    manifestChanged.sharedAudioBindings[0]!.volume = 0.5;
    const changedManifestIdentity = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: [slot],
      chapterManifest: manifestChanged,
      bundleContentHash: "d".repeat(64),
    });

    const voiceChanged = structuredClone(manifest);
    voiceChanged.shots[0]!.audioBindings[0]!.shotStartUs += 100_000;
    const changedVoiceIdentity = await createRemotionChapterRenderIdentity({
      plan,
      currentShotSlots: [slot],
      chapterManifest: voiceChanged,
      bundleContentHash: "d".repeat(64),
    });

    const slotChanged = structuredClone(slot);
    slotChanged.evidence.sha256 = "f".repeat(64);
    const planForChangedSlot = structuredClone(plan);
    planForChangedSlot.clips[0]!.source.evidence.remotionEvidenceSha256 = slotChanged.evidence.sha256;
    const changedSlotIdentity = await createRemotionChapterRenderIdentity({
      plan: planForChangedSlot,
      currentShotSlots: [slotChanged],
      chapterManifest: manifest,
      bundleContentHash: "d".repeat(64),
    });

    expect(new Set([
      base.inputHash,
      changedManifestIdentity.inputHash,
      changedVoiceIdentity.inputHash,
      changedSlotIdentity.inputHash,
    ])).toHaveLength(4);
  });
});

describe("Remotion chapter source projection", () => {
  it("treats macOS /var and /private/var aliases as the same source path", () => {
    expect(pathsEquivalent("/var/tmp/shot-001.mp4", "/private/var/tmp/shot-001.mp4")).toBe(true);
    expect(resolveEditableChapterVisualInput({
      requestedSourcePath: "/private/var/tmp/shot-001.mp4",
      currentSlotPath: "/var/tmp/shot-001.mp4",
      currentSlotSha256: "a".repeat(64),
    })).toEqual({
      sourcePath: "/private/var/tmp/shot-001.mp4",
      expectedSha256: "a".repeat(64),
      label: "shot_slot",
    });
  });

  it("still requires derived evidence for a different source file", () => {
    expect(() => resolveEditableChapterVisualInput({
      requestedSourcePath: "/var/tmp/shot-002.mp4",
      currentSlotPath: "/var/tmp/shot-001.mp4",
      currentSlotSha256: "a".repeat(64),
    })).toThrow("EDL 派生输入未通过 video-use gate");
  });

  it("consumes a verified video-use derived EDL input instead of silently reverting to the shot slot", () => {
    const derived = resolveEditableChapterVisualInput({
      requestedSourcePath: "/project/video-use/r2/derived-inputs/shot-001.mp4",
      currentSlotPath: "/project/remotion/outputs/shots/chapter-001/shot-001/current.mp4",
      currentSlotSha256: "a".repeat(64),
      sourceFingerprint: "b".repeat(64),
      gate: {
        accepted: true,
        mode: "editable-edl",
        videoUseArtifactSha256: "b".repeat(64),
        hyperFramesStatus: "noop",
        videoUseDerivedInputs: [{
          schemaVersion: 1,
          kind: "padded-video",
          derivation: "ffmpeg-tpad-clone-apad",
          sourcePath: "/project/remotion/outputs/shots/chapter-001/shot-001/current.mp4",
          sourceSha256: "a".repeat(64),
          sourceDurationUs: 1,
          derivedPath: "/project/video-use/r2/derived-inputs/shot-001.mp4",
          derivedSha256: "c".repeat(64),
          derivedDurationUs: 2,
          derivedRevision: 2,
          createdAt: 1,
        }],
      },
    });
    expect(derived).toEqual({
      sourcePath: "/project/video-use/r2/derived-inputs/shot-001.mp4",
      expectedSha256: "c".repeat(64),
      label: "derived_input",
    });
  });
});

describe("RemotionChapterRenderer manifest preflight", () => {
  it("stops before capability creation or worker startup when the current manifest is missing", async () => {
    const slot = makeCurrentSlot();
    const fork = vi.fn();
    const renderer = new RemotionChapterRenderer({
      workspaceRoot: "/tmp/remotion-chapter-renderer-test",
      bundlePath: "/tmp/remotion-bundle-not-needed",
      workerPath: "/tmp/remotion-worker-not-needed.cjs",
      cwd: "/tmp",
      binariesDirectory: "/tmp",
      remotionVersion: "4.0.499",
      resolveSourcePath: (value) => value,
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/tmp/browser" }),
      fork,
      emitProgress: () => undefined,
      chapterManifestService: { read: vi.fn(async () => undefined) },
      projectRootForProject: () => "/tmp/project-a",
    });

    const result = await renderer.render({ plan: makePlan(slot), currentShotSlots: [slot] });

    expect(result).toMatchObject({ success: false, canceled: false, error: expect.stringContaining("manifest") });
    expect(fork).not.toHaveBeenCalled();
    await renderer.dispose();
  });

  it("stops before capability creation or worker startup on manifest identity or source SHA failure", async () => {
    const slot = makeCurrentSlot();
    const fork = vi.fn();
    const renderer = new RemotionChapterRenderer({
      workspaceRoot: "/tmp/remotion-chapter-renderer-test",
      bundlePath: "/tmp/remotion-bundle-not-needed",
      workerPath: "/tmp/remotion-worker-not-needed.cjs",
      cwd: "/tmp",
      binariesDirectory: "/tmp",
      remotionVersion: "4.0.499",
      resolveSourcePath: (value) => value,
      probeBrowser: async () => ({ status: { state: "ready", remotionVersion: "4.0.499" }, executablePath: "/tmp/browser" }),
      fork,
      emitProgress: () => undefined,
      chapterManifestService: { read: vi.fn(async () => { throw new Error("source_sha256_mismatch"); }) },
      projectRootForProject: () => "/tmp/project-a",
    });

    const result = await renderer.render({ plan: makePlan(slot), currentShotSlots: [slot] });

    expect(result).toMatchObject({ success: false, error: "source_sha256_mismatch" });
    expect(fork).not.toHaveBeenCalled();
    await renderer.dispose();
  });
});

async function manifestForPlan(plan: TimelineRenderPlan): Promise<RemotionChapterManifestV2> {
  const manifest = await makeChapterManifestV2();
  return {
    ...manifest,
    projectId: plan.projectId,
    chapterId: plan.episodeId,
    sourceSnapshotHash: plan.sourceSnapshotHash,
    requiredShotIds: ["shot-001"],
    shots: [{
      ...manifest.shots[0]!,
      shotId: "shot-001",
      storyboardId: "shot-001",
    }],
  };
}

function makePlan(slot: RemotionCurrentSlotV1): TimelineRenderPlan {
  if (slot.target.kind !== "shot") throw new Error("fixture target must be shot");
  const visual = {
    id: "visual-shot-001",
    trackId: "visual",
    name: "shot-001",
    source: {
      kind: "storyboardVideo" as const,
      path: slot.outputPath,
      evidence: {
        storyboardId: slot.target.shotId,
        remotionJobId: slot.job.jobId,
        remotionEvidenceSha256: slot.evidence.sha256,
        outputVersion: slot.target.shotRevision,
      },
    },
    startUs: 0,
    durationUs: 2_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
  const project: EditingProjectV1 = {
    schemaVersion: 1,
    id: "editing-001",
    projectId: slot.projectId,
    episodeId: slot.target.chapterId,
    name: "chapter",
    revision: 1,
    sourceSnapshotHash: "b".repeat(64),
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
    tracks: [{ id: "visual", kind: "video", name: "visual", order: 0, clipIds: [visual.id], muted: false, locked: false }],
    clips: [visual],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const compiled = compileTimelineRenderPlan(project, { jobId: "chapter-plan", createdAt: 1 });
  if (!compiled.success) throw new Error(compiled.issues.map((issue) => issue.message).join(";"));
  return compiled.value;
}


describe("分层资产进章节身份(08-19 multilayer Child1)", () => {
  it("层文件 SHA 进身份;无层=与既有一致;层内容变=身份变", async () => {
    const slot = makeCurrentSlot();
    const plan = makePlan(slot);
    // 分层发现只认静帧(image)镜;fixture 默认 storyboardVideo,测试内改写。
    (plan.clips[0] as unknown as { trackKind: string }).trackKind = "image";
    const manifest = await manifestForPlan(plan);
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mlp-identity-"));
    const layerDir = path.join(root, "layers", plan.episodeId, plan.clips[0]!.id);
    await fs.promises.mkdir(layerDir, { recursive: true });
    await fs.promises.writeFile(path.join(layerDir, "background.png"), "bg-v1");
    await fs.promises.writeFile(path.join(layerDir, "subject.png"), "subj-v1");

    const identityInput = {
      plan,
      currentShotSlots: [slot] as const,
      chapterManifest: manifest,
      bundleContentHash: "d".repeat(64),
    };
    const base = await createRemotionChapterRenderIdentity(identityInput);
    const withLayers = await createRemotionChapterRenderIdentity({ ...identityInput, layerWorkspaceRoot: root });
    // 有层 → 身份变化(层 SHA 已进 inputHash)
    expect(withLayers.inputHash).not.toBe(base.inputHash);

    // 层内容变更 → 身份再变(capability URL 不进哈希,SHA 是唯一内容通道)
    await fs.promises.writeFile(path.join(layerDir, "subject.png"), "subj-v2");
    const contentChanged = await createRemotionChapterRenderIdentity({ ...identityInput, layerWorkspaceRoot: root });
    expect(contentChanged.inputHash).not.toBe(withLayers.inputHash);

    // 无层目录 → 与不传 layerWorkspaceRoot 字节一致(零缓存误伤)
    const emptyRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mlp-empty-"));
    const noLayers = await createRemotionChapterRenderIdentity({ ...identityInput, layerWorkspaceRoot: emptyRoot });
    expect(noLayers.inputHash).toBe(base.inputHash);
  });
});
