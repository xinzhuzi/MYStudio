/**
 * scene 落地驱动(1116,PRD 11-16-storyboard-canonical-line §五.5/§九②)。
 *
 * 病灶:F5 只修到代码层——分镜批量解析场景参考(studio-assets batchMatch)查
 * assets.db,而三库 scene 行从未入库(实读 assets.db 无「灵矿坑道葬玉」行,
 * scene 终验 0/19)——参考解析恒空,场景件在装配中缺席。
 *
 * 正路(grill 定谳,禁直写 SQLite——script-asset-media-task.ts:10 同款纪律):
 * ①入库=「放入资产库」产品路(useScriptAssetGenerationActions.ts storeRowInAssetLibrary
 *   同款 assets:add → storage INSERT);
 * ②出图=「立即生成」产品路(asset-generation-orchestrator.ts generateAsset)+收尾
 *   自动入库(getByName → replaceImage,handleGenerateSingle L8 同款);
 * ③挂载并入=入库/出图后由既有 resolveStoryboardAssetReferences batchMatch 自然命中。
 *
 * 幂等与防护:库内有图零动作;生成失败本会话不重试(逐镜重试会连续烧卡);
 * 全链 fail-open(Warn 留痕,不阻断分镜生图主链)。
 */

import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { generateAsset, type AssetGenerationTask } from "@/lib/studio/asset-generation-orchestrator";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { Scene } from "@/stores/library/scene-store";
import type { StoryboardItem } from "@/types/studio";
import { findSceneRowForNames } from "./storyboard-canonical-context";

/** 本会话生成失败的场景名(不重试:逐镜重试=连续烧卡)。 */
const failedSceneNames = new Set<string>();
/** 生成中场景名(单镜+批量并发防双发)。 */
const inFlightSceneNames = new Set<string>();

interface SceneLandingReport {
  shotId: string;
  sceneName: string;
  action: "already-landed" | "row-created" | "row-create-failed" | "image-generated" | "image-generation-failed" | "skipped-no-visual-manual" | "skipped-in-flight" | "skipped-failed-this-session" | "skipped-no-bridge" | "skipped-no-scene-row";
  detail?: string;
}

function report(entry: SceneLandingReport): void {
  const level = entry.action.includes("failed") ? "warn" : "info";
  void logEvent({
    level,
    category: "asset",
    operationId: createOperationId("storyboard-scene-landing"),
    message: `Storyboard scene landing: ${entry.action} (${entry.sceneName})`,
    context: { ...entry },
  });
}

function assetHasUsableImage(asset: { previewUrl?: string; thumbnailUrl?: string; filePath?: string } | null): boolean {
  return Boolean(asset && (asset.previewUrl || asset.thumbnailUrl || asset.filePath));
}

/** 「放入资产库」产品路(storeRowInAssetLibrary 同款 payload;查无才建,幂等)。 */
async function landSceneRow(scene: Scene): Promise<{ created: boolean; assetId?: string }> {
  const bridge = getStudioAssetsBridge();
  if (!bridge?.add || !bridge.getByName) return { created: false };
  const existing = await bridge.getByName({ type: "scene", name: scene.name }).catch(() => null);
  if (existing) return { created: false, assetId: existing.id };
  const description = scene.atmosphere || scene.location || scene.notes || scene.name;
  const created = await bridge.add({
    type: "scene",
    name: scene.name,
    description,
    prompt: scene.visualPrompt || description,
    setting: [scene.location, scene.time, scene.atmosphere].filter(Boolean).join("，"),
  }).catch(() => null);
  return { created: Boolean(created), assetId: created?.id };
}

/** 「立即生成」产品路(toGenerationTask 场景轨同款任务+收尾自动入库)。 */
async function generateSceneImage(
  scene: Scene,
  assetId: string,
): Promise<boolean> {
  const visualManualId = useStudioStore.getState().workflowConfig.visualManualId;
  if (!visualManualId) return false;
  const task: AssetGenerationTask = {
    assetId: scene.id,
    assetType: "scene",
    name: scene.name,
    description: scene.atmosphere || scene.location || "",
    isDerivative: Boolean(scene.isViewpointVariant),
    visualManualId,
    projectId: useProjectStore.getState().activeProjectId ?? undefined,
    skipPolish: Boolean(scene.visualPrompt?.trim()),
    existingPrompt: scene.visualPrompt?.trim() || undefined,
  };
  const result = await generateAsset(task);
  if (result.phase !== "done" || !result.imageLocalPath) return false;
  // 收尾自动入库(handleGenerateSingle L8 同款:换主图)
  const bridge = getStudioAssetsBridge();
  if (bridge?.replaceImage) {
    await bridge.replaceImage({ assetId, sourceFilePath: result.imageLocalPath }).catch(() => null);
  }
  return true;
}

/**
 * 分镜场景落地驱动:该镜关联场景(三库行在场)在资产库无行/无图时,按产品
 * 正路入库+出图。纯道具/无场景镜零动作。fail-open:任何失败只留痕,不抛错。
 */
export async function ensureStoryboardSceneAssetsLanded(shot: Pick<StoryboardItem, "id" | "index" | "associateAssetsNames">): Promise<void> {
  try {
    const scene = findSceneRowForNames(shot.associateAssetsNames ?? []);
    if (!scene) return;
    const bridge = getStudioAssetsBridge();
    if (!bridge?.getByName) {
      report({ shotId: shot.id, sceneName: scene.name, action: "skipped-no-bridge" });
      return;
    }
    const existing = await bridge.getByName({ type: "scene", name: scene.name }).catch(() => null);
    if (assetHasUsableImage(existing)) {
      report({ shotId: shot.id, sceneName: scene.name, action: "already-landed" });
      return;
    }
    const { created, assetId } = await landSceneRow(scene);
    const targetAssetId = assetId ?? existing?.id;
    if (!targetAssetId) {
      report({ shotId: shot.id, sceneName: scene.name, action: "row-create-failed" });
      return;
    }
    if (created) report({ shotId: shot.id, sceneName: scene.name, action: "row-created" });
    if (failedSceneNames.has(scene.name)) {
      report({ shotId: shot.id, sceneName: scene.name, action: "skipped-failed-this-session" });
      return;
    }
    if (inFlightSceneNames.has(scene.name)) {
      report({ shotId: shot.id, sceneName: scene.name, action: "skipped-in-flight" });
      return;
    }
    inFlightSceneNames.add(scene.name);
    try {
      const ok = await generateSceneImage(scene, targetAssetId);
      report({
        shotId: shot.id,
        sceneName: scene.name,
        action: ok ? "image-generated" : "image-generation-failed",
      });
      if (!ok) failedSceneNames.add(scene.name);
    } finally {
      inFlightSceneNames.delete(scene.name);
    }
  } catch (error) {
    // fail-open:落地驱动不阻断分镜生图主链
    void logEvent({
      level: "warn",
      category: "asset",
      operationId: createOperationId("storyboard-scene-landing"),
      message: "Storyboard scene landing errored (fail-open)",
      context: {
        shotId: shot.id,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** 测试复位:清会话级失败/在飞集合。 */
export function resetSceneLandingSessionState(): void {
  failedSceneNames.clear();
  inFlightSceneNames.clear();
}
