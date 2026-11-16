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
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { generateAsset, type AssetGenerationTask } from "@/lib/studio/asset-generation-orchestrator";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { Scene } from "@/stores/library/scene-store";
import type { StoryboardItem } from "@/types/studio";
import {
  collectDerivedAssetPlanEntries,
  resolveStoryboardScene,
  type StoryboardSceneResolvableShot,
} from "./storyboard-canonical-context";

/** 本会话生成失败的场景名(不重试:逐镜重试=连续烧卡)。 */
const failedSceneNames = new Set<string>();
/** 生成中场景名(单镜+批量并发防双发)。 */
const inFlightSceneNames = new Set<string>();
/** 本会话已落行/落图的衍生复合名(幂等集,跨镜去重)。 */
const landedDerivedNames = new Set<string>();

type SceneLandingShot = Pick<StoryboardItem, "id" | "index">
  & Partial<Pick<StoryboardItem, "associateAssetsNames" | "associateAssetsIds" | "sceneName" | "timeOfDay" | "prompt" | "videoDesc" | "shotSemantics" | "continuityState" | "episodeId">>;

interface SceneLandingReport {
  shotId: string;
  sceneName: string;
  action: "already-landed" | "row-created" | "row-create-failed" | "image-generated" | "image-generation-failed" | "image-imported" | "image-import-failed" | "scene-unresolved" | "skipped-no-visual-manual" | "skipped-in-flight" | "skipped-failed-this-session" | "skipped-no-bridge" | "skipped-no-scene-row";
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

/** 态行 referenceImage(project-file://)→受管绝对路径(桥面解析,渲染层零路径推算)。 */
async function resolveSceneReferenceImagePath(referenceImage: string): Promise<string | null> {
  const bridge = getProjectFilesBridge();
  if (!bridge?.getAbsolutePath) return null;
  return await bridge.getAbsolutePath(referenceImage).catch(() => null);
}

/**
 * 分镜场景落地驱动:该镜关联场景(三库行在场,G1 五级序解析+态行优选)在
 * 资产库无行/无图时按产品正路入库+出图;态行带 referenceImage(三库既有
 * 衍生场景态图,金水塾馆·夜内态 mp381wo 实证)优先导入既有图(免烧卡),
 * 无图可导才 generateSceneImage。纯道具/无场景镜零动作;场景链全断=
 * scene-unresolved 留痕(与门A 拒发门双痕互证)。fail-open:任何失败只留痕。
 */
export async function ensureStoryboardSceneAssetsLanded(shot: SceneLandingShot): Promise<void> {
  try {
    const resolution = resolveStoryboardScene(shot as StoryboardSceneResolvableShot);
    const scene = resolution.row;
    if (!scene) {
      // 1117 C2 G3③:场景链全断(id/sceneName/探针/守卫名匹配五级全空)留痕
      // ——门A 拒发(场景锚未解析)与此双痕互证,排障不再靠猜。
      report({
        shotId: shot.id,
        sceneName: shot.sceneName || (shot.associateAssetsNames ?? []).join("、") || "—",
        action: "scene-unresolved",
        detail: resolution.warnings.join(";") || undefined,
      });
      return;
    }
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
    // 1117 C2 G3②:态行 referenceImage 优先导入既有图(bridge.add 建行+
    // replaceImage 导入,免烧卡);无图可导才走生成。
    const referenceImage = scene.referenceImage?.trim();
    if (referenceImage) {
      const sourcePath = await resolveSceneReferenceImagePath(referenceImage);
      if (sourcePath) {
        if (existing?.id) {
          const replaced = await bridge.replaceImage?.({ assetId: existing.id, sourceFilePath: sourcePath }).catch(() => null);
          if (replaced) {
            report({ shotId: shot.id, sceneName: scene.name, action: "image-imported" });
            return;
          }
        } else {
          const created = await bridge.add({
            type: "scene", name: scene.name, sourceFilePath: sourcePath,
            description: scene.atmosphere || scene.location || scene.name,
          }).catch(() => null);
          if (created) {
            report({ shotId: shot.id, sceneName: scene.name, action: "image-imported" });
            return;
          }
        }
      }
      report({ shotId: shot.id, sceneName: scene.name, action: "image-import-failed" });
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

/**
 * 1117 C2 G5② 衍生资产落地管道:批量链 pre-flight 按导演规划⑦清单为角色
 * (及道具)衍生态补 assets.db 行(0 行缺口,「晏燎·夜课少年」实证)——
 * assets:add 建行产品路,默认只建行不烧卡(图由资产轨/衍生链后续生成);
 * 场景态已落三库(金水塾馆·夜内态等)零动作。幂等(库内有行跳过+会话集
 * 去重),fail-open 不阻断生图主链。
 */
export async function ensureStoryboardDerivedAssetsLanded(shot: SceneLandingShot): Promise<void> {
  try {
    const entries = collectDerivedAssetPlanEntries(shot.episodeId);
    if (!entries.length) return;
    const bridge = getStudioAssetsBridge();
    if (!bridge?.add || !bridge.getByName) return;
    for (const entry of entries) {
      if (entry.kind === "scene") continue; // 场景态已落三库,走场景落地驱动
      if (landedDerivedNames.has(entry.compoundName)) continue;
      landedDerivedNames.add(entry.compoundName);
      const existing = await bridge.getByName({
        type: entry.kind, name: entry.compoundName,
      } as { type: "role" | "tool"; name: string }).catch(() => null);
      if (existing) continue;
      const created = await bridge.add({
        type: entry.kind,
        name: entry.compoundName,
        description: `${entry.baseName} 衍生态:${entry.stateText}`,
      }).catch(() => null);
      void logEvent({
        level: created ? "info" : "warn",
        category: "asset",
        operationId: createOperationId("storyboard-derived-landing"),
        message: created
          ? "Storyboard derived asset row landed (plan ⑦)"
          : "Storyboard derived asset row landing failed (fail-open)",
        context: {
          shotId: shot.id,
          compoundName: entry.compoundName,
          kind: entry.kind,
          stateText: entry.stateText,
        },
      });
    }
  } catch (error) {
    // fail-open:衍生落地不阻断分镜生图主链
    void logEvent({
      level: "warn",
      category: "asset",
      operationId: createOperationId("storyboard-derived-landing"),
      message: "Storyboard derived asset landing errored (fail-open)",
      context: {
        shotId: shot.id,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** 测试复位:清会话级失败/在飞/衍生幂等集合。 */
export function resetSceneLandingSessionState(): void {
  failedSceneNames.clear();
  inFlightSceneNames.clear();
  landedDerivedNames.clear();
}
