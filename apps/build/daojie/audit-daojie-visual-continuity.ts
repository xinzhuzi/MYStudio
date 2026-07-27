import fs from "node:fs";
import path from "node:path";
import { auditVisualContinuity } from "@/lib/studio/visual-continuity";
import { resolveProjectDir } from "../timeline/render-daojie-editing-timeline";
import type {
  ContinuityAssetVersion,
  StoryboardItem,
} from "@/types/studio";

const EPISODE_ID = "chapter-001";

type StudioState = {
  storyboards?: StoryboardItem[];
  continuityAssetVersions?: ContinuityAssetVersion[];
};

export function auditDaojieVisualContinuityState(
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
  const storePath = path.join(projectDir, "studio-workflow-store.json");
  if (!fs.existsSync(storePath)) throw new Error(`视觉连续性 store 不存在: ${storePath}`);
  const document = JSON.parse(fs.readFileSync(storePath, "utf8")) as { state?: StudioState } & StudioState;
  const report = auditDaojieVisualContinuityState(document.state ?? document);
  process.stdout.write(`${JSON.stringify({ ...report, projectDir, storePath }, null, 2)}\n`);
}

export function isDaojieVisualPreflightEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.MYSTUDIO_DAOJIE_VISUAL_PREFLIGHT === "1";
}

if (isDaojieVisualPreflightEnabled()) await main();
