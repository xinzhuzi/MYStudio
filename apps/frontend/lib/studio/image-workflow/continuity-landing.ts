// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 生图落库 → 视觉连续性三件套自动接线(2026-08-24 方案 2)。
 *
 * 背景:旧 Python 生图链退役后,orderedReferenceManifest/continuityState 无人
 * 写入,单镜生产被 assertVisualContinuityApproved 整章闸拦死(82 镜曾靠
 * apps/build/scripts/storyboard_continuity_backfill.py 一次性回填)。本模块把
 * 回填口径固化进现链:分镜生图回写媒体的同时,把工作流参考节点解析成连续性
 * 三件套落库,此后换新一代分镜走正常生图流程即自带连续性数据。
 *
 * 语义口径与回填脚本一致:
 * - 参考节点(资产源+可解析版本)→ 有序清单:首个场景=scene-viewpoint,其余
 *   场景=secondary-scene,角色=canonical,道具=prop-state;
 * - continuityState.characters 取 shotSemantics.visibleCharacters 中能匹配上
 *   角色参考者(画面外/无版本角色不入,沿 S08 身份防线);
 * - groupId 按「章:场景资产」分组,previousStoryboardId=同场上一镜(兼容
 *   `${episode}:backfill:${asset}` 历史回填格式);
 * - 指纹全部用 lib/studio/visual-continuity 原生函数计算,审计链自洽。
 */
import {
  storyboardShotSemanticsFingerprint,
  visualContinuityFingerprint,
} from "@/lib/studio/visual-continuity";
import type {
  ContinuityAssetVersion,
  ImageWorkflowGraph,
  ImageWorkflowReferenceNode,
  ShotContinuityState,
  StoryboardItem,
  StoryboardOrderedReference,
} from "@/types/studio";

/** 视角关键词提示:shotSemantics.sceneViewpointId 中文标签 → 版本视角 token。 */
const VIEWPOINT_HINTS: ReadonlyArray<readonly [keyword: string, tokens: readonly string[]]> = [
  ["夜", ["night"]],
  ["归", ["night"]],
  ["醒", ["night"]],
  ["窗", ["window"]],
  ["柜台", ["counter"]],
  ["大堂", ["counter"]],
  ["课", ["school", "desk"]],
  ["书", ["desk"]],
  ["灯", ["lamp", "desk"]],
  ["教", ["school"]],
];

/** 角色名归一:去画外音/群演记法后缀,再去职业/年龄前缀(两侧同规)。 */
const NAME_SUFFIX_RE = /(?:OS|V\.S\.)$/;
const NAME_PREFIX_RE = /^(?:监工|管事|老|年轻|小)/;

function canonName(name: string): string {
  return NAME_SUFFIX_RE.test(name) ? name.replace(NAME_SUFFIX_RE, "").trim() : name.trim();
}

function namesMatch(semanticName: string, referenceTitle: string): boolean {
  const left = canonName(semanticName);
  const right = canonName(referenceTitle);
  if (!left || !right) return false;
  if (left === right) return true;
  const bareRight = NAME_PREFIX_RE.test(right) ? right.replace(NAME_PREFIX_RE, "") : right;
  const bareLeft = NAME_PREFIX_RE.test(left) ? left.replace(NAME_PREFIX_RE, "") : left;
  if (bareLeft.length >= 2 && bareRight.length >= 2 && (bareLeft === bareRight || right.endsWith(left) || left.endsWith(bareRight))) {
    return true;
  }
  return left.length >= 2 && (left.includes(right) || right.includes(left));
}

/** 实体名匹配(资产库↔角色/场景/道具库两套 id 空间的桥,胶水层建索引用)。 */
export const entityNameMatches = namesMatch;

function pickSceneVersion(versions: ContinuityAssetVersion[], label: string): ContinuityAssetVersion | undefined {
  if (versions.length <= 1) return versions[0];
  const text = label || "";
  for (const [keyword, tokens] of VIEWPOINT_HINTS) {
    if (!text.includes(keyword)) continue;
    const hit = versions.find((version) => {
      const viewpoint = version.sceneViewpointId ?? "";
      return tokens.every((token) => viewpoint.includes(token));
    });
    if (hit) return hit;
  }
  return [...versions].sort((left, right) => left.versionId.localeCompare(right.versionId))[0];
}

