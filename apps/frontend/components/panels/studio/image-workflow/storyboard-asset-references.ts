import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";

/**
 * 分镜关联资产 → 参考图解析(P2 自动挂载)。
 *
 * 数据链:storyboard.associateAssetsNames(分镜表「引用资产名称」列)→
 * studio-assets 桥 batchMatch(场景/角色两发)→ previewUrl(file:// 受管路径,
 * 与资产库展示同源)。场景在前(旧链 @图1 场景惯例)、角色在后(激活 prefix
 * 身份一致性锁);限场景 1 + 角色 3。
 *
 * ⚠️ 持久化纪律(2026-08-23 OOM 实证):节点只存 file:// 轻量 URL,严禁把
 * base64 dataURL 写进图/store——每图 MB 级,几十工作流曾把渲染进程堆到 2.4GB
 * OOM。生图传输在 use-image-workflow-generation 按需经 readImageDataUrl IPC
 * 转 dataURL(与 project-file 参考同口径,不落盘)。
 * 桥缺失/无命中/无图 → 空数组(fail-empty,建流不挂参考)。
 */
export async function resolveStoryboardAssetReferences(
  storyboard: Pick<StoryboardItem, "associateAssetsNames"> & Partial<Pick<StoryboardItem, "id">> | undefined,
): Promise<ImageWorkflowOpenContext["assetReferences"]> {
  const names = storyboard?.associateAssetsNames ?? [];
  if (!names.length) return [];
  const bridge = getStudioAssetsBridge();
  if (!bridge?.batchMatch) return [];

  const matches = await Promise.all([
    bridge.batchMatch({ type: "scene", names }),
    bridge.batchMatch({ type: "role", names }),
  ].map((call) => call.catch(() => [] as Array<{ name: string; asset: unknown }>)));

  const references: NonNullable<ImageWorkflowOpenContext["assetReferences"]> = [];
  const seen = new Set<string>();
  const collect = (
    entries: Array<{ name: string; asset: unknown }> | undefined,
    assetType: "scene" | "character",
    limit: number,
  ) => {
    if (!Array.isArray(entries)) return;
    let added = 0;
    for (const entry of entries) {
      if (added >= limit) break;
      const asset = entry.asset as {
        id?: string; name?: string; previewUrl?: string; thumbnailUrl?: string;
      } | null;
      const imageUrl = asset?.previewUrl ?? asset?.thumbnailUrl ?? "";
      const title = asset?.name || entry.name;
      if (!imageUrl || seen.has(title)) continue;
      seen.add(title);
      references.push({ imageUrl, title, assetType, assetId: asset?.id });
      added += 1;
    }
  };
  // 先场景后角色:collect 顺序即 continuityOrder 顺序
  collect(matches[0], "scene", 1);
  collect(matches[1], "character", 3);
  return references;
}
