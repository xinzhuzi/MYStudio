/**
 * 分镜换线正典上下文装配(1116,PRD 11-16-storyboard-canonical-line §4.1-4.3/§4.5)。
 *
 * 职责:把分镜行(StoryboardItem)与三库/资产库数据装配成正典生成器的纯输入
 * (lib/studio/storyboard-canonical-prompt),供建流期(主体句)与传输期(i2i 指令)
 * 两点位消费。数据通路全部走产品正路(studio-assets 桥只读/三库 store 只读),
 * 零直写。
 *
 * 身份段数据源(§4.3 定谳,1116 第 0 步回填):①资产库 assets.promptOverrides
 * 「分镜剧情图」键(存储/编辑 UI 已在,本模块=第一个分镜域消费者);②缺槽时
 * 回落三库角色库中文视觉字段(variations.visualPromptZh→appearance→description,
 * 按事实逐字,禁编造)——生产者(LLM 校准/手编入库)后续按同键落库即自动接管。
 */

import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import {
  buildCanonicalSubjectSentence,
  buildCanonicalTransportInstruction,
  mapCanonicalReferenceSlots,
  type CanonicalIdentityParagraph,
  type CanonicalSubjectInput,
} from "@/lib/studio/storyboard-canonical-prompt";
import {
  buildStoryboardFactionColorSection,
  splitCompoundAssetName,
} from "@/lib/studio/storyboard-frame-prompt";
import { getExtendedStoryboardFactionData } from "@/lib/studio/visual-manual-style-tokens";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useProjectStore } from "@/stores/project/project-store";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";

/** promptOverrides「分镜剧情图」键(§4.3 定谳落点;存储层无枚举约束)。 */
export const STORYBOARD_IDENTITY_OVERRIDE_KEY = "分镜剧情图";

