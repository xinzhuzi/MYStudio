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
  CANONICAL_TIME_OF_DAY_FAMILIES,
  mapCanonicalReferenceSlots,
  type CanonicalAnchorSet,
  type CanonicalIdentityParagraph,
  type CanonicalSceneFact,
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
import { useStudioStore } from "@/stores/studio/studio-store";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import type { Scene } from "@/stores/library/scene-store";

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
export function findSceneRowForNames(names: string[]): Scene | null {
  if (!names.length) return null;
  const projectId = useProjectStore.getState().activeProjectId;
  const scenes = useSceneStore
    .getState()
    .scenes.filter((scene) => !projectId || !scene.projectId || scene.projectId === projectId);
  return scenes.find((scene) => names.some((name) => nameMatches(name, scene.name))) ?? null;
}

// ─── 1117 C2 G1:场景五级序解析 + 时辰五源序解析(剧情锚定主修) ─────────────
// 断链档案(B1/B4/B2,S8-S12 实弹定谳):①S12 associateAssetsIds 有金水塾馆 id
// (scene_…jew094y)而装配层只读名字→id 在名不在链断;②row.scene 落库丢弃;
//③「晏燎」子串误中「晏燎静室」(角色名⊂场景名双向包含的结构性误配);④
// scene.time 库内 0/493+行无 continuityState=时辰双路恒空,夜只散活在 prompt
// 首字/slug。五级序+五源序把两链接通;未知项仍不猜不写。

/** 五级序/五源序可解析的分镜子集(缺省全 undefined=各级自然跳过)。 */
export type StoryboardSceneResolvableShot = Partial<
  Pick<
    StoryboardItem,
    | "associateAssetsIds"
    | "associateAssetsNames"
    | "sceneName"
    | "timeOfDay"
    | "prompt"
    | "videoDesc"
    | "shotSemantics"
    | "continuityState"
    | "episodeId"
  >
>;

/** 查询词命中角色库者不得作场景名参与子串匹配(B4:晏燎→晏燎静室根除)。 */
function isCharacterLibraryName(name: string): boolean {
  const projectId = useProjectStore.getState().activeProjectId;
  const library = useCharacterLibraryStore.getState().characters;
  return library.some(
    (entry) =>
      nameMatches(name, entry.name)
      && (!projectId || !entry.projectId || entry.projectId === projectId),
  );
}

function projectScenes(): Scene[] {
  const projectId = useProjectStore.getState().activeProjectId;
  return useSceneStore
    .getState()
    .scenes.filter((scene) => !projectId || !scene.projectId || scene.projectId === projectId);
}

/** 场景行基础名(态行「金水塾馆·夜内态：…」→「金水塾馆」)。 */
export function sceneBaseName(name: string): string {
  return name.split("·")[0]?.trim() || name.trim();
}

/** 时辰词同义词族成员集(词不在任何族=仅自身;与门A同源族表)。 */
export function sceneTimeOfDaySynonyms(word: string): string[] {
  const trimmed = word.trim();
  if (!trimmed) return [];
  for (const members of Object.values(CANONICAL_TIME_OF_DAY_FAMILIES)) {
    if (members.includes(trimmed)) return [...members];
    if (members.some((member) => member.length >= 2 && trimmed.includes(member))) return [...members];
  }
  return [trimmed];
}

/** sceneViewpointId slug 时段 token(jinshui-shuguan-hall-night-v1→夜;存量行可回填)。 */
const SLUG_TIME_TOKENS: Record<string, string> = {
  night: "夜",
  day: "日",
  noon: "日",
  dawn: "晨",
  morning: "晨",
  dusk: "暮",
  evening: "暮",
};

/** 全时辰族词全文探针(最早出现位优先,同位长词优先;命中=该词)。 */
function probeTimeWord(text: string): string | undefined {
  const words = Object.values(CANONICAL_TIME_OF_DAY_FAMILIES).flat();
  let best: { word: string; index: number } | undefined;
  for (const word of words) {
    const index = text.indexOf(word);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && word.length > best.word.length)) {
      best = { word, index };
    }
  }
  return best?.word;
}

/**
 * 时辰五源序解析(1117 C2 B2 主修;纯函数消费 store,测试可注入态):
 * ㊠shot.timeOfDay(场头时辰落库,正路)→㊡continuityState.lighting(设计槽
 * 保位)→㊢sceneViewpointId slug 时段 token→㊣prompt/videoDesc 时辰词探针
 * (S9 首字「夜。」)→㊤场景行 time/态行名标记(夜内态/晨雾态)。
 */
