import type {
  AgentWorkData,
  EntityExtractionResult,
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

export interface StudioFlowAssetItem {
  id: string;
  name: string;
  type: "character" | "scene" | "prop";
  note?: string;
  episodeId: string;
}

export interface StudioFlowStoryboardItem {
  id: string;
  index: number;
  videoDesc: string;
  prompt: string;
  track: string;
  duration: number;
  associateAssetsIds: string[];
  shouldGenerateImage: boolean;
  sourceEvidence?: StoryboardItem["sourceEvidence"];
  orderedReferenceManifest?: StoryboardItem["orderedReferenceManifest"];
  mediaPath?: string;
  audioPath?: string;
  lines?: string;
}

export interface StudioFlowWorkbenchMedia {
  id: string;
  sources: "storyboard" | "assets";
  fileType: "image" | "video" | "audio";
  path: string;
}

export interface StudioFlowWorkbenchVideo {
  id: string;
  state: VideoCandidate["state"];
  filePath?: string;
  provider: VideoCandidate["provider"];
  errorReason?: string;
}

export interface StudioFlowWorkbenchTrack {
  id: string;
  prompt: string;
  state: ProductionTrack["state"];
  reason?: string;
  duration: number;
  storyboardIds: string[];
  selectVideoId?: string;
  selectedVideoId?: string;
  selectedVideoPath?: string;
  medias: StudioFlowWorkbenchMedia[];
  videoList: StudioFlowWorkbenchVideo[];
}

export interface StudioFlowData {
  script: string;
  scriptPlan: string;
  assets: StudioFlowAssetItem[];
  storyboardTable: string;
  storyboard: StudioFlowStoryboardItem[];
  workbench: {
    tracks: StudioFlowWorkbenchTrack[];
    finalExportPath?: string;
  };
}

export interface StudioFlowDataInput {
  agentWorkData: AgentWorkData[];
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  storyboards: StoryboardItem[];
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  fileExists?: (filePath: string) => boolean;
}

export function buildStudioFlowData(
  input: StudioFlowDataInput,
): StudioFlowData {
  const fileExists = input.fileExists ?? (() => true);
  const storyboardById = new Map(
    input.storyboards.map((storyboard) => [storyboard.id, storyboard]),
  );
  const candidatesByTrack = groupVideoCandidates(input.videoCandidates);
  return {
    script: latestWork(input.agentWorkData, "scriptDraft"),
    scriptPlan:
      latestWork(input.agentWorkData, "directorPlan") ||
      input.scriptPlans.map(formatScriptPlan).join("\n\n"),
    assets: input.entityExtractions.flatMap(formatAssets),
    storyboardTable: latestWork(input.agentWorkData, "storyboardTable"),
    storyboard: input.storyboards
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => ({
        id: item.id,
        index: item.index,
        videoDesc: item.videoDesc,
        prompt: item.prompt,
        track: item.trackKey,
        duration: item.duration,
        associateAssetsIds: item.assetIds,
        shouldGenerateImage:
          item.shouldGenerateImage !== false &&
          (!item.mediaRef || item.mediaRef.kind === "audio"),
        mediaPath:
          item.mediaRef &&
          item.mediaRef.kind !== "audio" &&
          fileExists(item.mediaRef.path)
            ? item.mediaRef.path
            : undefined,
        sourceEvidence: item.sourceEvidence,
        orderedReferenceManifest: item.orderedReferenceManifest,
        audioPath:
          item.audioRef?.kind === "audio" && fileExists(item.audioRef.path)
            ? item.audioRef.path
            : undefined,
        lines: item.lines,
      })),
    workbench: {
      tracks: input.productionTracks.map((track) => {
        const selected = input.videoCandidates.find(
          (candidate) => candidate.id === track.selectedVideoId,
        );
        const videoList = (candidatesByTrack.get(track.id) ?? []).map(
          (candidate) => ({
            id: candidate.id,
            state: candidate.state,
            filePath:
              candidate.filePath && fileExists(candidate.filePath)
                ? candidate.filePath
                : undefined,
            provider: candidate.provider,
            errorReason: candidate.errorReason,
          }),
        );
        return {
          id: track.id,
          prompt: track.prompt,
          state: track.state,
          reason: track.reason,
          duration: track.duration,
          storyboardIds: track.storyboardIds,
          selectVideoId: track.selectedVideoId,
          selectedVideoId: track.selectedVideoId,
          selectedVideoPath:
            selected?.state === "ready" &&
            selected.filePath &&
            fileExists(selected.filePath)
              ? selected.filePath
              : undefined,
          medias: track.storyboardIds.flatMap((storyboardId) =>
            formatWorkbenchMedias(storyboardById.get(storyboardId), fileExists),
          ),
          videoList,
        };
      }),
      finalExportPath: parseExistingFinalExportPath(
        latestWork(input.agentWorkData, "productionPlan"),
        fileExists,
      ),
    },
  };
}

