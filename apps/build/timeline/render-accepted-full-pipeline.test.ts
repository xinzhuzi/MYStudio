import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import type {
  HyperFramesOverlayArtifactV1,
  VideoUseChapterArtifactV1,
} from "@rendering/contracts/video-workflow";
import {
  assertAcceptedArtifactProjection,
  assertFormalChapterSlotIdentity,
  assertStableFileInventory,
  invokeFormalChapterRenderer,
  materializeIsolatedShotWorkspace,
  projectAcceptedTimelinePlan,
} from "./render-accepted-full-pipeline-core";

vi.mock("electron", () => ({
  app: { quit: vi.fn() },
  utilityProcess: { fork: vi.fn() },
}));

import {
  assertFormalSlotSourceInventory,
  finishFormalRenderer,
  hashFormalRawFileSha256,
  resolveInstalledRemotionWorkerPath,
  resolveFormalElectronMain,
  resolveFormalProjectRoot,
  resolveFormalSlotSourceRoot,
  resolveFormalTimelinePlanPath,
} from "./render-accepted-full-pipeline";

function makePlan(visualCount = 43, textCount = 0): TimelineRenderPlan {
  return {
    clips: [
      ...Array.from({ length: visualCount }, (_, index) => ({
        id: `clip-${index + 1}`,
        trackKind: "video",
        source: {
          path: `outputs/shots/chapter-001/shot-${index + 1}/current.mp4`,
          evidence: {
            storyboardId: `shot-${String(index + 1).padStart(3, "0")}`,
            subtitleAuthority: { mode: "source-embedded" },
          },
        },
      })),
      ...Array.from({ length: textCount }, (_, index) => ({
        id: `text-${index + 1}`,
        trackKind: "text",
      })),
    ],
    projectId: "project-1",
    episodeId: "chapter-001",
    editingRevision: 9,
    renderSettings: { subtitleMode: "none" },
  } as TimelineRenderPlan;
}

function makeSlots(count = 43): RemotionCurrentSlotV1[] {
  return Array.from({ length: count }, (_, index) => ({
    target: {
      kind: "shot",
      chapterId: "chapter-001",
      shotId: `shot-${String(index + 1).padStart(3, "0")}`,
      shotRevision: 1,
    },
  })) as RemotionCurrentSlotV1[];
}

describe("invokeFormalChapterRenderer", () => {
  it("invokes the formal renderer exactly once with all 43 current shot slots", async () => {
    const plan = makePlan();
    const currentShotSlots = makeSlots();
    const slot = { target: { kind: "chapter" } } as RemotionCurrentSlotV1;
    const render = vi.fn(async () => ({ success: true as const, slot }));

    await expect(invokeFormalChapterRenderer({
      renderer: { render },
      plan,
      currentShotSlots,
      expectedVisualCount: 43,
    })).resolves.toBe(slot);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith({ plan, currentShotSlots });
  });

  it("fails before rendering when the validated slot count is incomplete", async () => {
    const render = vi.fn();

    await expect(invokeFormalChapterRenderer({
      renderer: { render },
      plan: makePlan(),
      currentShotSlots: makeSlots(42),
      expectedVisualCount: 43,
    })).rejects.toThrow("expected 43 current shot slots, received 42");

    expect(render).not.toHaveBeenCalled();
  });

  it("fails before rendering when the accepted plan does not contain 43 visuals", async () => {
    const render = vi.fn();

    await expect(invokeFormalChapterRenderer({
      renderer: { render },
      plan: makePlan(42),
      currentShotSlots: makeSlots(),
      expectedVisualCount: 43,
    })).rejects.toThrow("expected 43 visual clips, received 42");

    expect(render).not.toHaveBeenCalled();
  });

  it("fails before rendering when the accepted plan contains a second subtitle layer", async () => {
    const render = vi.fn();

    await expect(invokeFormalChapterRenderer({
      renderer: { render },
      plan: makePlan(43, 1),
      currentShotSlots: makeSlots(),
      expectedVisualCount: 43,
    })).rejects.toThrow("expected 0 text clips, received 1");

    expect(render).not.toHaveBeenCalled();
  });

  it("fails with a bounded timeout when the utility renderer never settles", async () => {
    const render = vi.fn(() => new Promise<never>(() => undefined));

    await expect(invokeFormalChapterRenderer({
      renderer: { render },
      plan: makePlan(),
      currentShotSlots: makeSlots(),
      expectedVisualCount: 43,
      timeoutMs: 5,
    })).rejects.toThrow("timed out after 5ms");

    expect(render).toHaveBeenCalledOnce();
  });
});

