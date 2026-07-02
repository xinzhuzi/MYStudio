const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;

export interface ParsedAssetNames {
  rawName: string;
  primaryName: string;
  secondaryNames: string[];
  allNames: string[];
}

export function parseAssetNames(value?: string | null, fallback = "未命名素材"): ParsedAssetNames {
  const rawName = value?.trim() ?? "";
  const names = uniqueNames(
    rawName
      .split(/[;；]/)
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
