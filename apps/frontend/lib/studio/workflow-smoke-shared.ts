import { suppressNextInteractionDeferArrival } from "@/hooks/interaction-defer";
import { WorkflowParityReport } from "@/lib/studio/workflow-parity-report";
import { WorkflowStageReadiness } from "@/lib/studio/workflow-readiness";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";

/**
 * smoke 桥共享底座——结果/证据类型、SMOKE 常量、隔离判定、烟路径族、阶段设置。file-size-reduction 专批拆出,体逐字保留。
 */
export interface WorkflowSmokeResult {
  progress: number;
  nextStageId: string;
  nextActionLabel: string;
  checks: Record<string, boolean>;
  workflowParityReport?: WorkflowParityReport;
  editingEvidence: WorkflowSmokeEditingEvidence;
  evidenceBoundary: WorkflowParityReport["evidenceBoundary"];
}

export interface WorkflowSmokeEditingEvidence {
  source: "seeded-ui-smoke";
  editingProjectId?: string;
  editingRevision?: number;
  timelineRenderJobId?: string;
  hasCompleteTimelineEvidence: boolean;
  realMediaGeneration: false;
}

export interface WorkflowSmokeStageEvidence {
  stageId: string;
  ready: boolean;
  evidence: string;
  progress: number;
}

export interface WorkflowSmokeInspection extends WorkflowSmokeResult {
  source: "isolated-smoke-project";
  stages: WorkflowStageReadiness[];
  evidence: WorkflowSmokeStageEvidence[];
}

export interface WorkflowSmokeStageResult extends WorkflowSmokeInspection {
  stageId: string;
  ready: boolean;
  evidenceText: string;
}

declare global {
  interface Window {
    mystudioWorkflowSmoke?: {
      seedCompleteWorkflow: () => Promise<WorkflowSmokeResult>;
      inspectWorkflow: () => Promise<WorkflowSmokeInspection>;
      inspectWorkflowStages: () => Promise<WorkflowSmokeInspection>;
      resetForStepwiseExecution: () => Promise<WorkflowSmokeInspection>;
      runStepwiseWorkflowStage: (stage: string) => Promise<WorkflowSmokeStageResult>;
      setWorkflowStage: (stage: string) => Promise<boolean>;
    };
  }
}

export const SMOKE_PROJECT_ID = "default-project";
export const SMOKE_CHAPTER_ID = "smoke-chapter-1";
export const SMOKE_ROLE_ID = "smoke-role-sword";
export const SMOKE_SCENE_ID = "smoke-scene-mine";
export const SMOKE_PROP_ID = "smoke-prop-sword";
export const SMOKE_STORYBOARD_ID = "smoke-storyboard-1";
export const SMOKE_TRACK_ID = "smoke-track-1";
export const SMOKE_VIDEO_ID = "smoke-video-1";
export const SMOKE_EDITING_PROJECT_ID = "smoke-editing-1";
export const SMOKE_AUDIO_PATH = "/tmp/mystudio-smoke-voice.wav";
export const DEFAULT_SMOKE_VIDEO_PATH = "/tmp/mystudio-smoke-final.mp4";

export function isIsolatedSmokeUserDataDir(userDataDir?: string): boolean {
  if (!userDataDir) return false;
  return /(?:^|[/\\])mystudio-(?:(?:installed-)?smoke|project-workflow-run)-[^/\\]+$/.test(userDataDir);
}

export function getSmokeVideoPath(): string {
  const userDataDir = typeof window === "undefined" ? undefined : window.mystudioSmoke?.userDataDir;
  if (!userDataDir || !isIsolatedSmokeUserDataDir(userDataDir)) return DEFAULT_SMOKE_VIDEO_PATH;
  return `${userDataDir.replace(/[\\/]+$/, "")}/media/mystudio-smoke-final.mp4`;
}

// 音频引用与视频同款落在隔离 smoke userData 的 media 下:主进程 IPC 路径原语
// 只放行受管根内路径,/tmp 兜底路径会被受管根守卫拒绝(08-18 安全加固)。
export function getSmokeAudioPath(): string {
  const userDataDir = typeof window === "undefined" ? undefined : window.mystudioSmoke?.userDataDir;
  if (!userDataDir || !isIsolatedSmokeUserDataDir(userDataDir)) return SMOKE_AUDIO_PATH;
  return `${userDataDir.replace(/[\\/]+$/, "")}/media/mystudio-smoke-voice.wav`;
}

const SMOKE_FRAME_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADtgGOSHzRgQAAAABJRU5ErkJggg==";

export function getSmokeStoryboardFramePath() {
  return `data:image/png;base64,${SMOKE_FRAME_PNG_BASE64}`;
}

let smokeFrameGraphPathCache: string | null = null;

/**
 * 进工作流图的帧路径(种子数据纪律对齐): 1x1 PNG 经 writeBinary 落项目文件得
 * project-file:// 轻量 URL——data: URL 被 assertImageWorkflowGraphMediaPersistable
 * 拒持久化(2026-08-23 OOM 防线),种子中会成为图节点 imageUrl/resultUrl 的字段
 * 必须轻量化;projectFiles 桥不可用(单测 jsdom)时 fail-soft 回退 data:。
 */
export async function getSmokeFrameGraphPath(): Promise<string> {
  if (smokeFrameGraphPathCache) return smokeFrameGraphPathCache;
  const projectId = useProjectStore.getState().activeProjectId ?? SMOKE_PROJECT_ID;
  const bridge = typeof window !== "undefined" ? window.projectFiles : undefined;
  if (bridge?.writeBinary) {
    try {
      const binary = atob(SMOKE_FRAME_PNG_BASE64);
      const bytes = new ArrayBuffer(binary.length);
      const view = new Uint8Array(bytes);
      for (let index = 0; index < binary.length; index += 1) view[index] = binary.charCodeAt(index);
      const saved = await bridge.writeBinary({ projectId, relativePath: "smoke/frame.png", bytes });
      if (saved?.success && saved.url) {
        smokeFrameGraphPathCache = saved.url;
        return saved.url;
      }
    } catch {
      // fail-soft: 回退 data: URL(仅单测环境会走到)
    }
  }
  return getSmokeStoryboardFramePath();
}

export async function setWorkflowStage(stage: string): Promise<boolean> {
  // 测试桥语义:程序化设阶段豁免交互门闸(smoke 断言不等 5s 静止)——
  // 一次性标志先行,阶段变化效应消费;用户真实点击路径不受影响
  suppressNextInteractionDeferArrival();
  useStudioStore.getState().setWorkflowConfig({ workflowStage: stage });
  return true;
}

