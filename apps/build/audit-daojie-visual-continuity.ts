import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditVisualContinuity } from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  StoryboardItem,
} from "@/types/studio";

const EPISODE_ID = "chapter-001";
const DEFAULT_PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0";

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
  const projectDir = process.env.MYSTUDIO_DAOJIE_PROJECT_DIR
    || path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "漫影工作室",
      "projects",
      "_p",
      DEFAULT_PROJECT_ID,
    );
  const storePath = path.join(projectDir, "studio-workflow-store.json");
  if (!fs.existsSync(storePath)) throw new Error(`视觉连续性 store 不存在: ${storePath}`);
  const document = JSON.parse(fs.readFileSync(storePath, "utf8")) as { state?: StudioState } & StudioState;
  const report = auditDaojieVisualContinuityState(document.state ?? document);
  process.stdout.write(`${JSON.stringify({ ...report, projectDir, storePath }, null, 2)}\n`);
}

function isDirectExecution() {
  const entryPath = process.argv[1];
  return process.env.MYSTUDIO_DAOJIE_VISUAL_PREFLIGHT === "1"
    || (Boolean(entryPath) && pathToFileURL(path.resolve(entryPath)).href === import.meta.url);
}

if (isDirectExecution()) await main();
