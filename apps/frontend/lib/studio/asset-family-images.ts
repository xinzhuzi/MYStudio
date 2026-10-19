import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { getPrimaryAssetName } from "@/lib/studio/asset-names";

/**
 * R4 角色族聚显(10-19-script-asset-corridor-blank D1+D3):
 * 剧本资产行详情聚显该实体族全部生成图——聚合键=batchMatch 同源候选全集
 * (主进程 listAssetFamilyAssets 按 buildAssetNameCandidateCondition 取行,
 * 天然含别名/remark 命中),排序=updatedAt 倒序(新图在前);场景/道具同口径。
 * 族聚仅显示层:非当前打开行的条目只读,不参与增删改(与 10-19-asset-name-folders
 * D4「盘上精确名夹」互不冲突——这里不落盘)。
 */

/** 族内一条可展示图(携带所属资产行 id,供合并时区分本行可编辑/族兄弟只读)。 */
export interface FamilyImageEntry extends AssetImage {
  assetId: string;
}

/** 弹窗轮播展示条目:readOnly=族兄弟行条目(只读聚显);removable=允许删除。 */
export interface FamilyDisplayImageEntry extends FamilyImageEntry {
  readOnly: boolean;
  removable: boolean;
}

/**
 * 把主进程返回的族 summaries(调用方保证已 updatedAt 倒序)平铺为图条目:
 * 每行 [主图(previewUrl/thumbnailUrl), ...images[]],跳过无图行,跨行按
 * filePath 去重(先到先得=新行优先)。
 */
export function buildFamilyImageEntries(family: StudioAssetSummary[]): FamilyImageEntry[] {
  const seenFilePaths = new Set<string>();
  const entries: FamilyImageEntry[] = [];
  for (const summary of family) {
    const rowImages: Array<Pick<AssetImage, "name" | "filePath" | "url">> = [];
    const mainUrl = summary.previewUrl || summary.thumbnailUrl;
    if (mainUrl && summary.filePath) {
      rowImages.push({ name: getPrimaryAssetName(summary.name), filePath: summary.filePath, url: mainUrl });
    }
    for (const image of summary.images ?? []) {
      if (!image.filePath) continue;
      rowImages.push({ name: image.name, filePath: image.filePath, url: image.url });
    }
    for (const image of rowImages) {
      if (seenFilePaths.has(image.filePath)) continue;
      seenFilePaths.add(image.filePath);
      entries.push({ ...image, assetId: summary.id });
    }
  }
  return entries;
}

/**
 * 族条目 × 本行 live 图(弹窗 images 状态)合并为轮播展示序:
 * - 稳态 = 族序(updatedAt 倒序);本行条目沿用 live 版本(可编辑),族兄弟只读;
 * - live 新图(换主图/新增——filePath 不在族集合)= 最新,置顶可编辑;
 * - 本行旧图被换掉/删掉(filePath 不在 live)→ 族位条目过滤,不再展示。
 * family 为 undefined(桥缺席/查询失败)→ 退化为纯本行图(旧弹窗行为);
 * family 为空数组 → 同退化(App 家库无候选行的合成资产场景)。
 */
export function mergeFamilyDisplayImages(
  family: FamilyImageEntry[] | undefined,
  ownImages: AssetImage[],
  primaryAssetId: string | undefined,
): FamilyDisplayImageEntry[] {
  const ownByFilePath = new Map(ownImages.map((image) => [image.filePath, image]));
  const familyFilePaths = new Set(family?.map((entry) => entry.filePath) ?? undefined);

  const display: FamilyDisplayImageEntry[] = [];
  // 1) live 新图置顶(可编辑;10-19 用户裁定:主图亦可删——本行自有图一律 removable)
  ownImages.forEach((image) => {
    if (familyFilePaths.has(image.filePath)) return;
    display.push({
      ...image,
      assetId: primaryAssetId ?? "",
      readOnly: false,
      removable: true,
    });
  });
  // 2) 族序条目:本行命中 live → 用 live 版本(可编辑,含主图,同 10-19 可删裁定);
  //    族兄弟只读不可删
  for (const entry of family ?? []) {
    const live = ownByFilePath.get(entry.filePath);
    if (entry.assetId === primaryAssetId) {
      if (!live) continue; // 本行旧图已被换/被删
      display.push({
        ...live,
        assetId: entry.assetId,
        readOnly: false,
        removable: true,
      });
      continue;
    }
    if (live) continue; // 与本行同 filePath 的族条目已由 live 展示,防重
    display.push({ ...entry, readOnly: true, removable: false });
  }
  return display;
}

/** 弹窗动作钩子用:按 filePath 在展示序中定位(增删图后高亮新位置)。 */
export function findDisplayImageIndex(
  display: FamilyDisplayImageEntry[],
  filePath: string | undefined,
): number {
  if (!filePath) return -1;
  return display.findIndex((entry) => entry.filePath === filePath);
}

/**
 * 行打开时取族:桥缺席(旧 preload/非桌面)或查询失败 → undefined(回落本行图);
 * 命中 → 族条目(主进程已按 updatedAt 倒序返回,平铺保序)。
 */
export async function fetchFamilyImageEntries(
  bridge: { listFamily?: (payload: { type: string; name: string }) => Promise<StudioAssetSummary[]> } | undefined,
  type: string,
  name: string,
): Promise<FamilyImageEntry[] | undefined> {
  if (!bridge?.listFamily) return undefined;
  try {
    const family = await bridge.listFamily({ type, name });
    return buildFamilyImageEntries(family ?? []);
  } catch {
    // 聚显是增强不是依赖:失败静默回落单行显示,不阻断详情打开
    return undefined;
  }
}
