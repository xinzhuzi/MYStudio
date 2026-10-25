import type { AssetImage, AssetImageKind } from "@/types/studio-assets";
import { classifyAssetImage } from "./asset-image-kind";

/**
 * 角色阶段提示词矩阵——纯函数域(10-25-asset-stage-prompt-matrix T1,PRD §3.1)。
 * 阶段=角色形态维度(境界/年龄段/道途),与型=产物维度(classifyAssetImage)正交;
 * 聚类仅按图名段级提取,零 db schema、零引擎改动,旧图全覆盖(A 案=tEXt 聚合视图)。
 *
 * 真源与实测口径(10-25):
 * - 境界阶梯序=晏燎.json stages.境界 键序(1→10);
 * - 71 道途全名=MA《道劫》设定集 2.道途/ md 文件名(73 件剔除 HTML 与 道途对照表);
 *   10-25 独立复审已对真源目录逐名核对(71/71 一致,含数字前缀序),详见名单常量注释;
 * - 晏燎 32 实名 fixture 与独孤剑尘 4 实名=assets.db 只读实测(见同名测试件)。
 */

/**
 * 境界阶梯(Q3 裁定:阶梯硬编码;序=晏燎.json stages.境界 键序真源 1.→10.)。
 * 字面注:json 首境键作「炼气期」(U+70BC),实库 32 件产物名段与 PRD §六验收句
 * 「练气→共主」均作「练气期」(U+7EC3,10-21 战役批实际命名)——取实库写法,
 * 否则练气期不入阶梯档、聚类排序即违验收口径(本行注释即两写法并存的核对凭据)。
 */
export const REALM_LADDER = [
  "练气期",
  "筑基期",
  "金丹期",
  "元婴期",
  "化神期",
  "炼虚期",
  "合体期",
  "渡劫期",
  "大乘期",
  "共主期",
] as const;

/** 年龄段阶梯(Q2 裁定:幼→老)。 */
export const AGE_LADDER = ["幼年", "青年", "成年", "中年", "老年"] as const;

/**
 * 71 道途全名白名单(Q2 裁定;真源=MA
 * `/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/1.设定集/7.道途境界/2.道途/`
 * md 文件名剥数字前缀与 .md,剔除 HTML 目录与 道途对照表.md 两件,余 71 件;此处按文件
 * 数字前缀序 1→71 内嵌,件数由同名测试件钉 71)。
 * **10-25 独立复审逐名核对毕**:常量与真源目录 71 件**逐名逐序完全一致**(数字前缀序
 * 1→71;核对记录见任务 10-25-asset-stage-prompt-matrix)。PRD §1.3-4「剑主男..擒龙女
 * 71 件」系举例式表述,与真源端点不符——擒龙女=第 9/71 位,**末位=幻翎女(71)**;
 * 白名单以真源为准(首末位与擒龙女位由测试钉锚,防按 PRD 字面误改)。
 * 全名恒带性别后缀(男/女);独孤剑尘五态(剑主/剑衍/…)是本名单子串族——
 * 段级匹配禁 substring(extractStageName 整段相等),生成命名用全名(PRD §1.3-4)。
 */
export const DAO_STAGE_WHITELIST: readonly string[] = [
  "剑主男", "剑衍男", "剑星男", "剑魔男", "剑狂男", "四象女", "武神女", "尘幽女", "擒龙女", "惊鸿男",
  "震雷男", "天工男", "符箓男", "金罡男", "元灵女", "御灵女", "真武女", "奇门女", "灵妙女", "灵卫男",
  "圣裁男", "梵天男", "降魔男", "天魔男", "劫火女", "幻舞女", "绝影女", "冥术女", "两仪男", "武神男",
  "尘幽男", "伏虎男", "惊鸿女", "震雷女", "天工女", "符箓女", "协光女", "混元男", "冰魄男", "血魂男",
  "清风男", "渡虚男", "御剑女", "魔契女", "诗剑女", "幽煌女", "孤锋女", "青御女", "太初女", "曦曜女",
  "龙御女", "圣裁女", "灵卫女", "澄正女", "摄心女", "祝巫女", "霸王男", "天决男", "天狩男", "魔刃男",
  "隐锋男", "烽火男", "夜烽男", "源初男", "剑客男", "造化女", "云游女", "幻音女", "天妖女", "荒神女",
  "幻翎女",
];

const REALM_LADDER_LOOKUP: readonly string[] = REALM_LADDER;
const AGE_LADDER_LOOKUP: readonly string[] = AGE_LADDER;
const DAO_STAGE_SET: ReadonlySet<string> = new Set(DAO_STAGE_WHITELIST);
/** 道途字典序副本(排序键用;JS 默认码元字典序=确定性,不用随 locale 变的 localeCompare)。 */
const DAO_STAGE_SORTED: readonly string[] = [...DAO_STAGE_WHITELIST].sort();

/**
 * 段级阶段提取(Q2 白名单;PRD §3.1):文件名按 "_" 切段,左起首个命中段即阶段——
 * - 段以「期」结尾(境界期形通配,阶梯外自造期形如 剑主期 也入,未知档附尾展示不丢);
 * - 段 ∈ AGE_LADDER(整段相等);
 * - 段 ∈ DAO_STAGE_WHITELIST(整段相等,**禁 substring**——防「独孤剑尘」「剑主」等
 *   道途子串族与衣物描述词误中,PRD §七风险表);
 * 无命中=null(基底/表情差分/参考图等无阶段段天然出组)。
 */
