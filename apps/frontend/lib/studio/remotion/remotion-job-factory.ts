import type { RemotionShotPlanV1 } from "./shot-plan";
import { sha256CanonicalJson } from "./canonical-json";
import { createRemotionRenderJobId } from "./remotion-job-identity";
import type { RemotionRenderJobV1 } from "@/types/remotion-workspace";

/**
 * Builds the browser-safe ready job envelope used by the renderer queue IPC.
 * Persistence and rendering remain main-process responsibilities; this module
 * deliberately has no filesystem, process, or Electron imports.
 */
export function createReadyShotJob(input: {
  plan: RemotionShotPlanV1;
  bundleContentHash: string;
  templateVersion: string;
  remotionVersion: string;
  now?: number;
}): Promise<RemotionRenderJobV1> {
  const renderSettingsHash = sha256CanonicalJson(input.plan.renderSettings);
  return renderSettingsHash.then(async (settingsHash) => {
    const target = {
      kind: "shot" as const,
      chapterId: input.plan.chapterId,
      shotId: input.plan.shot.shotId,
      shotRevision: input.plan.shot.revision,
    };
    const identity = {
      projectId: input.plan.projectId,
      target,
      inputHash: input.plan.inputHash,
      bundleContentHash: input.bundleContentHash,
      renderSettingsHash: settingsHash,
    };
    return {
      schemaVersion: 1,
      jobId: await createRemotionRenderJobId(identity),
      ...identity,
      templateVersion: input.templateVersion,
      remotionVersion: input.remotionVersion,
      status: "ready",
      attempt: 0,
      progress: 0,
      createdAt: input.now ?? Date.now(),
    } satisfies RemotionRenderJobV1;
  });
}
