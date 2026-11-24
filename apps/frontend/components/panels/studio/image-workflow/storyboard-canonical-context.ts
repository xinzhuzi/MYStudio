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
  type CanonicalAnchorSet,
  type CanonicalIdentityParagraph,
  type CanonicalSubjectInput,
} from "@/lib/studio/storyboard-canonical-prompt";
import { buildStoryboardFactionColorSection } from "@/lib/studio/storyboard-frame-prompt";
import { getExtendedStoryboardFactionData } from "@/lib/studio/visual-manual-style-tokens";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import { nameMatches, sceneBaseName, resolveStoryboardScene } from "./storyboard-scene-resolution";
export type { StoryboardCropImageSource } from "./storyboard-slot-crop";
export { cropSlotReferenceToSinglePose } from "./storyboard-slot-crop";
export type { StoryboardSceneResolvableShot, ResolvedStoryboardScene } from "./storyboard-scene-resolution";
export {
  nameMatches,
  findSceneRowForNames,
  sceneBaseName,
  sceneTimeOfDaySynonyms,
  resolveShotTimeOfDay,
  resolveStoryboardScene,
} from "./storyboard-scene-resolution";

/** promptOverrides「分镜剧情图」键(§4.3 定谳落点;存储层无枚举约束)。 */
export const STORYBOARD_IDENTITY_OVERRIDE_KEY = "分镜剧情图";

