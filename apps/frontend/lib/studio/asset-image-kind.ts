import type { AssetImage, AssetImageKind, StudioAssetKind } from "@/types/studio-assets";

/**
 * 资产图片类型单源(10-24 图片展示规范批2,PRD Round 2 A 节决议)。
 * 三层解析:classifyAssetImage(entry) = entry.kind(持久值) ?? 命名规则分类(name) ?? 自由。
 * - 持久值:生成写路经 addImage IPC 落 images[] JSON 条目(kind 住条目内,db schema 不加列);
 * - 命名派生:老图按命名归位;改名破规后由存量回填物化的持久值兜底(campaigns 脚本);
 * - 兜底:识别不出的落「自由」(10-25 用户裁定:自由就是放无类型图的)。
 *
 * 命名分类表逐字对齐 PRD Round 2 A 节(含既有全部产物族);Round 3 扩展令⑤新增
 * scene/tool 直认标记(_场景_/_概念气氛图_/_3D剖面场景图_/_道具_,对 scene/tool
 * 存量图名同样适用,识别不出落「自由」)。Python 侧存量回填脚本
 * apps/build/scripts/campaigns/asset_image_kind_backfill_1024.py 镜像本表,改表两处同步。
 */
const ASSET_IMAGE_NAME_KIND_TABLE: ReadonlyArray<readonly [AssetImageKind, readonly string[]]> = [
  ["高清人脸", ["_人脸_", "_高清大脸_"]],
  ["表情差分", ["_表情差分_"]],
  // 10-25 用户裁定:正视图/人物图(全身立绘参考图)归人物多视图节,人物海报节只留真海报产物
  ["人物多视图", ["_三视图_", "_正视图_", "_人物图_", "_多视图_", "_人物多视图_"]],
  ["人物海报", ["_人物海报_"]],
  ["美宣", ["_海报_", "_美宣_"]],
  ["全身定妆", ["_全身定妆_"]],
  ["设定卡", ["_设定卡_"]],
  ["人脸基准", ["_人脸基准_"]],
  // Round 3 ⑤ scene/tool 直认标记(先专后泛:_概念气氛图_ 含 _气氛图_/_3D剖面场景图_
  // 含 _剖面场景图_,专标在前防误吞;_场景_ 与 _3D剖面场景图_ 无前导下划线邻接,零重叠)
  ["3D剖面场景图", ["_3D剖面场景图_", "_剖面场景图_"]],
  ["概念气氛图", ["_概念气氛图_", "_气氛图_"]],
  ["场景", ["_场景_"]],
  ["道具", ["_道具_"]],
  ["自由", ["_自由_"]],
];

/** role 轨型谱节序(grill Round 1 裁定2:身份链根→常规产物→重版式→工具型→兜底;10-25 裁定:无类型图落自由,不再有未分类节)。 */
export const ASSET_IMAGE_KIND_ORDER: readonly AssetImageKind[] = [
  "全身定妆",
  "人物海报",
  "人物多视图",
  "高清人脸",
  "表情差分",
  "设定卡",
  "美宣",
  "人脸基准",
  "自由",
];

/** role 轨核心五必备(grill Round 1 裁定1:缺失红色告警,一键补缺范围)。 */
export const CORE_ASSET_IMAGE_KINDS: readonly AssetImageKind[] = [
  "全身定妆",
  "人物海报",
  "人物多视图",
  "高清人脸",
  "表情差分",
];

/** role 轨扩展四型(裁定1:灰色占位不告警;NPC 不强求全七型)。 */
export const EXTENDED_ASSET_IMAGE_KINDS: readonly AssetImageKind[] = [
  "设定卡",
  "美宣",
  "人脸基准",
  "自由",
];

/**
 * 型谱→画幅徽标(图卡宽随型画幅比:3:4≈120px/16:9≈284px/1:1=160px)。
 * Round 3 ⑤ 四型画幅逐字对齐十型真源 qi21_bases.json aspect_ratio。
 */
export const ASSET_IMAGE_KIND_ASPECTS: Record<Exclude<AssetImageKind, "早期未分类">, string> = {
  全身定妆: "3:4",
  人物海报: "3:4",
  人物多视图: "16:9",
  高清人脸: "1:1",
  表情差分: "1:1",
  设定卡: "16:9",
  美宣: "16:9",
  人脸基准: "1:1",
  自由: "1:1",
  场景: "16:9",
  概念气氛图: "16:9",
  "3D剖面场景图": "16:9",
  道具: "1:1",
};

