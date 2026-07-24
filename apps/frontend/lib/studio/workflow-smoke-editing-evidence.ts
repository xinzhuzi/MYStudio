import { useEditingStore } from "@/stores/editing-store";
import type { EditingProjectV1, TimelineRenderRecord } from "@/types/editing";

export interface SeedSmokeEditingEvidenceInput {
  projectId: string;
  editingProjectId: string;
  episodeId: string;
  storyboardId: string;
  trackId: string;
  videoId: string;
  videoPath: string;
  now: number;
}

export function resetSmokeEditingStore(projectId: string) {
  useEditingStore.setState({
    activeProjectId: projectId,
    editingProjects: {},
    currentEditingProjectIdByEpisode: {},
    autoEditingRuns: {},
    autoEditingRunIdsByEpisode: {},
    timelineRenderRecordsByEditingProjectId: {},
    historyByEditingProjectId: {},
    persistenceWarnings: [],
  });
}

export function seedSmokeEditingEvidence({
  projectId,
  editingProjectId,
  episodeId,
  storyboardId,
  trackId,
  videoId,
  videoPath,
  now,
}: SeedSmokeEditingEvidenceInput) {
  const sourceSnapshotHash = `smoke-source-${episodeId}`;
  const project: EditingProjectV1 = {
    schemaVersion: 1,
    id: editingProjectId,
    projectId,
    episodeId,
    name: "Smoke 自动剪辑草案",
    revision: 1,
    sourceSnapshotHash,
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
      {
        id: "smoke-editing-video-track",
        kind: "video",
        name: "主画面",
        order: 0,
        clipIds: ["smoke-editing-clip-1"],
        muted: false,
        locked: false,
      },
    ],
    clips: [
      {
        id: "smoke-editing-clip-1",
        trackId: "smoke-editing-video-track",
        name: "Smoke 分镜 1",
        source: {
          kind: "videoCandidate",
          path: videoPath,
          evidence: {
            storyboardId,
            trackId,
            candidateId: videoId,
          },
        },
        startUs: 0,
        durationUs: 5_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 0,
        muted: true,
      },
    ],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: now,
    updatedAt: now,
  };
  const hash = "a".repeat(64);
  const record: TimelineRenderRecord = {
    projectId,
    episodeId,
    editingProjectId: project.id,
    editingRevision: project.revision,
    sourceSnapshotHash,
    completedAt: now,
    evidence: {
      jobId: "smoke-timeline-render-1",
      path: videoPath,
      sizeBytes: 1024,
      mtimeMs: now,
      sha256: hash,
      duration: 5,
      width: 1080,
      height: 1920,
      streams: ["video", "audio"],
      snapshotHash: hash,
      snapshotPath: "/tmp/mystudio-smoke-editing-project.json",
      renderPlanPath: "/tmp/mystudio-smoke-render-plan.json",
      inputManifestPath: "/tmp/mystudio-smoke-input-manifest.json",
      filterGraphPath: "/tmp/mystudio-smoke-filter-graph.txt",
      logPath: "/tmp/mystudio-smoke-ffmpeg.log",
      ffprobePath: "/tmp/mystudio-smoke-ffprobe.json",
    },
  };
  const store = useEditingStore.getState();
  const projectResult = store.saveEditingProject(project);
  if (!projectResult.success) {
    throw new Error(projectResult.issue.message);
  }
  const recordResult = useEditingStore.getState().saveTimelineRenderRecord(record);
  if (!recordResult.success) {
    throw new Error(recordResult.issue.message);
  }
}