/** promptOverrides 键解析(JSON 串→键值;1120 件三导出:全文注入模块同键复用)。 */
export function parsePromptOverride(raw: string | undefined, key: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[key];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

// ─── 1117 C2 B3:画面描述列环境句萃取(videoDesc 在位时 prompt 列不再整段弃) ───
// S10 实弹:prompt「屋内灯下:墨板…孩子…」整段丢弃→纯山水;分句剔除含可见
// 角色名的子句,余句含环境物词才并入(来源事实词面,不编造)。
const ENVIRONMENT_CLAUSE_WORDS: readonly string[] = [
  "灯", "屋内", "门", "窗", "风", "墨板", "孩童", "孩子", "院", "街", "桌", "床", "檐",
  "雾", "尘", "堂", "廊", "墙", "火", "青瓦", "房", "雨", "油灯", "走廊", "角落", "队列",
];

/** 分句(句级 [。;；\n]);含可见角色名的子句剔除,余句含环境物词才收。 */
export function extractEnvironmentClauses(
  promptText: string,
  characterNames: readonly string[],
): string[] {
  const names = characterNames.map((name) => name.trim()).filter((name) => name.length >= 2);
  return promptText
    .split(/[。;；\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .filter((clause) => !names.some((name) => clause.includes(name)))
    .filter((clause) => ENVIRONMENT_CLAUSE_WORDS.some((word) => clause.includes(word)));
}

// ─── 1117 C2 G5:导演规划⑦衍生资产预划清单(最新 directorPlan data 文本解析) ───
export interface DerivedAssetPlanEntry {
  /** 复合名(晏燎·夜课少年);无「·」行=基础态确认(归元断剑),baseName=全名。 */
  compoundName: string;
  baseName: string;
  /** 衍生状态列原文(逐字,如「基础态锁定:灰布短褐袖口短一截、…」)。 */
  stateText: string;
  kind: "role" | "scene" | "tool";
}

/**
 * 规划⑦清单读取(最新版 directorPlan;agent-work-data data 文本里的
 * 「## ⑦ 衍生资产预划清单」markdown 表)。kind=衍生状态列词面(场景时间态
 * →scene/道具→tool/其余→role)。查无=空数组(消费方 fail-open)。
 */
export function collectDerivedAssetPlanEntries(episodeId?: string): DerivedAssetPlanEntry[] {
  const entries = (useStudioStore.getState().agentWorkData ?? [])
    .filter((item) => item.key === "directorPlan" && (!item.episodeId || !episodeId || item.episodeId === episodeId));
  const latest = [...entries].sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!latest) return [];
  const marker = latest.data.indexOf("衍生资产预划清单");
  if (marker < 0) return [];
  const section = latest.data.slice(marker);
  const rows: DerivedAssetPlanEntry[] = [];
  for (const line of section.split(/\r?\n/)) {
    const cells = line.trim().startsWith("|")
      ? line.trim().slice(1, -1).split("|").map((cell) => cell.trim())
      : [];
    if (cells.length < 2) continue;
    const compoundName = cells[0] ?? "";
    const stateText = cells[1] ?? "";
    if (!compoundName || !stateText || compoundName === "资产名" || compoundName.startsWith("-")) continue;
    const kind: DerivedAssetPlanEntry["kind"] = stateText.includes("场景") ? "scene"
      : stateText.includes("道具") ? "tool" : "role";
    rows.push({
      compoundName,
      baseName: sceneBaseName(compoundName),
      stateText,
      kind,
    });
  }
  return rows;
}

/** 角色名的衍生预划项(名单/复合名按 nameMatches 双向互认)。 */
export function findDerivedPlanEntryForCharacter(
  entries: readonly DerivedAssetPlanEntry[],
  characterName: string,
): DerivedAssetPlanEntry | undefined {
  return entries.find(
    (entry) => entry.kind === "role"
      && (entry.baseName === characterName || nameMatches(characterName, entry.baseName)),
  );
}

/**
 * 资产 prompt 列洗版(1118 十五刀A/十六刀)——现降级为兜底路径。黑名单逐刀
 * 追词(S01「并排四视图」实弹)证伪「裁脏词」路线:资产 prompt 列=设定图文体,
 * 排版/指令语花样追不完。保留作 extractIdentityFacets 白名单提取失败时的
 * 回退,段级清洗逻辑不变(负面句/画幅/英文标签/布光/排版段剔)。
 */
function sanitizeAssetPromptForIdentityLegacy(text: string): string {
  const flat = text.replace(/\r|\n/g, ",").replace(/,{2,}/g, ",").trim();
  const segments = flat.split(/[,，、;；。]/);
  const kept = segments.map((segment) => segment.trim()).filter(Boolean).filter((segment) => {
    if (/\d+\s*[:：×xX]\s*\d+/.test(segment)) return false; // 画幅比(21:9)
    if (/横幅|竖幅|宽幅|画幅|头身比|分辨率|比例/.test(segment)) return false;
    if (/不要|禁[止用]|严禁|避免|不得|无文字|图中不|画面不|去除|抹掉/.test(segment)) return false;
    if (/[a-zA-Z]{3,}/.test(segment)) return false; // 英文资产标签(character design sheet)
    if (/散光|柔光|打光|布光|光源/.test(segment)) return false; // 布光指令(型层域)
    if (/并排|视图|视角|多角度/.test(segment)) return false; // 四视图/同一画面并排
    if (/立像|入画|完整入画|设定图|立绘/.test(segment)) return false;
    if (/自头顶|至锁骨|至脚底|人像特写/.test(segment)) return false; // 取景范围
    if (/纯色背景|白背景|无场景|背景为|背景是/.test(segment)) return false; // 设定图布景
    if (/完全一致|保持一致/.test(segment)) return false; // 视图一致性指令
    if (/^(正面|侧面|背面|全身|半身|特写|坐像)$/.test(segment)) return false; // 视点枚举段
    return true;
  });
  return kept.join(",");
}

/**
 * 身份白名单(1118 十七刀A):分镜身份段只认「这个人长什么样」的视觉字段,
 * 不认设定图怎么排版/怎么拍。字段族按资产库实测文本归纳——面容/肤发/体型/
 * 着装佩携/年龄性别/身体印记;性格词(凶横刻薄)、气质推导语、摆姿指令
 * (自然站立/目视前方/双手下垂)全族不取。
 */
const IDENTITY_FACET_PATTERNS: RegExp[] = [
  // 面容:脸型五官神情载体
  /脸|面容|面颊|脸颊|下颌|颚|颧|眉|眼|瞳|鼻|唇|嘴|耳|胡|须|五官|面相|稚气|苍老|皱纹/,
  // 肤
  /肤|皮肤/,
  // 发
  /发|髻|辫|刘海|发饰/,
  // 体型:身形骨相
  /身形|体态|体型|身材|身高|肩|背|腰|四肢|躯干|瘦|壮|胖|结实|纤细|修长|高|矮|敦实|清瘦/,
  // 着装佩携:衣饰+随身兵械囊包
  /袍|衫|衣|裤|裙|带|靴|鞋|履|袜|帽|巾|簪|钗|镯|环|佩|囊|包|剑|鞭|刀|棍|杖|拂尘|甲|绳|索|链/,
  // 年龄性别
  /岁|男性|女性|男孩|女孩|男童|女童|青年|少年|中年|老年|老者|孩/,
  // 身体印记:疤痣纹身残缺
  /疤|痣|痕|纹身|刺青|断臂|残缺|空荡|冻疮|茧/,
];

/**
 * 身份段提取(1118 十七刀A):白名单字段族正路,黑名单降级兜底。分镜要的
 * 是单帧身份描述(这个人长什么样),资产 prompt 列是设定图文体(怎么排版
 * 一张四视图)——文体转换只能按「要什么取什么」提取,「裁掉什么」的黑名单
 * 追不完文体花样(S01「并排四视图」→4-5 副本实弹定谳)。白名单产出过短
 * (<40 字=提取面没盖住该资产写法)时回退黑名单清洗,保证身份段永不为空。
 */
export function sanitizeAssetPromptForIdentity(text: string): string {
  const flat = text.replace(/\r|\n/g, ",").replace(/,{2,}/g, ",").trim();
  const segments = flat.split(/[,，、;；。]/).map((segment) => segment.trim()).filter(Boolean);
  const extracted = segments.filter((segment) =>
    IDENTITY_FACET_PATTERNS.some((pattern) => pattern.test(segment))
    && !/并排|视图|立像|入画|自头顶|至锁骨|至脚底|背景|底色|完全一致|保持一致|不要|禁[止用]|严禁|避免|不得|[a-zA-Z]{3,}/.test(segment));
  // 阈值 24:短身份资产(3-4 段≈30 字)仍走白名单;真覆盖不住(<24)才回退
  if (extracted.join("").length >= 24) return extracted.join(",");
  return sanitizeAssetPromptForIdentityLegacy(text);
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
        // 1117 第十四刀(用户抓真根):资产库 **prompt 列=生图提示词真源**——
        // 资产生成线吃的就是这列(晏燎 318 字/铁山 1027 字完整视觉身份在
        // 此;description 列只是性格概述,半数空或垃圾)。五刀①接错列
        // (description)=分镜线从未用上生图逻辑的直接根因。
        // 取用序:prompt(视觉真源)>description(性格补位);origin 沿用
        // asset-description 兼容消费面。1118 十五刀A:prompt 列先洗版(负面
        // 指令句/换行剔除),只进正向视觉身份。
        else if ((asset?.prompt ?? "").trim()) {
          const sanitized = sanitizeAssetPromptForIdentity(asset!.prompt!);
          if (sanitized) identity = { name, paragraph: sanitized, origin: "asset-description" };
        } else if (asset?.description?.trim()) {
          identity = { name, paragraph: asset.description.trim(), origin: "asset-description" };
        }
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
  /** 1117 C2:装配层全量告警(主体句告警+场景/时辰/衍生/道具萃取留痕)。 */
  warnings: string[];
  /** 1117 C2 门A 锚词集合(场景/时辰;主角锚在传输期并槽位 title)。 */
  anchors: Omit<CanonicalAnchorSet, "protagonist"> & { protagonist?: string };
  /** 门A 软断言名单(visibleCharacters 全名;缺名=warn 留痕不拒发)。 */
  anchorSoftNames: string[];
}

/** 建流期正典主体句上下文(主体句=图内 prompt 节点值;装配告警留痕)。 */
export async function buildStoryboardCanonicalContext(
  shot: StoryboardItem,
): Promise<StoryboardCanonicalContextResult> {
  const visibleCharacters = shot.shotSemantics?.visibleCharacters ?? [];
  const identities = await resolveIdentityParagraphs(visibleCharacters.map((character) => character.name));

  // 1117 C2 G1:场景五级序+时辰五源序(态行优选含在内)。
  const sceneResolution = resolveStoryboardScene(shot);

  // 1117 C2 B3:videoDesc 在位时 prompt 列环境句萃取兜底(不再整段弃)。
  const environmentClauses = shot.videoDesc?.trim() && shot.prompt?.trim() && shot.prompt.trim() !== shot.videoDesc.trim()
    ? extractEnvironmentClauses(shot.prompt, visibleCharacters.map((character) => character.name))
    : [];

  // 1117 C2 要素⑤:visibleProps 空而镜点名 tool 资产时,name-only 并入配器句
  // (位置/状态未知不猜;§4.5 道具恒不入参考槽维持)。
  let visibleProps: NonNullable<CanonicalSubjectInput["visibleProps"]> =
    (shot.shotSemantics?.visibleProps ?? []).map((prop) => ({
      name: prop.name,
      position: prop.position || undefined,
      state: prop.state || undefined,
    }));
  const propWarnings: string[] = [];
  if (!visibleProps.length && (shot.associateAssetsNames ?? []).length) {
    const bridge = getStudioAssetsBridge();
    if (bridge?.batchMatch) {
      const toolMatches = await bridge
        .batchMatch({ type: "tool", names: shot.associateAssetsNames ?? [] })
        .catch(() => [] as Array<{ name: string; asset: unknown }>);
      const toolProps = (toolMatches ?? [])
        .map((entry) => (entry as { asset?: { name?: string } }).asset?.name || entry.name)
        .filter(Boolean)
        .map((name) => ({ name }));
      if (toolProps.length) {
        visibleProps = toolProps;
        propWarnings.push(`tool-prop-name-only:${toolProps.map((prop) => prop.name).join("、")}`);
      }
    }
  }

  // 1117 C2 G5③:衍生行缺席(无图可挂)时形态句文字承载进动作槽尾+warn。
  const derivedStateNotes: string[] = [];
  const derivedWarnings: string[] = [];
  if (visibleCharacters.length) {
    const planEntries = collectDerivedAssetPlanEntries(shot.episodeId);
    const bridge = getStudioAssetsBridge();
    if (planEntries.length && bridge?.getByName) {
      for (const character of visibleCharacters) {
        const entry = findDerivedPlanEntryForCharacter(planEntries, character.name);
        if (!entry) continue;
        const derivedAsset = await bridge
          .getByName({ type: "role", name: entry.compoundName })
          .catch(() => null);
        const derivedHasImage = Boolean(
          derivedAsset && (derivedAsset.previewUrl || derivedAsset.thumbnailUrl || derivedAsset.filePath),
        );
        if (!derivedHasImage) {
          // 1117 第十刀A:调度/持法类注记不入画(「蛇皮鞭两种持法(搭肩/绕肩,
          // 属调度非换装)」实录=明示两种姿势→双副本;画单帧只取穿着态)。
          if (/持法|属调度|姿势调度/.test(entry.stateText)) continue;
          derivedStateNotes.push(`「${entry.compoundName}」:${entry.stateText}`);
          derivedWarnings.push(`derived-missing:${entry.compoundName}`);
        }
      }
    }
  }

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
    visibleProps,
    scene: sceneResolution.fact,
    ...(environmentClauses.length ? { environmentClauses } : {}),
    ...(derivedStateNotes.length ? { derivedStateNotes } : {}),
    // 1121 对照修:朝向/空间关系列直进(此前零消费断头,分镜表 LLM 写了
    // 但装配链不取)。朝向=镜头语言进动作槽;空间关系=布局语义进环境槽。
    orientationNote: (shot.orientation || "").trim() || undefined,
    spatialNote: (shot.spatialRelation || "").trim() || undefined,
    lighting: shot.continuityState?.lighting || undefined,
    factionColorLines: resolveFactionColorLines(shot),
  };
  const sentence = buildCanonicalSubjectSentence(subject);
  const warnings = [...sentence.warnings, ...sceneResolution.warnings, ...propWarnings, ...derivedWarnings];
  if (warnings.length) {
    void logEvent({
      level: "warn",
      category: "ai",
      operationId: createOperationId("storyboard-canonical-subject"),
      message: "Storyboard canonical subject assembled with fact gaps",
      context: { shotId: shot.id, shotIndex: shot.index, warnings },
    });
  }
  return {
    subject,
    sentence,
    warnings,
    anchors: {
      ...(sceneResolution.fact ? { sceneName: sceneResolution.fact.name } : {}),
      ...(sceneResolution.timeOfDay ? { timeOfDay: sceneResolution.timeOfDay } : {}),
      ...(identities[0]?.name ? { protagonist: identities[0]?.name } : {}),
    },
    anchorSoftNames: visibleCharacters.map((character) => character.name).filter(Boolean),
  };
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
export /** 槽位标题标点归一(半角分隔→全角;内容词逐字)。 */
function normalizeFullwidthPunctuationForTitle(text: string): string {
  return text.replace(/,/g, "，").replace(/;/g, "；").replace(/:/g, "：")
    .replace(/\(/g, "（").replace(/\)/g, "）").replace(/\./g, "。");
}

function extractCanonicalSlotSources(
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
      // 1117 五刀批残留修:资产复合名可含半角分隔(「李先生;管事」实录)——
      // 槽 title 出口统一归一,杜绝半角渗入传输指令体(lint 全角门拒 14 镜根)。
      title: normalizeFullwidthPunctuationForTitle((node.type === "reference" ? node.title : "") ?? ""),
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
  /**
   * 1120 件三 A/B 并轨:传输期生效主体句输入(momentNote 已并入的
   * effectiveSubject)——identity-injection 模式据此重建零身份段基底
   * (与正典同源同函数,仅 identities 置空)。canonical 模式不消费。
   */
  subject: CanonicalSubjectInput;
  /** 1117 C2 门A 锚词集合:主角锚=image_1 角色槽 title(零角色镜取 identities 首位)。 */
  anchors: CanonicalAnchorSet;
  /** 门A 软断言名单(visibleCharacters 全名;缺名=warn 可观测)。 */
  anchorSoftNames: string[];
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
  // 1117 第九刀:有名有姓在场人物=1 的镜,角色参考全弃(同人副本根;
  // 场景参考保留顶槽)。多帧镜不弃(帧间链身份连续优先)。
  const castSemantics = ((shot.shotSemantics?.visibleCharacters ?? []) as Array<{
    name?: string; actionIn?: string;
  }>);
  const castNames = castSemantics.map((character) => (character.name ?? "").trim()).filter(Boolean);
  // vc 语义数据缺席(undefined/空)=未知形态,不触发弃参考(合成测试床/旧分片);
  // 恰好 1 名有名角色=真单角色镜 → 弃角色参考(宁缺勿染)。
  const singleCast = castNames.length === 1;
  // 1117 第十一刀A(十刀B 泛化):全部镜单时刻框定——分镜帧=一个瞬间,
  // 动作唯一权威=vc actionIn(镜头入点),每角色「{名}正在{actionIn}」一行;
  // videoDesc 的多动作枚举(「挥鞭…、舔唇、拨筹」/「踱步扫视、发话」)不再
  // 进动作槽(双副本主根,S02/S9 双实录),仅作环境萃取源(environmentClauses
  // 在 buildStoryboardCanonicalContext 内独立抽取,环境/光色/阵营句保留)。
  // 多帧镜不框定(帧时刻由 momentNote 承担)。
  const actionLines = castSemantics
    .map((c) => c.name?.trim() && c.actionIn?.trim()
      ? `${c.name.trim()}正在${c.actionIn.trim()}`
      : "")
    .filter(Boolean);
  // 1118 二十二刀(活雷1根修):只覆写 videoDesc,**prompt 保留原文**——此前
  // 两列同覆导致:①环境句萃取条件 prompt!==videoDesc 恒假=环境句全丢(37 语
  // 义镜实录);②场景㊢/时辰㊣探针吃 actionLines 拿不到原文(ch3-S16「夜」
  // 必拒实录)。动作语义不回流:动作句权威=actionLines(上方),prompt 原文
  // 进主体句的口只有环境萃取,而萃取分句剔除含角色名的动作句(extractEnv-
  // ironmentClauses 契约),十一刀A 注释「环境/光色/阵营句保留」自此兑现。
  const shotForPrompt = !frameId && actionLines.length
    ? {
        ...shot,
        videoDesc: actionLines.join("；"),
      }
    : shot;
  const { subject, anchors: contextAnchors, anchorSoftNames } = await buildStoryboardCanonicalContext(shotForPrompt);
  const effectiveSubject = momentNote?.trim()
    ? { ...subject, momentNote: momentNote.trim() }
    : subject;
  const mapping = mapCanonicalReferenceSlots({
    ...extractCanonicalSlotSources(graph, targetNodeId),
    singleCastTextIdentity: singleCast && !frameId,
  });
  // 1116 三代修:传输层单姿裁切失败的槽(dropSlotIndexes,0 基)在此剔除并
  // 重编号——指令体的 <imageN> 编号与实际入槽图恒连续同构(宁缺勿染)。
  if (dropSlotIndexes.length) {
    const dropped = new Set(dropSlotIndexes);
    const kept = mapping.slots
      .filter((_, index) => !dropped.has(index))
      .map((slot, index) => ({ ...slot, slot: (index + 1) as 1 | 2 | 3 }));
    mapping.slots = kept;
  }
  // 1117 C2 门A:主角锚=角色槽 title(丢槽重排后按存活槽取,零角色镜取
  // identities 首位;衍生复合名「晏燎·夜课少年」取基础名——主体句身份段写
  // 的是角色名,锚词同面)。
  const protagonistSlotTitle = mapping.slots.find((slot) => slot.role === "character")?.title;
  const protagonist = (protagonistSlotTitle ? sceneBaseName(protagonistSlotTitle) : undefined)
    ?? contextAnchors.protagonist;
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
    subject: effectiveSubject,
    anchors: {
      ...contextAnchors,
      ...(protagonist ? { protagonist } : {}),
    },
    anchorSoftNames,
  };
}