export function resolveShotTimeOfDay(
  shot: StoryboardSceneResolvableShot,
  sceneRow?: Scene | null,
): string | undefined {
  // ㊠ 新字段(正路:剧本场头「夜/内」→分镜表场头「｜时辰:夜·内」→落库)。
  const direct = shot.timeOfDay?.trim();
  if (direct) return direct;
  // ㊡ 设计槽保位(存量行无 continuityState=自然跳过)。
  const lighting = shot.continuityState?.lighting?.trim();
  if (lighting) {
    const probed = probeTimeWord(lighting);
    if (probed) return probed;
  }
  // ㊢ slug 时段 token(-night-→夜;视觉连续性域既有真源回填)。
  const slug = shot.shotSemantics?.sceneViewpointId?.trim();
  if (slug) {
    for (const segment of slug.split(/[-_]/)) {
      const token = SLUG_TIME_TOKENS[segment.toLowerCase()];
      if (token) return token;
    }
  }
  // ㊣ 画面文本时辰词探针(S9 prompt 首字「夜。」;videoDesc 同查)。
  const text = [shot.videoDesc, shot.prompt].filter(Boolean).join("\n");
  if (text) {
    const probed = probeTimeWord(text);
    if (probed) return probed;
  }
  // ㊤ 场景行 time/态行名标记(夜内态/晨雾态)。
  if (sceneRow) {
    if (sceneRow.time?.trim()) {
      const probed = probeTimeWord(sceneRow.time);
      if (probed) return probed;
    }
    const suffix = sceneRow.name.split("·").slice(1).join("·");
    if (suffix) {
      const probed = probeTimeWord(suffix);
      if (probed) return probed;
    }
  }
  return undefined;
}

/** 态行优选(㊄):同名基础行与「·夜内态」派生行并存时按时辰选态行(带图态行在册实证 mp381wo)。 */
function preferSceneStateRow(row: Scene, timeOfDay: string | undefined, scenes: Scene[]): Scene {
  const base = sceneBaseName(row.name);
  if (row.name === base && !timeOfDay) return row;
  const synonyms = timeOfDay ? sceneTimeOfDaySynonyms(timeOfDay) : [];
  const siblings = scenes.filter((scene) => scene.name !== row.name && sceneBaseName(scene.name) === base);
  if (!siblings.length) return row;
  // 时辰已知:挑态名(·后段)含时辰族词的派生行;未知/无匹配=基础行。
  for (const sibling of siblings) {
    const suffix = sibling.name.split("·").slice(1).join("·");
    if (suffix && synonyms.some((word) => suffix.includes(word))) return sibling;
  }
  return row;
}

export interface ResolvedStoryboardScene {
  /** 态行优选后的三库行(null=五级序全断)。 */
  row: Scene | null;
  fact: CanonicalSceneFact | null;
  source: "asset-id" | "scene-name-field" | "text-probe" | "name-match" | null;
  timeOfDay?: string;
  warnings: string[];
}

/**
 * 场景五级序解析(1117 C2 B1/B4 主修):
 * ㊠associateAssetsIds scene_ 前缀 id 精确命中(S12 金水塾馆 id 在行而未被读)
 * →㊡sceneName 新字段(分镜表场景列落库)→㊢prompt/videoDesc 场名探针(三库
 * 行名 includes,回填 S8/S9)→㊣名匹配+守卫(角色库命中查询词不作场景名,
 * 晏燎⊂晏燎静室根除)→㊤态行优选(按时辰选「·夜内态」派生行)。
 */
