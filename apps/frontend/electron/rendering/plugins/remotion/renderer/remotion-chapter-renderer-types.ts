import type { RemotionChapterManifestService } from "../manifest/remotion-chapter-manifest-service";
import { RemotionRenderBrowserProbe, RemotionRenderUtilityOptions } from "./remotion-render-utility";
import type { TimelineRenderPlan } from "@/types/editing";
import type { RemotionCurrentSlotV1, RemotionEvidenceV1, RemotionMediaProbeStreamV1, RemotionRenderJobIdentityV1, RemotionRenderJobTarget, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import type { RemotionChapterGateInputV1, RemotionChapterGateResult } from "@rendering/contracts/video-workflow";

/**
 * 章节渲染器契约类型族。二期:类型独立,体逐字保留。
 */
export interface RemotionChapterRendererOptions {
  /** 应用 userData 目录（render-hw.json 硬件加速开关读取；缺省回退 cwd 上级）。 */
  userDataDir?: string;
  workspaceRoot: string;
  workspaceRootForProject?: (projectId: string) => string;
  bundlePath: string;
  workerPath: string;
  cwd: string;
  binariesDirectory: string;
  remotionVersion: string;
  resolveSourcePath: (sourcePath: string) => string;
  projectRootForProject: (projectId: string) => string;
  chapterManifestService: Pick<RemotionChapterManifestService, "read">;
  probeBrowser: () => Promise<RemotionRenderBrowserProbe>;
  fork: RemotionRenderUtilityOptions["fork"];
  emitProgress: (progress: { jobId: string; stage: string; ratio: number; message?: string }) => void;
  probeMedia?: (filePath: string) => Promise<RemotionChapterProbe>;
  videoWorkflowGate?: (input: RemotionChapterGateInputV1) => Promise<RemotionChapterGateResult> | RemotionChapterGateResult;
  /** 自定义字幕字体文件解析（userData/SubtitleFonts）；custom:* 字体缺文件时 fail-closed。 */
  resolveCustomFontPath?: (fontId: string) => string | undefined;
  /** frontend/assets 目录（含 luts/ 与 sfx/ 子目录；dev=源码树，打包=resources）。
   * 缺省时不注册 grade LUT / sfx 资产（plan 含 grade 效果将 fail-closed）。 */
  assetsDir?: string;
  /** 分镜记录 shotFx.sfx 读取（字幕音效类别表；main 经 studio-workflow store 供给）。 */
  readSfxCategories?: (projectId: string, chapterId: string) => Record<string, string>;
}

export interface RemotionChapterRenderRequest {
  plan: TimelineRenderPlan;
  currentShotSlots: readonly RemotionCurrentSlotV1[];
  expectedJobId?: string;
}

export interface RemotionChapterProbe {
  duration: number;
  width: number;
  height: number;
  streams: RemotionMediaProbeStreamV1[];
  raw?: unknown;
}

export type RemotionChapterRenderResult =
  | { success: true; slot: RemotionCurrentSlotV1 }
  | { success: false; jobId: string; canceled: boolean; error: string };

export interface RemotionChapterRenderIdentity extends RemotionRenderJobIdentityV1 {
  jobId: string;
  target: Extract<RemotionRenderJobTarget, { kind: "chapter" }>;
}

/** 按场分段渲染的身份：frameRange 与场景边界必须进 inputHash，
 * 否则与整章 job 撞 identity（队列按 jobId 去重会拒绝）。 */
export interface RemotionChapterSceneRenderIdentity extends RemotionRenderJobIdentityV1 {
  jobId: string;
  target: Extract<RemotionRenderJobTarget, { kind: "chapter-scene" }>;
}

export interface RemotionChapterSceneSegmentSpec {
  sceneNo: number;
  sceneName: string;
  storyboardIds: readonly string[];
  /** 闭区间帧范围（与整章同一 layoutVisualTimeline 布局轴）。 */
  frameRange: readonly [number, number];
  /** 相对项目根的产物路径（exports/<ep>/scenes/...）。 */
  outputRelativePath: string;
}

export interface RemotionChapterSceneRenderRequest extends RemotionChapterRenderRequest {
  sceneSegment: RemotionChapterSceneSegmentSpec;
}

export type RemotionChapterSceneRenderResult =
  | { success: true; job: RemotionRenderJobV1; evidence: RemotionEvidenceV1 }
  | { success: false; jobId: string; canceled: boolean; error: string };

export type ChapterVisualInputResolution = {
  sourcePath: string;
  expectedSha256: string;
  label: "shot_slot" | "derived_input";
};

/** Compare filesystem paths by canonical identity when available (macOS /var aliases /private/var). */
