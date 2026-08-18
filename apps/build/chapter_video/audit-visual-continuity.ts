import fs from "node:fs";
import path from "node:path";
import { auditVisualContinuity } from "@/lib/studio/visual-continuity";
import { readStudioWorkflowStoreState, resolveProjectDir } from "../timeline/storage-paths";
import type {
  ContinuityAssetVersion,
  StoryboardItem,
} from "@/types/studio";

const EPISODE_ID = "chapter-001";

type StudioState = {
  storyboards?: StoryboardItem[];
  continuityAssetVersions?: ContinuityAssetVersion[];
};

export function auditVisualContinuityState(
  state: StudioState,
  episodeId = EPISODE_ID,
) {
  const storyboards = (Array.isArray(state.storyboards) ? state.storyboards : [])
    .filter((item) => item?.episodeId === episodeId)
    .sort((left, right) => left.index - right.index);
  if (storyboards.length === 0) {
    throw new Error(`${episodeId} 没有可审核的真实分镜`);
  }
  const assetVersions = Array.isArray(state.continuityAssetVersions)
    ? state.continuityAssetVersions
    : [];
  const audit = auditVisualContinuity(storyboards, assetVersions);
  if (!audit.ok || audit.approved !== storyboards.length) {
    const preview = audit.issues
      .slice(0, 5)
      .map((issue) => `${issue.storyboardId}: ${issue.message}`)
      .join("；");
    throw new Error(
      `直接成片视觉连续性未通过：approved=${audit.approved}, pending=${audit.pending}, `
      + `rejected=${audit.rejected}, stale=${audit.stale}, total=${storyboards.length}`
      + (preview ? `；${preview}` : ""),
    );
  }
  return {
    ok: true,
    episodeId,
    storyboards: storyboards.length,
    ...audit,
  };
}

async function main() {
  const projectDir = resolveProjectDir();
  // store 布局 v1:store/ 存在=已迁移(08-18-project-store-layout)
  const storeBase = path.join(projectDir, "store");
  const layoutBase = fs.existsSync(storeBase) ? storeBase : projectDir;
  const storePath = path.join(layoutBase, "studio-workflow-store.json");
  const storeSnapshot = readStudioWorkflowStoreState(projectDir);
  if (!storeSnapshot) throw new Error(`视觉连续性 store 不存在（分片/单文件均缺失）: ${storePath}`);
  const report = auditVisualContinuityState(storeSnapshot.state as unknown as StudioState);
  process.stdout.write(`${JSON.stringify({ ...report, projectDir, storePath }, null, 2)}\n`);
}

export function isVisualPreflightEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.MYSTUDIO_CHAPTER_VIDEO_VISUAL_PREFLIGHT === "1";
}

if (isVisualPreflightEnabled()) await main();