export function resolveStoryboardScene(shot: StoryboardSceneResolvableShot): ResolvedStoryboardScene {
  const warnings: string[] = [];
  const scenes = projectScenes();
  let row: Scene | null = null;
  let source: ResolvedStoryboardScene["source"] = null;

  // ㊠ id 精确命中(associateAssetsIds 的 scene_ 前缀)。
  const sceneIds = (shot.associateAssetsIds ?? []).filter((id) => id.startsWith("scene_"));
  if (sceneIds.length) {
    row = scenes.find((scene) => sceneIds.includes(scene.id)) ?? null;
    if (row) source = "asset-id";
  }
  // ㊡ sceneName 新字段(精确名优先,复合名双向包含兜底)。
  if (!row) {
    const sceneName = shot.sceneName?.trim();
    if (sceneName) {
      row = scenes.find((scene) => scene.name === sceneName)
        ?? scenes.find((scene) => nameMatches(sceneName, scene.name)) ?? null;
      if (row) source = "scene-name-field";
    }
  }
  // ㊢ 画面文本场名探针(三库行名 includes 文本;多命中取最长名=最具体)。
  if (!row) {
    const text = [shot.videoDesc, shot.prompt].filter(Boolean).join("\n");
    if (text) {
      const hits = scenes
        .filter((scene) => scene.name.trim().length >= 2 && text.includes(scene.name.trim()))
        .sort((left, right) => right.name.trim().length - left.name.trim().length);
      if (hits.length) {
        row = hits[0]!;
        source = "text-probe";
      }
    }
  }
  // ㊣ 名匹配+角色守卫(B4:查询词命中角色库者不得作场景名)。
  if (!row) {
    const guardedNames = (shot.associateAssetsNames ?? [])
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => !isCharacterLibraryName(name));
    const excluded = (shot.associateAssetsNames ?? []).filter((name) => isCharacterLibraryName(name));
    if (excluded.length) warnings.push(`scene-query-guarded:${excluded.join("、")}`);
    row = findSceneRowForNames(guardedNames);
    if (row) source = "name-match";
  }

  // 时辰(㊤源含行内标记)→态行优选(㊄)。
  const timeOfDay = resolveShotTimeOfDay(shot, row);
  const finalRow = row ? preferSceneStateRow(row, timeOfDay, scenes) : null;
  if (finalRow !== row && finalRow) warnings.push(`scene-state-row:${sceneBaseName(row!.name)}→${finalRow.name}`);

  const fact: CanonicalSceneFact | null = finalRow
    ? {
        name: finalRow.name,
        location: finalRow.location || undefined,
        time: timeOfDay || finalRow.time || undefined,
        atmosphere: finalRow.atmosphere || undefined,
      }
    : null;
  return { row: finalRow, fact, source, ...(timeOfDay ? { timeOfDay } : {}), warnings };
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
 * 资产 prompt 列洗版(1118 十五刀A):prompt 列=资产库完整文生图提示词,自带
 * 负面指令句(铁山「图中不要有任何文字，禁止写实摄影」/归元断剑「严禁照片级
 * 真实感」实录)、多行排版、画幅段(「21:9 横幅」=画幅义非画面文字,S1 涉字
 * 误杀实录)、英文资产标签(「character design sheet」)——十四刀整段采用后拼
 * 进主体句,被体裁门全文扫描误杀(style-word/single-paragraph/text-
 * requirement-block 三拒实录)。身份段只取正向视觉文:**逗号段级**清洗(句
 * 级整剔会把带一个禁词的逗号流大句整句误杀——铁山 1027 字洗后归零实录),
 * 指令段/画幅段/布光段/英文标签段剔,段间逗号重组,不改写保留段。
 */
