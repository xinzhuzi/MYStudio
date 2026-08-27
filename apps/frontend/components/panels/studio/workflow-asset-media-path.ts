import type { ContinuityAssetVersion } from "@/types/studio";
import type { Character } from "@/stores/library/character-library-store";
import type { Scene } from "@/stores/library/scene-store";
import type { PropItem } from "@/stores/library/props-library-store";

/**
 * 资产「当前样子」的有序候选媒体路径(08-27 二期 R2 唯一事实源):
 *
 * ① 最新批准连续性版本首图(权威最新——连续性在管的资产以它为准);
 * ② legacy 链(与一期锚写入/面板取图优先级逐字符一致,无连续性版本时行为不变)。
 *
 * 三个消费点共用:面板父卡显示取 candidates[0];锚写入记 candidates[0];
 * 过期比对命中候选集合任一即不算路径过期(一期已写锚的兼容层,宁可漏报)。
 * 纯函数,零 store 运行时依赖(仅 type import),无循环引用风险。
 */
export interface ResolveAssetCurrentMediaPathsInput {
  kind: "character" | "scene" | "prop";
  character?: Character;
  scene?: Scene;
  prop?: PropItem;
  latestApprovedVersion?: ContinuityAssetVersion | null;
}

export function resolveAssetCurrentMediaPaths(
  input: ResolveAssetCurrentMediaPathsInput,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: string | undefined | null) => {
    if (!value || typeof value !== "string") return;
    if (!candidates.includes(value)) candidates.push(value);
  };
  pushCandidate(input.latestApprovedVersion?.referenceImagePaths?.[0]);
  for (const legacy of resolveLegacyAssetMediaPaths(input)) {
    pushCandidate(legacy);
  }
  return candidates;
}

/**
 * 一期取图优先级(候选全量按序返回,不再「取首个非空」遮蔽后续——
 * 08-27 路径裁定:首位若是 data:/http,后面的项目相对文件仍要能进锚):
 * - character: thumbnailUrl → views 首张有图视图 → referenceImages[0]
 * - scene: referenceImage → referenceImageBase64 → contactSheetImage(非空白)
 * - prop: imageUrl
 */
function resolveLegacyAssetMediaPaths(
  input: ResolveAssetCurrentMediaPathsInput,
): Array<string | undefined> {
  if (input.kind === "character") {
    const character = input.character;
    if (!character) return [];
    return [
      character.thumbnailUrl,
      character.views.find((view) => view.imageUrl)?.imageUrl,
      character.referenceImages?.[0],
    ];
  }
  if (input.kind === "scene") {
    const scene = input.scene;
    if (!scene) return [];
    return [
      scene.referenceImage,
      scene.referenceImageBase64,
      scene.contactSheetImage?.trim() ? scene.contactSheetImage : undefined,
    ];
  }
  return [input.prop?.imageUrl];
}

/**
 * 「可持久化」判定(08-27 裁定:衍生资产相关路径必须落在项目目录下、以相对
 * 地址存储):只认项目相对虚拟协议(project-file://<projectId>/<相对路径>、
 * asset-file://<category>/<rest>)与裸相对路径;data:/http(s)/file: 等其它
 * scheme 与绝对文件系统路径一律不算。锚写入与过期比对只消费可持久化候选
 * (data: URL 落进锚会把兆级 base64 写进持久化 JSON);父卡显示不受此限。
 */
export function persistableProjectMediaPath(
  value: string | undefined | null,
): boolean {
  if (!value || typeof value !== "string") return false;
  if (
    value.startsWith("project-file://")
    || value.startsWith("asset-file://")
  ) {
    return true;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return !value.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(value);
}

/** 锚写入与过期比对用的候选集:resolveAssetCurrentMediaPaths 的可持久化子集。 */
export function resolvePersistableAssetCurrentMediaPaths(
  input: ResolveAssetCurrentMediaPathsInput,
): string[] {
  return resolveAssetCurrentMediaPaths(input).filter(persistableProjectMediaPath);
}