/**
 * 图片三轨(Round 3 扩展令⑤:型谱从 role 专属推广;clip/audio 无型谱维持现状零动)。
 */
export type AssetImageTrack = "role" | "scene" | "tool";

/** 单轨型谱:节序(含早期未分类沉底)+核心/扩展分级(完整度面板两行分级同款)。 */
export interface AssetImageKindSpectrum {
  order: readonly AssetImageKind[];
  core: readonly AssetImageKind[];
  extended: readonly AssetImageKind[];
}

/**
 * 三轨型谱表(Round 3 扩展令⑤,归属按十四型真源):
 * - role(不变):核心=全身定妆/人物海报/人物多视图/高清人脸/表情差分;扩展=设定卡/美宣/人脸基准/自由;
 * - scene(新):核心=场景/概念气氛图/3D剖面场景图;扩展=自由;
 * - tool(新):核心=道具(rgba 透明型);扩展=自由。
 */
export const ASSET_IMAGE_KIND_SPECTRA: Record<AssetImageTrack, AssetImageKindSpectrum> = {
  role: { order: ASSET_IMAGE_KIND_ORDER, core: CORE_ASSET_IMAGE_KINDS, extended: EXTENDED_ASSET_IMAGE_KINDS },
  scene: {
    order: ["场景", "概念气氛图", "3D剖面场景图", "自由"],
    core: ["场景", "概念气氛图", "3D剖面场景图"],
    extended: ["自由"],
  },
  tool: {
    order: ["道具", "自由"],
    core: ["道具"],
    extended: ["自由"],
  },
};

/** 资产类型→图片三轨收敛(clip/audio/未知 → undefined,调用方守卫;分节视图据此判三轨通用)。 */
export function asAssetImageTrack(type: StudioAssetKind): AssetImageTrack | undefined {
  return type === "role" || type === "scene" || type === "tool" ? type : undefined;
}

/** 轨道型谱查表(仅图片三轨;clip/audio 返回 undefined)。 */
export function getAssetImageKindSpectrum(track: AssetImageTrack): AssetImageKindSpectrum {
  return ASSET_IMAGE_KIND_SPECTRA[track];
}

const KNOWN_KINDS = new Set<string>([
  ...ASSET_IMAGE_KIND_ORDER,
  "场景",
  "概念气氛图",
  "3D剖面场景图",
  "道具",
]);

/** 持久值合法校验:images[] JSON 属不可信边界,伪 kind 不进型谱(落命名派生路)。 */
export function isAssetImageKind(value: unknown): value is AssetImageKind {
  return typeof value === "string" && KNOWN_KINDS.has(value);
}

/** 命名规则分类(表序先专后泛;识别不出=自由,10-25 用户裁定)。 */
export function classifyAssetImageName(name: string): AssetImageKind {
  for (const [kind, markers] of ASSET_IMAGE_NAME_KIND_TABLE) {
    if (markers.some((marker) => name.includes(marker))) return kind;
  }
  return "自由";
}

/** 三层解析单源:持久值(合法且非遗留「早期未分类」)→命名规则→自由。
 * 10-25 用户裁定:无类型图落自由;回填脚本持久化的遗留「早期未分类」值在此重解析归自由。 */
export function classifyAssetImage(entry: Pick<AssetImage, "name" | "kind">): AssetImageKind {
  if (entry.kind && isAssetImageKind(entry.kind) && entry.kind !== "早期未分类") return entry.kind;
  return classifyAssetImageName(entry.name);
}

/**
 * 按型谱节序分组(index=入参序,供全局单选图/预览序列按原下标回调;泛型保完整条目型)。
 * Round 3 ⑤:spectrumOrder 可传轨道型谱节序(缺省=role 谱,既有调用方零变化);
 * 分类结果不在谱内(如 scene 资产里名为 _海报_ 的图)沉「自由」(10-25 裁定),防越谱丢图。
 */
export function groupAssetImagesByKind<T extends Pick<AssetImage, "name" | "kind">>(
  images: T[],
  spectrumOrder: readonly AssetImageKind[] = ASSET_IMAGE_KIND_ORDER,
): Map<AssetImageKind, Array<{ image: T; index: number }>> {
  const groups = new Map<AssetImageKind, Array<{ image: T; index: number }>>(
    spectrumOrder.map((kind) => [kind, []]),
  );
  images.forEach((image, index) => {
    const kind = classifyAssetImage(image);
    groups.get(spectrumOrder.includes(kind) ? kind : "自由")!.push({ image, index });
  });
  return groups;
}