function groupVideoCandidates(candidates: VideoCandidate[]) {
  const grouped = new Map<string, VideoCandidate[]>();
  for (const candidate of candidates) {
    grouped.set(candidate.trackId, [
      ...(grouped.get(candidate.trackId) ?? []),
      candidate,
    ]);
  }
  return grouped;
}

function formatWorkbenchMedias(
  storyboard: StoryboardItem | undefined,
  fileExists: (filePath: string) => boolean,
): StudioFlowWorkbenchMedia[] {
  if (!storyboard) return [];
  return [storyboard.mediaRef, storyboard.audioRef]
    .filter((media): media is NonNullable<StoryboardItem["mediaRef"]> =>
      Boolean(media && fileExists(media.path)),
    )
    .map((media) => ({
      id: storyboard.id,
      sources: "storyboard" as const,
      fileType: media.kind,
      path: media.path,
    }));
}

function latestWork(items: AgentWorkData[], key: AgentWorkData["key"]): string {
  return (
    items
      .filter((item) => item.key === key && item.data.trim())
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      ?.data.trim() ?? ""
  );
}

function formatScriptPlan(plan: ScriptPlan): string {
  return [
    `## 导演规划 · ${plan.episodeId}`,
    plan.theme && `### ① 主题立意\n${plan.theme}`,
    plan.visualStyle && `### ② 视觉风格\n${plan.visualStyle}`,
    plan.narrativeRhythm && `### ③ 叙事结构与节奏\n${plan.narrativeRhythm}`,
    formatSceneIntents(plan.sceneIntents),
    plan.soundDirection && `### ⑤ 声音方向\n${plan.soundDirection}`,
    plan.transitions && `### ⑥ 转场与视觉连续性\n${plan.transitions}`,
    formatDerivedAssetPlan(plan.derivedAssetPlan),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatSceneIntents(plan: ScriptPlan["sceneIntents"]): string {
  if (!plan.length) return "";
  return [
    "### ④ 分场景意图",
    "| 场景 | 情绪 | 镜头意图 | 空间关系 |",
    "| --- | --- | --- | --- |",
    ...plan.map((item) =>
      [
        item.sceneId,
        item.emotion,
        item.shotIntent,
        item.spatial,
      ]
        .map(escapeMarkdownTableCell)
        .join(" | "),
    ).map((row) => `| ${row} |`),
  ].join("\n");
}

function formatDerivedAssetPlan(plan: ScriptPlan["derivedAssetPlan"]): string {
  if (!plan.length) return "";
  return [
    "### ⑦ 衍生资产预划清单",
    "| 父资产 | 衍生状态 | 原因/出现段落 |",
    "| --- | --- | --- |",
    ...plan.map((item) =>
      [
        item.parentAssetId,
        item.state,
        item.reason,
      ]
        .map(escapeMarkdownTableCell)
        .join(" | "),
    ).map((row) => `| ${row} |`),
  ].join("\n");
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br />");
}

function formatAssets(batch: EntityExtractionResult): StudioFlowAssetItem[] {
  return [
    ...batch.characters.map((item) => ({
      id: item.characterId,
      name: item.name,
      type: "character" as const,
      note: item.note,
      episodeId: batch.episodeId,
    })),
    ...batch.scenes.map((item) => ({
      id: item.sceneId,
      name: item.name,
      type: "scene" as const,
      note: item.note,
      episodeId: batch.episodeId,
    })),
    ...batch.props.map((item) => ({
      id: item.assetId,
      name: item.name,
      type: "prop" as const,
      note: item.note,
      episodeId: batch.episodeId,
    })),
  ];
}

function parseExistingFinalExportPath(
  text: string,
  fileExists: (filePath: string) => boolean,
): string | undefined {
  const filePath = text.match(/本地成片输出\s*:\s*(.+)/)?.[1]?.trim();
  return filePath && fileExists(filePath) ? filePath : undefined;
}