export function extractStageName(imageName: string): string | null {
  for (const segment of imageName.split("_")) {
    if (segment.length === 0) continue;
    if (segment.endsWith("期")) return segment;
    if (AGE_LADDER_LOOKUP.includes(segment)) return segment;
    if (DAO_STAGE_SET.has(segment)) return segment;
  }
  return null;
}

/**
 * 阶段排序键(Q3 裁定;返回单数字供比较):
 * REALM_LADDER 序(0..9)→ AGE_LADDER 序(10..14)→ 道途字典序(15..85)→ 未知=Infinity。
 * 未知档恒 Infinity(Infinity±n 恒 Infinity,档内首现序无法单数编码)——档内按首现序
 * 由调用方(聚类比较器)以 firstSeenIndex 决胜;firstSeenIndex 入参即为此口径预留。
 */
export function stageSortKey(stage: string, firstSeenIndex: number): number {
  void firstSeenIndex;
  const realmIndex = REALM_LADDER_LOOKUP.indexOf(stage);
  if (realmIndex >= 0) return realmIndex;
  const ageIndex = AGE_LADDER_LOOKUP.indexOf(stage);
  if (ageIndex >= 0) return REALM_LADDER_LOOKUP.length + ageIndex;
  const daoIndex = DAO_STAGE_SORTED.indexOf(stage);
  if (daoIndex >= 0) return REALM_LADDER_LOOKUP.length + AGE_LADDER_LOOKUP.length + daoIndex;
  return Number.POSITIVE_INFINITY;
}

/** 组内图组:latest=最新一张(输入序末位,1.3-1 追加语义:新生/重掷恒 append 到尾);
 *  all=组内全部图名(输入序,卡头「N 张」计数与悬停 title 列名用)。 */
export interface StageKindGroup<TImage extends AssetImage = AssetImage> {
  latest: TImage;
  all: Array<{ name: string }>;
}

/** 单阶段聚类条目:byKind 按型分组(型=classifyAssetImage 归型,节序=组内首现序)。 */
export interface AssetStageCluster<TImage extends AssetImage = AssetImage> {
  stage: string;
  byKind: Map<AssetImageKind, StageKindGroup<TImage>>;
}

/**
 * 阶段聚类(PRD §3.1):images → 排序后阶段数组。
 * - 归型沿用 classifyAssetImage(持久值→命名右最标记→自由),阶段沿用 extractStageName;
 * - 排序=stageSortKey(Q3:境界阶梯→年龄段→道途字典序→未知 Infinity 档首现序附尾);
 * - 组内 latest=输入序末位(展示约定;写入路若改插首,此处随迁,PRD §七风险表);
 * - 显示守卫:distinct 阶段 <2 返回空数组(单阶段/零阶段配角弹窗零变化,§3.1)。
 */
export function clusterAssetStages<TImage extends AssetImage>(
  images: readonly TImage[],
): Array<AssetStageCluster<TImage>> {
  const stageGroups = new Map<
    string,
    { firstSeenIndex: number; byKind: Map<AssetImageKind, StageKindGroup<TImage>> }
  >();
  for (const image of images) {
    const stage = extractStageName(image.name);
    if (stage === null) continue;
    let group = stageGroups.get(stage);
    if (!group) {
      group = { firstSeenIndex: stageGroups.size, byKind: new Map() };
      stageGroups.set(stage, group);
    }
    const kind = classifyAssetImage(image);
    let kindGroup = group.byKind.get(kind);
    if (!kindGroup) {
      kindGroup = { latest: image, all: [] };
      group.byKind.set(kind, kindGroup);
    }
    kindGroup.latest = image;
    kindGroup.all.push({ name: image.name });
  }
  if (stageGroups.size < 2) return [];
  return [...stageGroups.entries()]
    .map(([stage, group]) => ({ stage, group }))
    .sort((a, b) => {
      const keyA = stageSortKey(a.stage, a.group.firstSeenIndex);
      const keyB = stageSortKey(b.stage, b.group.firstSeenIndex);
      if (keyA !== keyB) return keyA - keyB;
      return a.group.firstSeenIndex - b.group.firstSeenIndex;
    })
    .map(({ stage, group }) => ({ stage, byKind: group.byKind }));
}

/**
 * 显示守卫判定(§3.1 阶段子区与 §3.3 阶段选择器同条件):distinct 阶段 ≥2 才渲染。
 * 与 clusterAssetStages 的返回前守卫同口径(cluster <2 恒 []),供 UI 先行判渲染。
 */
export function hasRenderableStageMatrix(
  images: ReadonlyArray<Pick<AssetImage, "name" | "kind">>,
): boolean {
  const stages = new Set<string>();
  for (const image of images) {
    const stage = extractStageName(image.name);
    if (stage !== null) stages.add(stage);
    if (stages.size >= 2) return true;
  }
  return false;
}

/**
 * 阶段命名器(Q5/§3.3):资产名_{阶段}_{型名}_中文日期。
 * i2i 原本锚轮播图名,改为锚资产名+阶段段——防旧图名内陈旧标记链式繁殖;型名直用
 * AssetImageKind 成员(与既有按型出图 `{锚名}_{kind}_{日期}` 的型段同款,classifyAssetImageName
 * 复验归型不变、extractStageName 复验归组成立,由同名测试件钉)。中文日期格式沿
 * 既有写路 `YYYY年MM月DD日`(月/日两位补零,dateZh 由调用方传入,纯函数不吃时钟)。
 */
export function buildStageTypeShotImageName(
  assetName: string,
  stage: string,
  kind: Exclude<AssetImageKind, "早期未分类">,
  dateZh: string,
): string {
  return `${assetName}_${stage}_${kind}_${dateZh}`;
}
