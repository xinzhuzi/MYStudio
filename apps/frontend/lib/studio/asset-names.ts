const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;

export interface ParsedAssetNames {
  rawName: string;
  primaryName: string;
  secondaryNames: string[];
  allNames: string[];
}

export function parseAssetNames(value?: string | null, fallback = "未命名素材"): ParsedAssetNames {
  const rawName = value?.trim() ?? "";
  // 别名分隔符:中英文分号与中英文逗号都认(2026-08-22 用户裁定;formatAssetName 落库仍统一归一为英文分号)
  const names = uniqueNames(
    rawName
      .split(/[;；,，]/)
      .map(cleanAssetNameSegment)
      .filter(Boolean),
  );
  const allNames = names.length > 0 ? names : [fallback];
  return {
    rawName,
    primaryName: allNames[0] ?? fallback,
    secondaryNames: allNames.slice(1),
    allNames,
  };
}

export function getPrimaryAssetName(value?: string | null, fallback = "未命名素材") {
  return parseAssetNames(value, fallback).primaryName;
}

export function getSecondaryAssetNames(value?: string | null) {
  return parseAssetNames(value).secondaryNames;
}

export function formatAssetName(primaryName: string, aliases: string[] = []) {
  return parseAssetNames([primaryName, ...aliases].filter(Boolean).join(";")).allNames.join(";");
}

export function assetNameMatchesQuery(assetName: string | undefined | null, query: string) {
  const normalizedQuery = normalizeComparableName(query);
  if (!normalizedQuery) return false;
  return parseAssetNames(assetName).allNames.some((name) => normalizeComparableName(name) === normalizedQuery);
}

/**
 * F5①(1115 补完役):包含语义匹配器(旁挂)——查询词归一化后被资产主名/别名完整
 * 包含(短名「灵矿」→全名「灵矿坑道葬玉」)。只供 batchMatchAssets 的包含命中层
 * 消费;getAssetByName/listAssets 的全等主路径(assetNameMatchesQuery)零改动。
 * 短词防误吞:归一化后不足 2 字不收(单字「铜」不应包含命中一切含铜资产——
 * 「matches assets by semicolon-separated secondary names」既有口径回归锁)。
 */
export function assetNameContainsQuery(assetName: string | undefined | null, query: string) {
  const normalizedQuery = normalizeComparableName(query);
  if (normalizedQuery.length < 2) return false;
  return parseAssetNames(assetName).allNames.some((name) => normalizeComparableName(name).includes(normalizedQuery));
}

export function cleanAssetNameSegment(value: string) {
  const text = value.trim();
  if (!text) return "";
  const fileName = text.split(/[\\/]/).filter(Boolean).pop() || text;
  return fileName.replace(MEDIA_EXT_PATTERN, "").trim() || fileName;
}

function normalizeComparableName(value: string) {
  return cleanAssetNameSegment(value)
    .replace(/\s+/g, "")
    .toLocaleLowerCase("zh-Hans-CN");
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = normalizeComparableName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