function sameSceneGroup(groupId: string | undefined, episodeId: string, sceneAssetId: string): boolean {
  if (!groupId) return false;
  return groupId === `${episodeId}:scene:${sceneAssetId}`
    || groupId === `${episodeId}:backfill:${sceneAssetId}`;
}

function compactReference(reference: StoryboardOrderedReference): StoryboardOrderedReference {
  return Object.fromEntries(
    Object.entries(reference).filter(([, value]) => value !== undefined && value !== null),
  ) as StoryboardOrderedReference;
}

function buildReference(
  order: number,
  assetId: string,
  assetName: string,
  version: ContinuityAssetVersion,
  role: StoryboardOrderedReference["referenceRole"],
): StoryboardOrderedReference {
  const reference: StoryboardOrderedReference = {
    order,
    assetId,
    assetName,
    assetKind: version.assetKind as StoryboardOrderedReference["assetKind"],
    imagePath: version.referenceImagePaths[0],
    referenceImagePaths: version.referenceImagePaths,
    referenceImageSha256: version.referenceImageSha256,
    referenceViewTypes: version.referenceViewTypes ?? [],
    source: version.source,
    versionId: version.versionId,
    referenceRole: role,
    contentFingerprint: version.contentFingerprint,
    approved: version.approved ?? false,
  };
  if (version.approvalFingerprint) reference.approvalFingerprint = version.approvalFingerprint;
  if (version.assetKind === "scene") {
    reference.sceneViewpointId = version.sceneViewpointId;
  } else {
    reference.identityAnchors = version.identityAnchors;
    reference.negativePrompt = version.negativePrompt;
    reference.wardrobeVersion = version.wardrobeVersion;
  }
  return compactReference(reference);
}

export interface StoryboardContinuityLandingInput {
  storyboard: StoryboardItem;
  graph: ImageWorkflowGraph;
  /** 成图节点 id(参考清单按「连到该节点的参考节点」收集)。 */
  generatedNodeId: string;
  continuityAssetVersions: ContinuityAssetVersion[];
  /** 全章分镜:解析同场上一镜的 previousStoryboardId。 */
  storyboards: StoryboardItem[];
  /**
   * 资产库 id → 连续性实体键(角色/场景/道具库 id)解析器。参考节点的
   * source.id 是资产库 UUID,连续性版本按实体 id 登记(双 id 空间),胶水
   * 层用实体库名称索引桥接;缺省直接透传(参考节点存实体 id 的旧图兼容)。
   */
  resolveAssetKey?: (assetType: string, assetLibraryId: string, title: string) => string | undefined;
}

export interface StoryboardContinuityLandingPatch {
  orderedReferenceManifest: StoryboardOrderedReference[];
  continuityState: ShotContinuityState;
}

/**
 * 从工作流参考节点构建连续性三件套补丁。
 * 返回 null = 前置条件不满足(缺逐镜语义/无场景版本/图非分镜目标),调用方
 * 应静默跳过——连续性接线是装饰增强,绝不阻塞生图主链。
 */
