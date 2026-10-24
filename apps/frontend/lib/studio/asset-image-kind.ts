import type { AssetImage, AssetImageKind } from "@/types/studio-assets";

/**
 * 角色图片类型单源(10-24 图片展示规范批2,PRD Round 2 A 节决议)。
 * 三层解析:classifyAssetImage(entry) = entry.kind(持久值) ?? 命名规则分类(name) ?? 早期未分类。
 * - 持久值:生成写路经 addImage IPC 落 images[] JSON 条目(kind 住条目内,db schema 不加列);
 * - 命名派生:老图按命名归位;改名破规后由存量回填物化的持久值兜底(campaigns 脚本);
 * - 兜底:识别不出的落「早期未分类」。
 *
 * 命名分类表逐字对齐 PRD Round 2 A 节(含既有全部产物族);Python 侧存量回填脚本
 * apps/build/scripts/campaigns/asset_image_kind_backfill_1024.py 镜像本表,改表两处同步。
 */
const ASSET_IMAGE_NAME_KIND_TABLE: ReadonlyArray<readonly [AssetImageKind, readonly string[]]> = [
  ["高清人脸", ["_人脸_", "_高清大脸_"]],
  ["表情差分", ["_表情差分_"]],
  ["人物多视图", ["_三视图_", "_多视图_", "_人物多视图_"]],
  ["人物海报", ["_正视图_", "_人物图_", "_人物海报_"]],
  ["美宣", ["_海报_", "_美宣_"]],
  ["全身定妆", ["_全身定妆_"]],
  ["设定卡", ["_设定卡_"]],
  ["人脸基准", ["_人脸基准_"]],
  ["自由", ["_自由_"]],
];

/** 型谱节序(grill Round 1 裁定2:身份链根→常规产物→重版式→工具型→兜底;早期未分类沉底)。 */
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
  "早期未分类",
];

/** 核心五必备(grill Round 1 裁定1:缺失红色告警,一键补缺范围)。 */
export const CORE_ASSET_IMAGE_KINDS: readonly AssetImageKind[] = [
  "全身定妆",
  "人物海报",
  "人物多视图",
  "高清人脸",
  "表情差分",
];

/** 扩展四型(裁定1:灰色占位不告警;NPC 不强求全七型)。 */
export const EXTENDED_ASSET_IMAGE_KINDS: readonly AssetImageKind[] = [
  "设定卡",
  "美宣",
  "人脸基准",
  "自由",
];

/** 型谱→画幅徽标(图卡宽随型画幅比:3:4≈120px/16:9≈284px/1:1=160px)。 */
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
};

const KNOWN_KINDS = new Set<string>(ASSET_IMAGE_KIND_ORDER);

/** 持久值合法校验:images[] JSON 属不可信边界,伪 kind 不进型谱(落命名派生路)。 */
export function isAssetImageKind(value: unknown): value is AssetImageKind {
  return typeof value === "string" && KNOWN_KINDS.has(value);
}

/** 命名规则分类(表序先专后泛;识别不出=早期未分类)。 */
export function classifyAssetImageName(name: string): AssetImageKind {
  for (const [kind, markers] of ASSET_IMAGE_NAME_KIND_TABLE) {
    if (markers.some((marker) => name.includes(marker))) return kind;
  }
  return "早期未分类";
}

/** 三层解析单源:持久值(合法时)→命名规则→早期未分类。 */
export function classifyAssetImage(entry: Pick<AssetImage, "name" | "kind">): AssetImageKind {
  if (isAssetImageKind(entry.kind)) return entry.kind;
  return classifyAssetImageName(entry.name);
}

/** 按型谱节序分组(index=入参序,供全局单选图/预览序列按原下标回调;泛型保完整条目型)。 */
export function groupAssetImagesByKind<T extends Pick<AssetImage, "name" | "kind">>(
  images: T[],
): Map<AssetImageKind, Array<{ image: T; index: number }>> {
  const groups = new Map<AssetImageKind, Array<{ image: T; index: number }>>(
    ASSET_IMAGE_KIND_ORDER.map((kind) => [kind, []]),
  );
  images.forEach((image, index) => {
    groups.get(classifyAssetImage(image))!.push({ image, index });
  });
  return groups;
}
