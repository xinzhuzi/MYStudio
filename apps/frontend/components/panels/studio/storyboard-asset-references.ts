import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";

/**
 * 分镜关联资产 → 参考图解析(P2 自动挂载)。
 *
 * 数据链:storyboard.associateAssetsNames(分镜表「引用资产名称」列)→
 * studio-assets 桥 batchMatch(场景/角色两发)→ readImageDataUrl(主进程读
 * 受管资产图转 dataURL,<img> 显示与生图参考传输同构)。场景在前(旧链
 * @图1 场景惯例)、角色在后(激活 prefix 身份一致性锁);限场景 1 + 角色 3。
 * 桥缺失/无命中/无图 → 空数组(fail-empty,建流不挂参考,行为与旧版一致)。
 */
export async function resolveStoryboardAssetReferences(
  storyboard: Pick<StoryboardItem, "associateAssetsNames"> | undefined,
): Promise<ImageWorkflowOpenContext["assetReferences"]> {
  const names = storyboard?.associateAssetsNames ?? [];
  if (!names.length) return [];
  const bridge = getStudioAssetsBridge();
  if (!bridge?.batchMatch) return [];

  const matches = await Promise.all([
    bridge.batchMatch({ type: "scene", names }),
    bridge.batchMatch({ type: "role", names }),
  ].map((call) => call.catch(() => [] as Array<{ name: string; asset: { id?: string; name?: string } | null }>)));

  const references: NonNullable<ImageWorkflowOpenContext["assetReferences"]> = [];
  const seen = new Set<string>();
  const collect = async (
    entries: Array<{ name: string; asset: { id?: string; name?: string } | null }> | undefined,
    assetType: "scene" | "character",
    limit: number,
  ) => {
    if (!Array.isArray(entries)) return;
    let added = 0;
    for (const entry of entries) {
      if (added >= limit) break;
      const assetId = entry.asset?.id;
      const title = entry.asset?.name || entry.name;
      if (!assetId || seen.has(title)) continue;
      const imageUrl = await bridge.readImageDataUrl?.(assetId).catch(() => null);
      if (!imageUrl) continue;
      seen.add(title);
      references.push({ imageUrl, title, assetType, assetId });
      added += 1;
    }
  };
  // 先场景后角色:collect 顺序即 continuityOrder 顺序
  await collect(matches[0], "scene", 1);
  await collect(matches[1], "character", 3);
  return references;
}