export function buildStoryboardContinuityLanding(
  input: StoryboardContinuityLandingInput,
): StoryboardContinuityLandingPatch | null {
  const { storyboard, graph, generatedNodeId, continuityAssetVersions, storyboards, resolveAssetKey } = input;
  const semantics = storyboard.shotSemantics;
  if (graph.target.kind !== "storyboard" || !semantics) return null;

  const generated = graph.nodes.find((node) => node.id === generatedNodeId && node.type === "generated");
  if (!generated) return null;

  const referenceNodes: ImageWorkflowReferenceNode[] = graph.edges
    .filter((edge) => edge.target === generatedNodeId)
    .map((edge) => graph.nodes.find((node) => node.id === edge.source))
    .filter((node): node is ImageWorkflowReferenceNode =>
      Boolean(node && node.type === "reference" && node.imageUrl
        && node.source?.kind === "asset" && Boolean(node.source.id) && Boolean(node.source.assetType)))
    .sort((left, right) => (left.continuityOrder ?? Number.MAX_SAFE_INTEGER) - (right.continuityOrder ?? Number.MAX_SAFE_INTEGER));

  const versionsByAsset = new Map<string, ContinuityAssetVersion[]>();
  for (const version of continuityAssetVersions) {
    const bucket = versionsByAsset.get(version.assetId);
    if (bucket) bucket.push(version);
    else versionsByAsset.set(version.assetId, [version]);
  }

  const viewpointLabel = String(semantics.sceneViewpointId ?? "");
  const resolved = referenceNodes.flatMap((node) => {
    const source = node.source;
    if (!source || source.kind !== "asset" || !source.id || !source.assetType) return [];
    const title = node.title?.trim() || "";
    const entityKey = resolveAssetKey?.(source.assetType, source.id, title) ?? source.id;
    const candidates = versionsByAsset.get(entityKey) ?? [];
    const version = node.continuityVersionId
      ? candidates.find((candidate) => candidate.versionId === node.continuityVersionId)
        ?? pickSceneVersion(candidates, viewpointLabel)
      : pickSceneVersion(candidates, viewpointLabel);
    if (!version) return [];
    return [{
      assetId: entityKey,
      assetName: title || entityKey,
      version,
    }];
  });
  if (!resolved.some((entry) => entry.version.assetKind === "scene")) return null;

  const sceneEntries = resolved.filter((entry) => entry.version.assetKind === "scene");
  const characterEntries = resolved.filter((entry) => entry.version.assetKind === "character");
  const propEntries = resolved.filter((entry) => entry.version.assetKind === "prop");
  const primaryScene = sceneEntries[0]!;

  const orderedReferenceManifest: StoryboardOrderedReference[] = [];
  let order = 1;
  orderedReferenceManifest.push(
    buildReference(order++, primaryScene.assetId, primaryScene.assetName, primaryScene.version, "scene-viewpoint"),
  );
  for (const entry of sceneEntries.slice(1)) {
    orderedReferenceManifest.push(buildReference(order++, entry.assetId, entry.assetName, entry.version, "secondary-scene"));
  }
  for (const entry of characterEntries) {
    orderedReferenceManifest.push(buildReference(order++, entry.assetId, entry.assetName, entry.version, "canonical"));
  }
  for (const entry of propEntries) {
    orderedReferenceManifest.push(buildReference(order++, entry.assetId, entry.assetName, entry.version, "prop-state"));
  }

  const characters = characterEntries.flatMap((entry) => {
    const visible = (semantics.visibleCharacters ?? []).find(
      (candidate) => namesMatch(String(candidate.name ?? ""), entry.assetName),
    );
    if (!visible) return [];
    return [{
      characterId: entry.assetId,
      versionId: entry.version.versionId,
      position: String(visible.position ?? ""),
      orientation: String(visible.orientation ?? ""),
      actionIn: String(visible.actionIn ?? ""),
      actionOut: String(visible.actionOut ?? ""),
    }];
  });

  const groupId = `${storyboard.episodeId}:scene:${primaryScene.assetId}`;
  const previous = storyboards
    .filter((candidate) => candidate.index < storyboard.index
      && sameSceneGroup(candidate.continuityState?.groupId, storyboard.episodeId, primaryScene.assetId))
    .sort((left, right) => right.index - left.index)[0];

  const continuityState: ShotContinuityState = {
    groupId,
    ...(previous ? { previousStoryboardId: previous.id } : {}),
    sceneVersionId: primaryScene.version.versionId,
    sceneViewpointId: primaryScene.version.sceneViewpointId ?? "",
    lighting: primaryScene.version.lightingDesign ?? "",
    palette: primaryScene.version.colorPalette ?? "",
    actionIn: String(semantics.actionIn ?? characters[0]?.actionIn ?? ""),
    actionOut: String(semantics.actionOut ?? characters[characters.length - 1]?.actionOut ?? ""),
    characters,
    sourceSemanticsFingerprint: storyboardShotSemanticsFingerprint(semantics),
    inputFingerprint: "",
  };
  continuityState.inputFingerprint = visualContinuityFingerprint({
    prompt: storyboard.prompt,
    orderedReferenceManifest,
    continuityState,
  });

  return { orderedReferenceManifest, continuityState };
}