export function sanitizeAssetPromptForIdentity(text: string): string {
  const flat = text.replace(/\r|\n/g, ",").replace(/,{2,}/g, ",").trim();
  const segments = flat.split(/[,，、;；。]/);
  const kept = segments.map((segment) => segment.trim()).filter(Boolean).filter((segment) => {
    if (/\d+\s*[:：×xX]\s*\d+/.test(segment)) return false; // 画幅比(21:9)
    if (/横幅|竖幅|宽幅|画幅|头身比|分辨率|比例/.test(segment)) return false;
    if (/不要|禁[止用]|严禁|避免|不得|无文字|图中不|画面不|去除|抹掉/.test(segment)) return false;
    if (/[a-zA-Z]{3,}/.test(segment)) return false; // 英文资产标签(character design sheet)
    if (/散光|柔光|打光|布光|光源/.test(segment)) return false; // 布光指令(型层域)
    // 1118 十六刀:设定图排版指令段(十五刀漏网根因,S01/S02 实弹「并排四视
    // 图」→模型忠实画 4-5 副本实录)——资产 prompt 列=立绘设定图文体,排版
    // 语(纯色背景/无场景/并排/视图枚举/取景范围/一致性指令)全部是「怎么排
    // 版设定图」而非「这个人长什么样」,进分镜正文=明示多副本。段级整剔。
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
  const shotForPrompt = !frameId && actionLines.length
    ? {
        ...shot,
        videoDesc: actionLines.join("；"),
        prompt: actionLines.join("；"),
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
    anchors: {
      ...contextAnchors,
      ...(protagonist ? { protagonist } : {}),
    },
    anchorSoftNames,
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

/** 1117 残项③:竖排多视图卡分析(竖幅 3 视图+2 配色形态)——按行带内容
 * 占用探测,最上连续内容块=首格(竖排版式正面);行占用分析复用横向
 * 探针参数,行列互换。 */
function singlePoseCropRectVertical(
  image: StoryboardCropImageSource,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  if (!fullWidth || !fullHeight || fullHeight <= fullWidth) return null;
  const probeHeight = Math.min(POSE_PROBE_WIDTH, fullHeight);
  const probeWidth = Math.max(1, Math.round(fullWidth * probeHeight / fullHeight));
  let analysis: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = probeWidth;
    canvas.height = probeHeight;
    analysis = canvas.getContext("2d", { willReadFrequently: true });
    if (!analysis || typeof analysis.getImageData !== "function") return null;
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
  const bandLeft = Math.floor(probeWidth * 0.15);
  const bandRight = Math.max(bandLeft + 1, Math.floor(probeWidth * 0.9));
  const isBackground = (x: number, y: number): boolean => {
    const [r, g, b] = sample(x, y);
    const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
    return Math.sqrt(dr * dr + dg * dg + db * db) < POSE_BG_COLOR_DISTANCE;
  };
  const hasContent = new Array<boolean>(probeHeight);
  for (let y = 0; y < probeHeight; y += 1) {
    let content = 0;
    for (let x = bandLeft; x < bandRight; x += 1) {
      if (!isBackground(x, y)) content += 1;
    }
    hasContent[y] = content / (bandRight - bandLeft) >= POSE_CONTENT_COLUMN_RATIO;
  }
  let first = -1;
  let last = -1;
  for (let y = 0; y < probeHeight; y += 1) {
    if (hasContent[y]) { first = y; break; }
  }
  if (first < 0) return null;
  for (let y = first + 1; y < probeHeight; y += 1) {
    if (!hasContent[y]) break;
    last = y;
  }
  if (last < first + 2) return null;
  const bandRatio = (last - first + 1) / probeHeight;
  if (bandRatio < 0.08 || bandRatio > 0.92) return null;
  const sy = Math.round(first * fullHeight / probeHeight);
  const sh = Math.round((last - first + 1) * fullHeight / probeHeight);
  return { sx: 0, sy, sw: fullWidth, sh };
}

/** 整幅单内容判定(裁不出块时的单姿残余语义):中心十字带内容占用 >85%。
 */
function isSinglePoseFullFrame(image: StoryboardCropImageSource): boolean {
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  if (!fullWidth || !fullHeight) return false;
  const w = Math.min(64, fullWidth);
  const h = Math.max(1, Math.round(fullHeight * w / fullWidth));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(image as CanvasImageSource, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const sample = (x: number, y: number): [number, number, number] => {
      const at = (y * w + x) * 4;
      return [data[at]!, data[at + 1]!, data[at + 2]!];
    };
    const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]] as const;
    const bg = corners.reduce(
      (acc, [cx, cy]) => {
        const c = sample(Math.max(0, Math.min(w - 1, cx)), Math.max(0, Math.min(h - 1, cy)));
        return [acc[0] + c[0] / 4, acc[1] + c[1] / 4, acc[2] + c[2] / 4] as [number, number, number];
      },
      [0, 0, 0] as [number, number, number],
    );
    const midX = Math.floor(w / 2);
    const midY = Math.floor(h / 2);
    let occupied = 0;
    let total = 0;
    for (let y = 0; y < h; y += 1) {
      const [r, g, b] = sample(midX, y);
      total += 1;
      const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
      if (Math.sqrt(dr * dr + dg * dg + db * db) >= POSE_BG_COLOR_DISTANCE) occupied += 1;
    }
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = sample(x, midY);
      total += 1;
      const dr = r - bg[0]!, dg = g - bg[1]!, db = b - bg[2]!;
      if (Math.sqrt(dr * dr + dg * dg + db * db) >= POSE_BG_COLOR_DISTANCE) occupied += 1;
    }
    return occupied / total > 0.85;
  } catch {
    return false;
  }
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
  // 1117 残项③:S10 复发实录——「竖幅=单姿」假设不成立(独孤剑尘资产=
  // 竖幅 3 视图+2 配色,整卡直传→版式复制)。横幅走横向裁(原),竖幅先探
  // 竖排多视图(singlePoseCropRectVertical),两路都无块=整幅单内容判定
  // (占幅 >85%=真单姿保留,否则丢槽宁缺勿染)。
  const rect = image.naturalWidth > image.naturalHeight
    ? singlePoseCropRect(image)
    : singlePoseCropRectVertical(image);
  if (!rect) return isSinglePoseFullFrame(image) ? dataUrl : null;
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
