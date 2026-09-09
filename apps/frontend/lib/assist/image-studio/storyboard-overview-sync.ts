// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 章节总览图库内自动保鲜(09-09 主视图 ComfyUI 化·批8):
 * ComfyUI 画布在场时周期把最新分镜总览(ManyingShot 网格)以固定名
 * overwrite 进工作流库——主视图画布里随时一键打开「分镜总览」,
 * 无需手动生成。变更指纹守卫:分镜未动不重复导入。
 */

import type { ComfyWorkflowLibraryTransport } from "@/lib/assist/image-studio/comfy-workflow-library";
import { createHttpComfyWorkflowLibraryTransport } from "@/lib/assist/image-studio/comfy-sidecar-bridge";
import { buildStoryboardOverviewWorkflow } from "@/lib/assist/image-studio/storyboard-overview-comfy";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

function overviewFingerprint(storyboards: StoryboardItem[]): string {
  return JSON.stringify(
    storyboards
      .map((item) => [item.id, item.index, item.episodeId, item.mediaRef?.path ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

let lastSyncedFingerprint = "";

export async function syncStoryboardOverviewToLibrary(
  transport: Pick<ComfyWorkflowLibraryTransport, "importFiles"> = createHttpComfyWorkflowLibraryTransport(),
): Promise<boolean> {
  const storyboards = useStudioStore.getState().storyboards;
  if (storyboards.length === 0) return false;
  const fingerprint = overviewFingerprint(storyboards);
  if (fingerprint === lastSyncedFingerprint) return true;
  const result = buildStoryboardOverviewWorkflow(storyboards);
  const imported = await transport
    .importFiles(
      [{ name: `${result.report.name}.json`, content: JSON.stringify(result.ui, null, 1) }],
      "overwrite",
    )
    .catch(() => null);
  if (imported && imported.some((item) => item.status !== "failed")) {
    lastSyncedFingerprint = fingerprint;
    return true;
  }
  return false;
}

export function resetOverviewSyncForTests(): void {
  lastSyncedFingerprint = "";
}
