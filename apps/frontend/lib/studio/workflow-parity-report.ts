import type {
  AgentWorkData,
  EntityExtractionResult,
  MediaGenerationTask,
  ProductionTrack,
  ScriptPlan,
  StudioAgentRun,
  StudioManualPreset,
  StudioWorkflowConfig,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import {
  buildStudioFlowData,
  type StudioFlowDataInput,
} from "@/lib/studio/studio-flow-data";
import {
  getStudioManualPreset,
  type StudioManualCatalog,
} from "@/lib/studio/manuals";
import {
  compareToonflowFixtureToStoryboards,
  type ToonflowFixtureParityReport,
  type ToonflowFixtureStoryboardRow,
} from "@/lib/studio/toonflow-fixture-parity";
import type { EditingProjectV1, TimelineRenderRecord } from "@/types/editing";
import { resolveWorkflowTimelineEvidence } from "@/lib/studio/workflow-readiness";

const WORKFLOW_NODE_IDS = [
  "script",
  "scriptPlan",
  "assets",
  "storyboardTable",
  "storyboard",
  "workbench",
] as const;

export type WorkflowParityNodeId = (typeof WORKFLOW_NODE_IDS)[number];
export type WorkflowParityIssueSeverity = "error" | "warning";

export interface WorkflowParityIssue {
  severity: WorkflowParityIssueSeverity;
  code: string;
  message: string;
}

export interface WorkflowParityNodeReport {
  id: WorkflowParityNodeId;
  hasInputEvidence: boolean;
  hasActionEvidence: boolean;
  hasWritebackEvidence: boolean;
  hasReportEvidence: boolean;
}

export interface WorkflowParityEvidenceBoundary {
  seededUiSmoke: boolean;
  visibleWorkflowSmoke: boolean;
  realDaojieVisibleSmoke: boolean;
  realMediaGeneration: boolean;
}

export interface WorkflowParityReportInput extends StudioFlowDataInput {
  agentRuns?: StudioAgentRun[];
  mediaTasks?: MediaGenerationTask[];
  toonflowFixtureRows?: ToonflowFixtureStoryboardRow[];
  workflowConfig?: Pick<StudioWorkflowConfig, "visualManualId" | "directorManualId">;
  manualCatalog?: StudioManualCatalog;
  evidenceBoundary?: Partial<WorkflowParityEvidenceBoundary>;
  episodeId?: string;
  editingProjects?: Record<string, EditingProjectV1>;
  currentEditingProjectIdByEpisode?: Record<string, string>;
  timelineRenderRecordsByEditingProjectId?: Record<string, TimelineRenderRecord>;
}

export interface WorkflowParityReport {
  agentEvidence: {
    modelResponses: number;
    toolWritebacks: number;
    supervisionApprovals: number;
    failedSupervisions: number;
  };
  mediaTaskEvidence: {
    total: number;
    success: number;
    failed: number;
    retryableFailed: number;
    storyboardImageSuccess: number;
    ttsAudioSuccess: number;
    videoSuccess: number;
  };
  toonflowFixture: ToonflowFixtureParityReport;
  nodes: WorkflowParityNodeReport[];
  storyboard: {
    total: number;
    withIndex: number;
    withVideoDesc: number;
    withPrompt: number;
    withTrack: number;
    withDuration: number;
    withAssociateAssetsIds: number;
    withShouldGenerateImageExplicit: number;
    withSourceEvidence: number;
    shouldGenerateImageFalse: number;
  };
  references: {
    storyboardsWithOrderedManifest: number;
    orderedReferenceCount: number;
    missingReferenceCount: number;
    rawAssetNameLeaks: number;
  };
  skills: {
    visualManualId?: string;
    directorManualId?: string;
    hasDirectorPlanContext: boolean;
    hasStoryboardTableContext: boolean;
    hasStoryboardPromptContext: boolean;
    hasVideoPromptContext: boolean;
  };
  images: {
    ready: number;
    failed: number;
    withMediaRef: number;
    withImageWorkflowId: number;
    withImageWorkflowNodeId: number;
    shouldGenerateImageFalse: number;
  };
  audio: {
    withLines: number;
    withSpeakerId: number;
    withAudioRef: number;
  };
  video: {
    tracks: number;
    candidates: number;
    readyCandidates: number;
    selectedTracks: number;
    editingProjects: number;
    currentEditingProjectId?: string;
    currentEditingRevision?: number;
    editingProject?: EditingProjectV1;
    timelineRenderRecords: number;
    timelineRenderRecord?: TimelineRenderRecord;
    completeTimelineEvidence: number;
    hasCompleteTimelineEvidence: boolean;
    hasFinalExport: boolean;
    hasLegacyCompatibilityExport: boolean;
    legacyCompatibilityExport: boolean;
  };
  evidenceBoundary: WorkflowParityEvidenceBoundary;
  issues: WorkflowParityIssue[];
}

export function buildWorkflowParityReport(
  input: WorkflowParityReportInput,
): WorkflowParityReport {
  const flowData = buildStudioFlowData(input);
  const storyboard = buildStoryboardReport(input.storyboards);
  const references = buildReferenceReport(input.storyboards);
  const skills = buildSkillReport(input.workflowConfig, input.manualCatalog);
  const images = buildImageReport(input.storyboards);
  const audio = buildAudioReport(input.storyboards);
  const video = buildVideoReport(input);
  const agentEvidence = buildAgentEvidenceReport(input.agentRuns ?? []);
  const mediaTaskEvidence = buildMediaTaskEvidenceReport(input.mediaTasks ?? []);
  const toonflowFixture = input.toonflowFixtureRows
    ? compareToonflowFixtureToStoryboards({ storyboardRows: input.toonflowFixtureRows }, input.storyboards)
    : emptyToonflowFixtureReport();
  const nodes = buildNodeReports(
    input,
    input.agentRuns ?? [],
    storyboard,
    images,
    audio,
    video,
    Boolean(flowData.script),
    Boolean(flowData.scriptPlan),
    Boolean(flowData.storyboardTable),
  );
  const evidenceBoundary = {
    seededUiSmoke: false,
    visibleWorkflowSmoke: false,
    realDaojieVisibleSmoke: false,
    realMediaGeneration: false,
    ...input.evidenceBoundary,
  };
  const issues = buildIssues(
    nodes,
    input.agentRuns ?? [],
    input.mediaTasks ?? [],
    storyboard,
    references,
    skills,
    images,
    audio,
    video,
    toonflowFixture,
    evidenceBoundary,
  );

  return {
    agentEvidence,
    mediaTaskEvidence,
    toonflowFixture,
    nodes,
    storyboard,
    references,
    skills,
    images,
    audio,
    video,
    evidenceBoundary,
    issues,
  };
}

function buildAgentEvidenceReport(agentRuns: StudioAgentRun[]): WorkflowParityReport["agentEvidence"] {
  return agentRuns.reduce<WorkflowParityReport["agentEvidence"]>(
    (report, run) => {
      if (run.status === "success" || run.status === "failed") report.modelResponses += 1;
      if (run.status === "success" && Boolean(run.outputRef || run.outputRefs?.length)) {
        report.toolWritebacks += 1;
        report.supervisionApprovals += 1;
      }
      if (run.status === "failed") report.failedSupervisions += 1;
      return report;
    },
    {
      modelResponses: 0,
      toolWritebacks: 0,
      supervisionApprovals: 0,
      failedSupervisions: 0,
    },
  );
}

function emptyToonflowFixtureReport(): ToonflowFixtureParityReport {
  return {
    enabled: false,
    storyboardRows: 0,
    matchedRows: 0,
    promptMismatches: 0,
    videoDescMismatches: 0,
    referenceOrderMismatches: 0,
    imagePathMissing: 0,
    goldenImageComparisonStatus: "deferred",
    goldenImageBlocker: "No Toonflow fixture rows supplied.",
    issues: [],
  };
}

function buildMediaTaskEvidenceReport(mediaTasks: MediaGenerationTask[]): WorkflowParityReport["mediaTaskEvidence"] {
  return mediaTasks.reduce<WorkflowParityReport["mediaTaskEvidence"]>(
    (report, task) => {
      report.total += 1;
      if (task.status === "success") report.success += 1;
      if (task.status === "failed") {
        report.failed += 1;
        report.retryableFailed += 1;
      }
      if (task.status === "success" && task.kind === "storyboardImage") report.storyboardImageSuccess += 1;
      if (task.status === "success" && task.kind === "ttsAudio") report.ttsAudioSuccess += 1;
      if (
        task.status === "success" &&
        (task.kind === "modelVideo" || task.kind === "ffmpegTrack" || task.kind === "finalExport")
      ) {
        report.videoSuccess += 1;
      }
      return report;
    },
    {
      total: 0,
      success: 0,
      failed: 0,
      retryableFailed: 0,
      storyboardImageSuccess: 0,
      ttsAudioSuccess: 0,
      videoSuccess: 0,
    },
  );
}

function buildStoryboardReport(storyboards: StoryboardItem[]): WorkflowParityReport["storyboard"] {
  return storyboards.reduce<WorkflowParityReport["storyboard"]>(
    (report, item) => {
      report.total += 1;
      if (Number.isFinite(item.index)) report.withIndex += 1;
      if (item.videoDesc.trim()) report.withVideoDesc += 1;
      if (item.prompt.trim()) report.withPrompt += 1;
      if (item.trackKey.trim()) report.withTrack += 1;
      if (item.duration > 0) report.withDuration += 1;
      if (item.assetIds.length > 0) report.withAssociateAssetsIds += 1;
      if (typeof item.shouldGenerateImage === "boolean") report.withShouldGenerateImageExplicit += 1;
      if (item.sourceEvidence) report.withSourceEvidence += 1;
      if (item.shouldGenerateImage === false) report.shouldGenerateImageFalse += 1;
      return report;
    },
    {
      total: 0,
      withIndex: 0,
      withVideoDesc: 0,
      withPrompt: 0,
      withTrack: 0,
      withDuration: 0,
      withAssociateAssetsIds: 0,
      withShouldGenerateImageExplicit: 0,
      withSourceEvidence: 0,
      shouldGenerateImageFalse: 0,
    },
  );
}

function buildReferenceReport(storyboards: StoryboardItem[]): WorkflowParityReport["references"] {
  let storyboardsWithOrderedManifest = 0;
  let orderedReferenceCount = 0;
  let missingReferenceCount = 0;
  let rawAssetNameLeaks = 0;

  for (const storyboard of storyboards) {
    const references = storyboard.orderedReferenceManifest ?? [];
    if (references.length) storyboardsWithOrderedManifest += 1;
    orderedReferenceCount += references.length;
    missingReferenceCount += references.filter((item) => item.missing || (!item.imageId && !item.imagePath)).length;
    rawAssetNameLeaks += references.filter((item) => {
      if (!item.assetName) return false;
      const tag = `@图${item.order}`;
      return storyboard.prompt.includes(item.assetName) && !storyboard.prompt.includes(tag);
    }).length;
  }

  return {
    storyboardsWithOrderedManifest,
    orderedReferenceCount,
    missingReferenceCount,
    rawAssetNameLeaks,
  };
}

function buildSkillReport(
  workflowConfig: WorkflowParityReportInput["workflowConfig"],
  manualCatalog: StudioManualCatalog = {},
): WorkflowParityReport["skills"] {
  const visualManual = resolveManual("visual", workflowConfig?.visualManualId, manualCatalog);
  const directorManual = resolveManual("director", workflowConfig?.directorManualId, manualCatalog);

  return {
    visualManualId: workflowConfig?.visualManualId,
    directorManualId: workflowConfig?.directorManualId,
    hasDirectorPlanContext: Boolean(
      visualManual?.modules.director_planning_style &&
        directorManual?.modules.director_planning_narrative,
    ),
    hasStoryboardTableContext: Boolean(
      visualManual?.modules.director_storyboard_table_style &&
        directorManual?.modules.director_storyboard_table_narrative,
    ),
    hasStoryboardPromptContext: Boolean(
      visualManual?.modules.director_storyboard ||
        visualManual?.modules.art_storyboard_video,
    ),
    hasVideoPromptContext: Boolean(visualManual?.modules.art_storyboard_video),
  };
}

function resolveManual(
  kind: "visual" | "director",
  id: string | undefined,
  catalog: StudioManualCatalog,
): StudioManualPreset | null {
  return catalog[kind]?.find((item) => item.id === id) ?? getStudioManualPreset(kind, id);
}

function buildImageReport(storyboards: StoryboardItem[]): WorkflowParityReport["images"] {
  return storyboards.reduce<WorkflowParityReport["images"]>(
    (report, item) => {
      if (item.state === "ready") report.ready += 1;
      if (item.state === "failed") report.failed += 1;
      if (item.mediaRef?.kind === "image" || item.mediaRef?.kind === "video") report.withMediaRef += 1;
      if (item.imageWorkflowId || item.mediaRef?.imageWorkflowId) report.withImageWorkflowId += 1;
      if (item.imageWorkflowNodeId || item.mediaRef?.imageWorkflowNodeId) report.withImageWorkflowNodeId += 1;
      if (item.shouldGenerateImage === false) report.shouldGenerateImageFalse += 1;
      return report;
    },
    {
      ready: 0,
      failed: 0,
      withMediaRef: 0,
      withImageWorkflowId: 0,
      withImageWorkflowNodeId: 0,
      shouldGenerateImageFalse: 0,
    },
  );
}

function buildAudioReport(storyboards: StoryboardItem[]): WorkflowParityReport["audio"] {
  return storyboards.reduce<WorkflowParityReport["audio"]>(
    (report, item) => {
      if (item.lines?.trim()) report.withLines += 1;
      if (item.speakerId?.trim()) report.withSpeakerId += 1;
      if (item.audioRef?.kind === "audio") report.withAudioRef += 1;
      return report;
    },
    { withLines: 0, withSpeakerId: 0, withAudioRef: 0 },
  );
}

function buildVideoReport(
  input: WorkflowParityReportInput,
): WorkflowParityReport["video"] {
  const editingProjects = Object.values(input.editingProjects ?? {}).filter(
    (project) => !input.episodeId || project.episodeId === input.episodeId,
  );
  const editingProjectIds = new Set(editingProjects.map((project) => project.id));
  const timelineRenderRecords = Object.values(
    input.timelineRenderRecordsByEditingProjectId ?? {},
  ).filter((record) => editingProjectIds.has(record.editingProjectId));
  const timelineStatus = resolveWorkflowTimelineEvidence(
    input,
    input.fileExists,
  );
  return {
    tracks: input.productionTracks.length,
    candidates: input.videoCandidates.length,
    readyCandidates: input.videoCandidates.filter((item) => item.state === "ready" && item.filePath).length,
    selectedTracks: input.productionTracks.filter((item) => Boolean(item.selectedVideoId)).length,
    editingProjects: editingProjects.length,
    currentEditingProjectId: timelineStatus.project?.id,
    currentEditingRevision: timelineStatus.project?.revision,
    editingProject: timelineStatus.project,
    timelineRenderRecords: timelineRenderRecords.length,
    timelineRenderRecord: timelineStatus.record,
    completeTimelineEvidence: timelineStatus.complete ? 1 : 0,
    hasCompleteTimelineEvidence: timelineStatus.complete,
    hasFinalExport: timelineStatus.complete,
    hasLegacyCompatibilityExport: Boolean(parseFinalExportPath(input.agentWorkData)),
    legacyCompatibilityExport: Boolean(parseFinalExportPath(input.agentWorkData)),
  };
}

function buildNodeReports(
  input: Pick<
    WorkflowParityReportInput,
    "agentWorkData" | "entityExtractions" | "scriptPlans" | "storyboards" | "productionTracks" | "videoCandidates"
  >,
  agentRuns: StudioAgentRun[],
  storyboard: WorkflowParityReport["storyboard"],
  images: WorkflowParityReport["images"],
  audio: WorkflowParityReport["audio"],
  video: WorkflowParityReport["video"],
  hasScript: boolean,
  hasScriptPlan: boolean,
  hasStoryboardTable: boolean,
): WorkflowParityNodeReport[] {
  const hasAssets = input.entityExtractions.some(
    (item) => item.characters.length || item.scenes.length || item.props.length,
  );
  const scriptRun = hasSuccessfulRun(agentRuns, ["scriptDraft"]);
  const scriptPlanRun = hasSuccessfulRun(agentRuns, ["directorPlan", "storySkeleton", "adaptationStrategy"]);
  const assetsRun = hasSuccessfulRun(agentRuns, ["entityExtraction", "deriveAssets", "generateAssets"]);
  const storyboardTableRun = hasSuccessfulRun(agentRuns, ["storyboardTable"]);
  const storyboardRun = hasSuccessfulRun(agentRuns, ["storyboardImage", "storyboardPanel"]);
  const workbenchRun = hasSuccessfulRun(agentRuns, ["productionPlan", "voiceAssign"]);

  return [
    {
      id: "script",
      hasInputEvidence: hasScript,
      hasActionEvidence: scriptRun,
      hasWritebackEvidence: scriptRun && hasScript,
      hasReportEvidence: scriptRun && hasScript,
    },
    {
      id: "scriptPlan",
      hasInputEvidence: hasScript,
      hasActionEvidence: scriptPlanRun,
      hasWritebackEvidence: scriptPlanRun && (hasScriptPlan || input.scriptPlans.length > 0),
      hasReportEvidence: scriptPlanRun && (hasScriptPlan || input.scriptPlans.length > 0),
    },
    {
      id: "assets",
      hasInputEvidence: hasScript,
      hasActionEvidence: assetsRun,
      hasWritebackEvidence: assetsRun && hasAssets,
      hasReportEvidence: assetsRun && hasAssets,
    },
    {
      id: "storyboardTable",
      hasInputEvidence: hasScriptPlan || input.scriptPlans.length > 0,
      hasActionEvidence: storyboardTableRun,
      hasWritebackEvidence: storyboardTableRun && (hasStoryboardTable || storyboard.total > 0),
      hasReportEvidence: storyboardTableRun && storyboard.total > 0,
    },
    {
      id: "storyboard",
      hasInputEvidence: storyboard.total > 0,
      hasActionEvidence: storyboardRun,
      hasWritebackEvidence: storyboardRun && (images.withMediaRef > 0 || images.shouldGenerateImageFalse > 0),
      hasReportEvidence: storyboardRun && (images.withImageWorkflowId > 0 || images.shouldGenerateImageFalse > 0),
    },
    {
      id: "workbench",
      hasInputEvidence: storyboard.total > 0,
      hasActionEvidence: workbenchRun,
      hasWritebackEvidence: workbenchRun && (video.selectedTracks > 0 || video.hasFinalExport),
      hasReportEvidence: workbenchRun && (video.readyCandidates > 0 || video.hasFinalExport),
    },
  ];
}

function buildIssues(
  nodes: WorkflowParityNodeReport[],
  agentRuns: StudioAgentRun[],
  mediaTasks: MediaGenerationTask[],
  storyboard: WorkflowParityReport["storyboard"],
  references: WorkflowParityReport["references"],
  skills: WorkflowParityReport["skills"],
  images: WorkflowParityReport["images"],
  audio: WorkflowParityReport["audio"],
  video: WorkflowParityReport["video"],
  toonflowFixture: WorkflowParityReport["toonflowFixture"],
  evidenceBoundary: WorkflowParityEvidenceBoundary,
): WorkflowParityIssue[] {
  const issues: WorkflowParityIssue[] = [];
  const hasAnyRunEvidence = agentRuns.length > 0;
  const hasWorkflowOutput =
    storyboard.total > 0 ||
    images.withMediaRef > 0 ||
    audio.withAudioRef > 0 ||
    video.tracks > 0 ||
    video.candidates > 0 ||
    video.editingProjects > 0 ||
    video.timelineRenderRecords > 0 ||
    video.hasFinalExport;

  for (const node of nodes) {
    if (!node.hasInputEvidence || !node.hasWritebackEvidence || !node.hasReportEvidence) {
      issues.push({
        severity: "warning",
        code: `node.${node.id}.evidence`,
        message: `${node.id} node is missing input, writeback, or report evidence.`,
      });
    }
  }

  if (hasWorkflowOutput && !hasAnyRunEvidence) {
    issues.push({
      severity: "error",
      code: "run.evidence.missing",
      message: "Workflow outputs exist without persisted StudioAgentRun evidence.",
    });
  }

  if ((images.withMediaRef > 0 || audio.withAudioRef > 0 || video.readyCandidates > 0) && mediaTasks.length === 0) {
    issues.push({
      severity: "warning",
      code: "mediaTask.evidence.missing",
      message: "Media outputs exist without item-level media task evidence.",
    });
  }

  if (storyboard.total > 0 && storyboard.withSourceEvidence < storyboard.total) {
    issues.push({
      severity: "warning",
      code: "storyboard.sourceEvidence.missing",
      message: "Some storyboards do not preserve source evidence.",
    });
  }
  if (storyboard.total > 0 && references.storyboardsWithOrderedManifest < storyboard.total) {
    issues.push({
      severity: "warning",
      code: "references.orderedManifest.missing",
      message: "Some storyboards do not preserve ordered reference manifests.",
    });
  }
  if (references.missingReferenceCount > 0) {
    issues.push({
      severity: "error",
      code: "references.image.missing",
      message: "Ordered reference manifest contains missing image references.",
    });
  }
  if (references.rawAssetNameLeaks > 0) {
    issues.push({
      severity: "warning",
      code: "references.rawAssetNameLeak",
      message: "Storyboard prompt contains raw asset names without matching @图N binding.",
    });
  }
  if (!skills.hasDirectorPlanContext || !skills.hasStoryboardTableContext || !skills.hasStoryboardPromptContext) {
    issues.push({
      severity: "warning",
      code: "skills.context.incomplete",
      message: "Selected manuals do not prove director, storyboard-table, and storyboard-prompt context.",
    });
  }
  if (images.failed > 0) {
    issues.push({
      severity: "error",
      code: "images.failed",
      message: "Storyboard image workflow contains failed images.",
    });
  }
  if (audio.withLines > 0 && audio.withAudioRef === 0) {
    issues.push({
      severity: "warning",
      code: "audio.missing",
      message: "Storyboards contain spoken lines but no audio refs.",
    });
  }
  if (video.tracks > 0 && video.readyCandidates === 0 && !video.hasFinalExport) {
    issues.push({
      severity: "warning",
      code: "video.output.missing",
      message: "Workbench tracks exist without ready candidates or final export evidence.",
    });
  }
  if (
    (video.readyCandidates > 0 || video.hasLegacyCompatibilityExport) &&
    !video.hasFinalExport
  ) {
    issues.push({
      severity: "warning",
      code: "video.timelineEvidence.missing",
      message: "Workbench output lacks current revision-matched timeline render evidence.",
    });
  }
  if (toonflowFixture.enabled) {
    if (toonflowFixture.storyboardRows !== toonflowFixture.matchedRows) {
      issues.push({
        severity: "error",
        code: "toonflow.storyboard.countMismatch",
        message: "MYStudio storyboards do not match all Toonflow fixture storyboard rows.",
      });
    }
    if (toonflowFixture.promptMismatches > 0 || toonflowFixture.videoDescMismatches > 0) {
      issues.push({
        severity: "error",
        code: "toonflow.storyboard.promptMismatch",
        message: "MYStudio storyboard prompt/videoDesc differs from Toonflow fixture rows.",
      });
    }
    if (toonflowFixture.referenceOrderMismatches > 0) {
      issues.push({
        severity: "error",
        code: "toonflow.references.orderMismatch",
        message: "MYStudio ordered reference manifest differs from Toonflow o_assets2Storyboard order.",
      });
    }
    if (toonflowFixture.imagePathMissing > 0) {
      issues.push({
        severity: "warning",
        code: "toonflow.images.pathMissing",
        message: "Toonflow fixture contains storyboard or reference image paths that are not portable or missing.",
      });
    }
    if (toonflowFixture.goldenImageComparisonStatus === "deferred") {
      issues.push({
        severity: "warning",
        code: "toonflow.goldenImage.deferred",
        message: toonflowFixture.goldenImageBlocker ?? "Golden image comparison is deferred.",
      });
    }
  }
  if (evidenceBoundary.seededUiSmoke && !evidenceBoundary.visibleWorkflowSmoke) {
    issues.push({
      severity: "warning",
      code: "evidence.seededOnly",
      message: "Seeded UI smoke is present but visible workflow smoke has not been proven.",
    });
  }

  return issues;
}

function hasSuccessfulRun(agentRuns: StudioAgentRun[], keys: StudioAgentRun["key"][]) {
  return agentRuns.some((run) => keys.includes(run.key) && run.status === "success" && Boolean(run.outputRef || run.outputRefs?.length));
}

function parseFinalExportPath(agentWorkData: AgentWorkData[]): string | undefined {
  const productionPlan = agentWorkData
    .filter((item) => item.key === "productionPlan" && item.data.trim())
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const match = productionPlan?.data.match(/本地成片输出[:：]\s*(.+)$/m);
  return match?.[1]?.trim();
}