function parsePromptOverride(raw: string | undefined, key: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/** 名单匹配(复合资产名「李先生;管事」拆段+双向包含,与资产解析层同口径)。 */
function nameMatches(query: string, candidateName: string): boolean {
  const q = query.trim();
  const name = candidateName.trim();
  if (!q || !name) return false;
  if (q === name || name.includes(q) || q.includes(name)) return true;
  return splitCompoundAssetName(q).some((part) => name.includes(part));
}

/** 三库场景行匹配(复合名拆段+双向包含;scene 落地驱动与场景事实共用)。 */
export function findSceneRowForNames(names: string[]): ReturnType<typeof useSceneStore.getState>["scenes"][number] | null {
  if (!names.length) return null;
  const projectId = useProjectStore.getState().activeProjectId;
  const scenes = useSceneStore
    .getState()
    .scenes.filter((scene) => !projectId || !scene.projectId || scene.projectId === projectId);
  return scenes.find((scene) => names.some((name) => nameMatches(name, scene.name))) ?? null;
}

/** 三库场景事实(§7 场景定场:名称+地点+天候+氛围;查无=null 不编造)。 */
function resolveSceneFact(shot: Pick<StoryboardItem, "associateAssetsNames">) {
  const hit = findSceneRowForNames(shot.associateAssetsNames ?? []);
  if (!hit) return null;
  return {
    name: hit.name,
    location: hit.location || undefined,
    time: hit.time || undefined,
    atmosphere: hit.atmosphere || undefined,
  };
}

/**
 * 身份段解析(§4.3):逐可见角色①资产库 promptOverrides 键(逐字搬运)
 * →②角色库中文视觉字段回落。缺桥/缺行/缺槽回落下一级,全缺=absent 告警。
 */
async function resolveIdentityParagraphs(
  characterNames: string[],
): Promise<CanonicalIdentityParagraph[]> {
  const bridge = getStudioAssetsBridge();
  const projectId = useProjectStore.getState().activeProjectId;
  const library = useCharacterLibraryStore.getState().characters;
  const identities: CanonicalIdentityParagraph[] = [];
  for (const name of characterNames.map((entry) => entry.trim()).filter(Boolean)) {
    let identity: CanonicalIdentityParagraph | undefined;
    if (bridge?.getByName) {
      try {
        const asset = await bridge.getByName({ type: "role", name });
        const override = parsePromptOverride(asset?.promptOverrides, STORYBOARD_IDENTITY_OVERRIDE_KEY);
        if (override) identity = { name, paragraph: override, origin: "asset-override" };
      } catch {
        // 桥查询失败回落三库,不留痕阻断(建流 fail-safe)
      }
    }
    if (!identity) {
      const character = library.find(
        (entry) => nameMatches(name, entry.name)
          && (!projectId || !entry.projectId || entry.projectId === projectId),
      );
      const fallback = character?.variations?.find((variation) => variation.visualPromptZh?.trim())?.visualPromptZh
        ?? character?.appearance
        ?? character?.description
        ?? "";
      if (fallback.trim()) identity = { name, paragraph: fallback.trim(), origin: "character-library" };
    }
    if (identity) identities.push(identity);
  }
  return identities;
}

/** 阵营色明文行(明文设定色级,裁决序最内层;PRD §三迁移——逐字进主体句)。 */
function resolveFactionColorLines(shot: StoryboardItem): string[] {
  const section = buildStoryboardFactionColorSection(
    {
      sceneNames: shot.associateAssetsNames,
      personNames: shot.shotSemantics?.visibleCharacters.map((character) => character.name)
        ?? shot.associateAssetsNames,
      propNames: shot.shotSemantics?.visibleProps.map((prop) => prop.name),
    },
    getExtendedStoryboardFactionData(),
  );
  if (!section) return [];
  // 剥旧链【色彩】段头,保留明文行(型头语言归型层,主体句只载事实)
  const body = section.replace(/^【色彩】阵营色彩职责\s*/, "");
  return body ? body.split(";").map((line) => line.trim()).filter(Boolean) : [];
}

export interface StoryboardCanonicalContextResult {
  subject: CanonicalSubjectInput;
  sentence: ReturnType<typeof buildCanonicalSubjectSentence>;
}

/** 建流期正典主体句上下文(主体句=图内 prompt 节点值;装配告警留痕)。 */
export async function buildStoryboardCanonicalContext(
  shot: StoryboardItem,
): Promise<StoryboardCanonicalContextResult> {
  const visibleCharacters = shot.shotSemantics?.visibleCharacters ?? [];
  const identities = await resolveIdentityParagraphs(visibleCharacters.map((character) => character.name));
  const subject: CanonicalSubjectInput = {
    description: shot.videoDesc || shot.prompt || "",
    identities,
    visibleCharacters: visibleCharacters.map((character) => ({
      name: character.name,
      position: character.position || undefined,
      orientation: character.orientation || undefined,
      actionIn: character.actionIn || undefined,
      actionOut: character.actionOut || undefined,
    })),
    visibleProps: (shot.shotSemantics?.visibleProps ?? []).map((prop) => ({
      name: prop.name,
      position: prop.position || undefined,
      state: prop.state || undefined,
    })),
    scene: resolveSceneFact(shot),
    lighting: shot.continuityState?.lighting || undefined,
    factionColorLines: resolveFactionColorLines(shot),
  };
  const sentence = buildCanonicalSubjectSentence(subject);
  if (sentence.warnings.length) {
    void logEvent({
      level: "warn",
      category: "ai",
      operationId: createOperationId("storyboard-canonical-subject"),
      message: "Storyboard canonical subject assembled with fact gaps",
      context: { shotId: shot.id, shotIndex: shot.index, warnings: sentence.warnings },
    });
  }
  return { subject, sentence };
}

// ─── 传输期槽位源提取(§4.5) ───

export interface CanonicalSlotSources {
  /** 角色(continuityOrder 升序;主角=首位)。 */
  characters: Array<{ title: string; imageUrl: string }>;
  scenes: Array<{ title: string; imageUrl: string }>;
  props: Array<{ title: string; imageUrl: string }>;
  /** 帧间链上一帧成图(gen(k-1)→gen(k) 边;无=undefined)。 */
  previousFrameImageUrl?: string;
}

/**
 * 从图内提取槽位源:塌缩视图下连向目标成图节点的资产参考按型分桶
 * (continuityOrder 升序=主角在前),上游成图边=前帧。与 request 组装层
 * (buildImageWorkflowGenerationRequest)同口径收参。
 */
export function extractCanonicalSlotSources(
  graph: ImageWorkflowGraph,
  targetNodeId: string,
): CanonicalSlotSources {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const upstream = graph.edges
    .filter((edge) => edge.target === targetNodeId)
    .map((edge) => byId.get(edge.source))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const bucket = (assetType: "character" | "scene" | "prop") => upstream
    .filter((node) =>
      node.type === "reference"
      && node.source?.kind === "asset"
      && node.source.assetType === assetType
      && Boolean(node.imageUrl))
    .sort((left, right) =>
      ((left.type === "reference" ? left.continuityOrder : Number.MAX_SAFE_INTEGER) ?? Number.MAX_SAFE_INTEGER)
      - ((right.type === "reference" ? right.continuityOrder : Number.MAX_SAFE_INTEGER) ?? Number.MAX_SAFE_INTEGER))
    .map((node) => ({
      title: (node.type === "reference" ? node.title : "") ?? "",
      imageUrl: (node.type === "reference" ? node.imageUrl : "") ?? "",
    }));
  const previousFrame = upstream.find(
    (node) => node.type === "generated" && Boolean(node.resultUrl),
  );
  return {
    characters: bucket("character"),
    scenes: bucket("scene"),
    props: bucket("prop"),
    previousFrameImageUrl: previousFrame?.type === "generated" ? previousFrame.resultUrl ?? undefined : undefined,
  };
}

export interface StoryboardCanonicalTransportInput {
  /** 体裁化终稿(体裁路由:零槽=t2i 主体句;有槽=i2i 指令体)。 */
  instruction: ReturnType<typeof buildCanonicalTransportInstruction>;
  /** §4.5 槽位映射结果(含裁出名单)。 */
  mapping: ReturnType<typeof mapCanonicalReferenceSlots>;
}

/**
 * 传输期正典装配(提交点位):按目标帧节点解析帧时刻描述→重建主体句上下文
 * →§4.5 槽位映射→体裁化指令。建流期主体句与传输期指令同源同函数,身份段
 * 逐字同源复用。
 */
export async function buildStoryboardCanonicalTransportInput(
  shot: StoryboardItem,
  graph: ImageWorkflowGraph,
  targetNodeId: string,
  dropSlotIndexes: number[] = [],
): Promise<StoryboardCanonicalTransportInput> {
  const targetNode = graph.nodes.find((node) => node.id === targetNodeId);
  const frameId = targetNode?.type === "generated" ? targetNode.frameId : undefined;
  const momentNote = frameId
    ? shot.keyframes?.find((frame) => frame.frameId === frameId)?.momentDescription
    : undefined;
  const { subject } = await buildStoryboardCanonicalContext(shot);
  const effectiveSubject = momentNote?.trim()
    ? { ...subject, momentNote: momentNote.trim() }
    : subject;
  const mapping = mapCanonicalReferenceSlots(extractCanonicalSlotSources(graph, targetNodeId));
  // 1116 三代修:传输层单姿裁切失败的槽(dropSlotIndexes,0 基)在此剔除并
  // 重编号——指令体的 <imageN> 编号与实际入槽图恒连续同构(宁缺勿染)。
  if (dropSlotIndexes.length) {
    const dropped = new Set(dropSlotIndexes);
    const kept = mapping.slots
      .filter((_, index) => !dropped.has(index))
      .map((slot, index) => ({ ...slot, slot: (index + 1) as 1 | 2 | 3 }));
    mapping.slots = kept;
  }
  if (mapping.dropped.length) {
    void logEvent({
      level: "info",
      category: "workflow",
      operationId: createOperationId("storyboard-slot-dropped"),
      message: "Storyboard canonical slot mapping dropped references (§4.5)",
      context: {
        shotId: shot.id,
        shotIndex: shot.index,
        dropped: mapping.dropped,
        slots: mapping.slots.map((slot) => ({ slot: slot.slot, role: slot.role, title: slot.title })),
      },
    });
  }
  return {
    instruction: buildCanonicalTransportInstruction({ subject: effectiveSubject, slots: mapping.slots }),
    mapping,
  };
}

// ── 单姿裁切(1116 第六病理三代修,移植自 2d312474 拼板层 singlePoseCropRect)──
// 命令原文(1115):「只有设定卡时,出图前裁/选正面单姿为参考,禁整卡」。
// 拼板退役时该刀被误删——赵四类无 _人物图_/_正视图_ 单姿资产,主图=横幅
// 多视图卡整卡进 image_1 → 引擎翻拍整卡=转面稿四副本(C1 二发 4/6 污染,
// Win history 实证守卫句在链仍压不住)。算法原样移植:探针列占用分析,
// 最左连续内容块(零桥接)=正面单姿;横幅(宽>高)才裁;场景恒不裁;
// 检测失败=丢槽留痕(宁缺勿染,禁整卡入参考)。
// 2d312474 原语义:竖幅已是单姿→原图保留;横幅裁不出→整图兜底(拼板贴格)。
// 本层取消整图兜底(整卡入参考即病理),但竖幅仍必须原样保留——竖幅被当
// 「裁切失败」丢槽会抽掉主角立绘(image_1),身份参考归零。
const POSE_PROBE_WIDTH = 512;
const POSE_BG_COLOR_DISTANCE = 60;
const POSE_CONTENT_COLUMN_RATIO = 0.12;

export interface StoryboardCropImageSource {
  naturalWidth: number;
  naturalHeight: number;
}

function singlePoseCropRect(
  image: StoryboardCropImageSource,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  if (!fullWidth || !fullHeight || fullWidth <= fullHeight) return null;
  const probeWidth = Math.min(POSE_PROBE_WIDTH, fullWidth);
  const probeHeight = Math.max(1, Math.round(fullHeight * probeWidth / fullWidth));
  let analysis: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = probeWidth;
    canvas.height = probeHeight;
    analysis = canvas.getContext("2d", { willReadFrequently: true });
    if (!analysis || typeof analysis.getImageData !== "function" || typeof analysis.drawImage !== "function") return null;
    analysis.drawImage(image as CanvasImageSource, 0, 0, probeWidth, probeHeight);
  } catch {
    return null;
  }
  let pixels: Uint8ClampedArray;
  try {
    pixels = analysis.getImageData(0, 0, probeWidth, probeHeight).data;
  } catch {
    return null;
  }
  const sample = (x: number, y: number): [number, number, number] => {
    const at = (y * probeWidth + x) * 4;
    return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
  };
  const corners: Array<[number, number, number]> = [];
  for (const [cx, cy] of [[2, 2], [probeWidth - 3, 2], [2, probeHeight - 3], [probeWidth - 3, probeHeight - 3]] as const) {
    corners.push(sample(Math.max(0, Math.min(probeWidth - 1, cx)), Math.max(0, Math.min(probeHeight - 1, cy))));
  }
  const bg = corners.reduce(
    (acc, c) => [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  const bandTop = Math.floor(probeHeight * 0.15);
  const bandBottom = Math.max(bandTop + 1, Math.floor(probeHeight * 0.9));
  const isBackground = (x: number, y: number): boolean => {
    const [r, g, b] = sample(x, y);
    const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
    return Math.sqrt(dr * dr + dg * dg + db * db) < POSE_BG_COLOR_DISTANCE;
  };
  const hasContent = new Array<boolean>(probeWidth);
  for (let x = 0; x < probeWidth; x += 1) {
    let content = 0;
    for (let y = bandTop; y < bandBottom; y += 1) {
      if (!isBackground(x, y)) content += 1;
    }
    hasContent[x] = content / (bandBottom - bandTop) >= POSE_CONTENT_COLUMN_RATIO;
  }
  let first = -1;
  let last = -1;
  for (let x = 0; x < probeWidth; x += 1) {
    if (hasContent[x]) { first = x; break; }
  }
  if (first < 0) return null;
  for (let x = first + 1; x < probeWidth; x += 1) {
    if (!hasContent[x]) break;
    last = x;
  }
  if (last < first + 2) return null;
  const bandRatio = (last - first + 1) / probeWidth;
  if (bandRatio < 0.08 || bandRatio > 0.92) return null;
  const sx = Math.round(first * fullWidth / probeWidth);
  const sw = Math.round((last - first + 1) * fullWidth / probeWidth);
  return { sx, sy: 0, sw, sh: fullHeight };
}

/** 槽位参考单姿化:character/prop 的横幅多视图卡 → canvas 裁正面单格 dataURL。
 *  竖幅(已是单姿立绘)= 原图保留(2d312474 原语义,禁丢槽);场景/前帧恒不裁;
 *  横幅裁不出=丢槽(留痕,宁缺勿染,禁整卡入参考)。 */
export async function cropSlotReferenceToSinglePose(
  dataUrl: string,
  role: string,
  loadImage: (source: string) => Promise<StoryboardCropImageSource | null> = loadCropSourceImage,
): Promise<string | null> {
  if (role !== "character" && role !== "prop") return dataUrl;
  const image = await loadImage(dataUrl);
  if (!image) return null;
  // 竖幅单姿立绘原样保留——不能并入「裁切失败=丢槽」,否则 image_1 主角
  // 立绘被抽走,身份参考归零。
  if (image.naturalWidth <= image.naturalHeight) return dataUrl;
  const rect = singlePoseCropRect(image);
  if (!rect) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = rect.sw;
    canvas.height = rect.sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image as CanvasImageSource, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function loadCropSourceImage(dataUrl: string): Promise<StoryboardCropImageSource | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 3000); // 解码超时兜底(异常环境不挂链)
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = dataUrl;
  });
}