describe("formal installed runtime lifecycle", () => {
  it("prefers an explicit or registered external project root before the legacy bucket", () => {
    const base = {
      productUserData: "/user-data",
      projectId: "project-1",
    };
    expect(resolveFormalProjectRoot({
      ...base,
      explicitProjectRoot: "/external/MA",
      registeredProjectRoot: "/registered/MA",
    })).toBe("/external/MA");
    expect(resolveFormalProjectRoot({ ...base, registeredProjectRoot: "/registered/MA" }))
      .toBe("/registered/MA");
    expect(resolveFormalProjectRoot(base)).toBe("/user-data/projects/_p/project-1");
  });

  it("resolves the packaged worker from app.asar.unpacked", () => {
    expect(resolveInstalledRemotionWorkerPath("/Applications/漫影工作室.app/Contents/Resources"))
      .toBe("/Applications/漫影工作室.app/Contents/Resources/app.asar.unpacked/out/main/remotion-render-worker.cjs");
  });

  it("prefers an explicit formal timeline plan without weakening source-run fallback", () => {
    expect(resolveFormalTimelinePlanPath({
      explicitPlanPath: "/evidence/timeline-render-plan-input.json",
      sourceRunDir: "/source-run",
    })).toBe("/evidence/timeline-render-plan-input.json");
    expect(resolveFormalTimelinePlanPath({ sourceRunDir: "/source-run" }))
      .toBe("/source-run/timeline-render-plan.json");
  });

  it("keeps an explicit slot source root separate from the production Remotion fallback", () => {
    const productionRemotionRoot = "/production/remotion";

    expect(resolveFormalSlotSourceRoot({
      explicitSlotSourceRoot: "/archive/r23/formal-workspace",
      productionRemotionRoot,
    })).toBe("/archive/r23/formal-workspace");
    expect(resolveFormalSlotSourceRoot({
      explicitSlotSourceRoot: "  ",
      productionRemotionRoot,
    })).toBe(productionRemotionRoot);
  });

  it("preserves the failure exit code before requesting Electron shutdown", () => {
    const lifecycle = { exit: vi.fn() };
    const previousExitCode = process.exitCode;
    try {
      finishFormalRenderer(1, lifecycle);

      expect(process.exitCode).toBe(1);
      expect(lifecycle.exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("fails clearly when the Electron-hosted bootstrap did not inject main-process APIs", () => {
    expect(() => resolveFormalElectronMain(undefined)).toThrow("Electron main bridge is unavailable");
  });

  it("hashes raw asar bytes without traversing Electron's virtual archive filesystem", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-formal-asar-"));
    const asarPath = path.join(root, "app.asar");
    fs.writeFileSync(asarPath, "raw-asar-bytes", "utf8");
    try {
      await expect(hashFormalRawFileSha256(asarPath)).resolves
        .toBe("9e13bc081251cfa085806465f01484cea493f1578d5313861b621139f049647d");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("projectAcceptedTimelinePlan", () => {
  it("maps every accepted relative visual path through project-file URLs", () => {
    const plan = makePlan(2);

    const projected = projectAcceptedTimelinePlan(plan, {
      projectId: "project-1",
      chapterId: "chapter-001",
      revision: 9,
      expectedVisualCount: 2,
    });

    expect(projected.clips.map((clip) => clip.source.path)).toEqual([
      "project-file://project-1/outputs/shots/chapter-001/shot-1/current.mp4",
      "project-file://project-1/outputs/shots/chapter-001/shot-2/current.mp4",
    ]);
  });
});

describe("assertAcceptedArtifactProjection", () => {
  it("proves accepted video-use timing and non-text HyperFrames windows match the plan", () => {
    const plan = makePlan(2);
    plan.clips[0].startUs = 0;
    plan.clips[0].durationUs = 4_200_000;
    plan.clips[0].trimStartUs = 0;
    plan.clips[1].startUs = 4_200_000;
    plan.clips[1].durationUs = 3_000_000;
    plan.clips[1].trimStartUs = 500_000;
    const videoUse = {
      projectId: "project-1",
      chapterId: "chapter-001",
      revision: 9,
      status: "accepted",
      stage: "ready",
      mode: "editable-edl",
      evidence: { artifactSha256: "a".repeat(64), inputSha256: "b".repeat(64) },
      edl: [
        {
          shotId: "shot-001",
          sourcePath: "/production/remotion/outputs/shots/chapter-001/shot-1/current.mp4",
          sourceInS: 0,
          sourceOutS: 4.2,
          timelineStartS: 0,
          durationS: 4.2,
        },
        {
          shotId: "shot-002",
          sourcePath: "/production/remotion/outputs/shots/chapter-001/shot-2/current.mp4",
          sourceInS: 0.5,
          sourceOutS: 3.5,
          timelineStartS: 4.2,
          durationS: 3,
        },
      ],
    } as VideoUseChapterArtifactV1;
    const hyperFrames = {
      projectId: "project-1",
      chapterId: "chapter-001",
      revision: 9,
      status: "accepted",
      sourceArtifactSha256: "a".repeat(64),
      inputSha256: "b".repeat(64),
      outputPath: "/production/video-use/hyperframes-overlay.mov",
      outputSha256: "c".repeat(64),
      windows: [
        { templateId: "film-grain", parameters: {} },
        { templateId: "light-leak", parameters: {} },
      ],
    } as HyperFramesOverlayArtifactV1;

    expect(assertAcceptedArtifactProjection({
      plan,
      videoUse,
      hyperFrames,
      productionRemotionRoot: "/production/remotion",
      expectedVisualCount: 2,
    })).toEqual({ videoUseEdlCount: 2, hyperFramesWindowCount: 2 });

    hyperFrames.windows[0].templateId = "unknown-text-capable-template";
    expect(() => assertAcceptedArtifactProjection({
      plan,
      videoUse,
      hyperFrames,
      productionRemotionRoot: "/production/remotion",
      expectedVisualCount: 2,
    })).toThrow("HyperFrames template is not verified as non-text");
  });
});

describe("assertFormalChapterSlotIdentity", () => {
  it("rejects a stale chapter revision even when the job id matches", () => {
    const target = {
      kind: "chapter" as const,
      chapterId: "chapter-001",
      editingProjectId: "editing-1",
      editingRevision: 8,
    };
    const identity = {
      projectId: "project-1",
      target,
      inputHash: "a".repeat(64),
      bundleContentHash: "b".repeat(64),
      renderSettingsHash: "c".repeat(64),
    };
    const slot = {
      schemaVersion: 1,
      projectId: "project-1",
      target,
      jobPath: "jobs/chapter/chapter-001/current.json",
      evidencePath: "evidence/chapters/chapter-001/current.json",
      outputPath: "outputs/chapters/chapter-001/current.mp4",
      publishedAt: 1,
      job: {
        schemaVersion: 1,
        ...identity,
        jobId: "job-1",
        templateVersion: "1.0.0",
        remotionVersion: "4.0.508",
        status: "succeeded",
        attempt: 1,
        progress: 1,
        createdAt: 1,
        completedAt: 2,
        outputPath: "outputs/chapters/chapter-001/current.mp4",
        evidencePath: "evidence/chapters/chapter-001/current.json",
      },
      evidence: {
        schemaVersion: 1,
        ...identity,
        jobId: "job-1",
        templateVersion: "1.0.0",
        remotionVersion: "4.0.508",
        attempt: 1,
        compositionId: "ChapterVideo",
        renderer: { requested: "remotion", actual: "remotion" },
        outputPath: "outputs/chapters/chapter-001/current.mp4",
        sizeBytes: 100,
        mtimeMs: 2,
        sha256: "d".repeat(64),
        width: 1920,
        height: 1080,
        durationUs: 1_000_000,
        streams: [
          { kind: "video", codec: "h264", width: 1920, height: 1080 },
          { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
        ],
        inputManifestPath: "chapters/chapter-001.json",
        startedAt: 1,
        completedAt: 2,
      },
    } as RemotionCurrentSlotV1;

    expect(() => assertFormalChapterSlotIdentity(slot, {
      projectId: "project-1",
      chapterId: "chapter-001",
      editingProjectId: "editing-1",
      editingRevision: 9,
    })).toThrow("formal renderer target identity mismatch");
  });
});

describe("assertStableFileInventory", () => {
  it("rejects a concurrent source change", () => {
    const before = {
      "/repo/main.ts": { path: "/repo/main.ts", sizeBytes: 10, mtimeMs: 1, sha256: "a".repeat(64) },
    };
    const after = {
      "/repo/main.ts": { path: "/repo/main.ts", sizeBytes: 11, mtimeMs: 2, sha256: "b".repeat(64) },
    };

    expect(() => assertStableFileInventory(before, after, "workflow collision files"))
      .toThrow("workflow collision files changed concurrently");
  });

  it("rejects slot-source media that differs from the production shot inventory", () => {
    const production = [{
      shotId: "shot-001",
      shotRevision: 3,
      path: "/production/shot-001.mp4",
      sizeBytes: 100,
      mtimeMs: 1,
      sha256: "a".repeat(64),
    }];
    const matchingArchive = [{
      ...production[0],
      path: "/archive/shot-001.mp4",
      mtimeMs: 2,
    }];

    expect(() => assertFormalSlotSourceInventory(production, matchingArchive)).not.toThrow();
    expect(() => assertFormalSlotSourceInventory(production, [{
      ...matchingArchive[0],
      sha256: "b".repeat(64),
    }])).toThrow("slot-source media inventory does not match production");
  });
});

describe("materializeIsolatedShotWorkspace", () => {
  it("copies the validated shot output, job, and evidence into an isolated workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "formal-render-workspace-"));
    const sourceWorkspace = path.join(root, "source");
    const targetWorkspace = path.join(root, "target");
    const sourceTimestamp = new Date("2026-08-16T00:00:00.000Z");
    const relativePaths = [
      "outputs/shots/chapter-001/shot-001/current.mp4",
      "jobs/shot/chapter-001/shot-001/current.json",
      "evidence/shots/chapter-001/shot-001/current.json",
    ];
    try {
      for (const relativePath of relativePaths) {
        const sourcePath = path.join(sourceWorkspace, relativePath);
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, relativePath);
        fs.utimesSync(sourcePath, sourceTimestamp, sourceTimestamp);
      }

      await expect(materializeIsolatedShotWorkspace({
        sourceWorkspace,
        targetWorkspace,
        currentShotSlots: makeSlots(1),
      })).resolves.toBe(1);

      for (const relativePath of relativePaths) {
        const sourceStat = fs.statSync(path.join(sourceWorkspace, relativePath));
        const targetStat = fs.statSync(path.join(targetWorkspace, relativePath));
        expect(targetStat.ino).not.toBe(sourceStat.ino);
        expect(Math.floor(targetStat.mtimeMs)).toBe(Math.floor(sourceStat.mtimeMs));
        expect(fs.readFileSync(path.join(targetWorkspace, relativePath)))
          .toEqual(fs.readFileSync(path.join(sourceWorkspace, relativePath)));
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
