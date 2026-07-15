import { describe, expect, it, vi } from "vitest";
import type {
  EditingProjectV1,
  TimelineRenderEvidence,
} from "@/types/editing";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import {
  buildChapterEditingProject,
  createTimelineRenderRecord,
  renderChapterEditingProject,
} from "./chapter-editing-pipeline";

describe("chapter editing pipeline", () => {
  it("builds and reuses the same automatic EditingProject from one source snapshot", async () => {
    const input = fixtureInput();
    const first = await buildChapterEditingProject({
      ...input,
      existingProjects: [],
      runId: "run-1",
      editingProjectId: "editing-1",
      now: sequenceClock(),
    });
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = await buildChapterEditingProject({
      ...input,
      existingProjects: [first.result.project],
      runId: "run-2",
      editingProjectId: "editing-2",
      now: sequenceClock(100),
    });
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.result.reusedExistingDraft).toBe(true);
    expect(second.result.project.id).toBe("editing-1");
    expect(second.result.project.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("compiles a typed plan, rejects renderer identity drift and creates a durable record", async () => {
    const project = await editingProject();
    const evidence = renderEvidence("job-1");
    const render = vi.fn(async () => ({ success: true as const, evidence }));
    const result = await renderChapterEditingProject({
      project,
      jobId: "job-1",
      createdAt: 20,
      render,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      editingProjectId: project.id,
      editingRevision: project.revision,
    }));
    expect(createTimelineRenderRecord(project, result.evidence, 21)).toEqual({
      success: true,
      value: expect.objectContaining({
        editingProjectId: project.id,
        editingRevision: project.revision,
        evidence,
      }),
    });

    const drift = await renderChapterEditingProject({
      project,
      jobId: "job-2",
      createdAt: 22,
      render: async () => ({
        success: true,
        evidence: renderEvidence("other-job"),
      }),
    });
    expect(drift).toEqual(expect.objectContaining({
      success: false,
      jobId: "job-2",
    }));
  });
});

async function editingProject(): Promise<EditingProjectV1> {
  const result = await buildChapterEditingProject({
    ...fixtureInput(),
    existingProjects: [],
    runId: "run-1",
    editingProjectId: "editing-1",
    now: sequenceClock(),
  });
  if (!result.success) throw new Error(result.run.error);
  return result.result.project;
}

function fixtureInput() {
  const storyboards: StoryboardItem[] = [storyboard(1), storyboard(2)];
  const productionTracks: ProductionTrack[] = [track(1), track(2)];
  productionTracks[1]!.selectedVideoId = "candidate-2";
  const videoCandidates: VideoCandidate[] = [{
    id: "candidate-2",
    trackId: "track-2",
    provider: "ffmpeg-local",
    filePath: "/track-2.mp4",
    state: "ready",
    stale: false,
    sourceFingerprint: "candidate-fingerprint-2",
    outputVersion: 1,
    createdAt: 1,
  }];
  return {
    projectId: "project-1",
    episodeId: "episode-1",
    projectName: "测试项目",
    aspectRatio: "9:16",
    storyboards,
    productionTracks,
    videoCandidates,
  };
}

function storyboard(index: number): StoryboardItem {
  return {
    id: `sb-${index}`,
    episodeId: "episode-1",
    index,
    trackKey: `track-key-${index}`,
    trackId: `track-${index}`,
    duration: 4,
    durationTarget: 4,
    prompt: `prompt ${index}`,
    videoDesc: `video ${index}`,
    assetIds: [],
    mediaRef: { kind: "image", path: `/shot-${index}.png` },
    audioRef: { kind: "audio", path: `/voice-${index}.wav` },
    state: "ready",
    line: `台词 ${index}`,
    ttsSpokenText: `口播 ${index}`,
    sourceFingerprint: `storyboard-fingerprint-${index}`,
    outputVersion: 1,
  };
}

function track(index: number): ProductionTrack {
  return {
    id: `track-${index}`,
    episodeId: "episode-1",
    trackKey: `track-key-${index}`,
    storyboardIds: [`sb-${index}`],
    prompt: `track prompt ${index}`,
    duration: 4,
    candidateVideoIds: [],
    state: "ready",
    stale: false,
    sourceFingerprint: `track-fingerprint-${index}`,
    outputVersion: 1,
  };
}

function renderEvidence(jobId: string): TimelineRenderEvidence {
  const hash = "a".repeat(64);
  return {
    jobId,
    path: "/tmp/output.mp4",
    sizeBytes: 1024,
    mtimeMs: 2,
    sha256: hash,
    duration: 8,
    width: 1080,
    height: 1920,
    streams: ["video", "audio"],
    snapshotHash: hash,
    snapshotPath: "/tmp/editing-project.json",
    renderPlanPath: "/tmp/render-plan.json",
    inputManifestPath: "/tmp/input-manifest.json",
    filterGraphPath: "/tmp/filter-graph.txt",
    logPath: "/tmp/ffmpeg.log",
    ffprobePath: "/tmp/ffprobe.json",
  };
}

function sequenceClock(start = 1) {
  let value = start;
  return () => value++;
}
