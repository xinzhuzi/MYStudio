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
  // 1120 用户令:「高清人脸」型改名「高清人头」(去肩去衣止颈根)。新标记 _高清人头_
  // 在前;_人脸_/_高清大脸_ 留作存量名别名归并(10-26 无衣物定妆改名同款先例)。
  ["高清人头", ["_高清人头_", "_人脸_", "_高清大脸_"]],
  ["表情差分", ["_表情差分_"]],
  // 10-25 用户裁定:正视图/人物图(全身立绘参考图)归人物多视图节,人物海报节只留真海报产物
  // 10-25 用户裁定(二令):海报产物(_海报_ 标记,十境海报战役族)是人物海报,
  // 不是美宣——美宣节只收 _美宣_ 命名的真美宣产物
  ["人物多视图", ["_三视图_", "_正视图_", "_人物图_", "_多视图_", "_人物多视图_"]],
  ["人物海报", ["_人物海报_", "_海报_"]],
  ["美宣", ["_美宣_"]],
  // 10-26 用户令:「全身定妆」全称改「无衣物定妆」(素体语义直陈);旧标记保留为
  // 别名归并(v1 等存量名不丢)
  ["无衣物定妆", ["_无衣物定妆_", "_全身定妆_"]],
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

/** role 轨型谱节序(1120 用户令:人脸基准置顶→无衣物定妆次之,与提示词两卡
 * 同序;其余承 grill Round 1 裁定2 身份链根→常规产物→重版式→工具型→兜底;
 * 10-25 裁定:无类型图落自由,不再有未分类节)。 */
export const ASSET_IMAGE_KIND_ORDER: readonly AssetImageKind[] = [
  "人脸基准",
  "无衣物定妆",
  "人物海报",
  "人物多视图",
  "高清人头",
  "表情差分",
  "设定卡",
  "美宣",
  "自由",
];

/** role 轨核心五必备(grill Round 1 裁定1:缺失红色告警,一键补缺范围)。 */
export const CORE_ASSET_IMAGE_KINDS: readonly AssetImageKind[] = [
  "无衣物定妆",
  "人物海报",
  "人物多视图",
  "高清人头",
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
  无衣物定妆: "3:4",
  人物海报: "3:4",
  人物多视图: "16:9",
  高清人头: "1:1",
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

/**
 * 引擎型层键别名(10-26 用户令·更名):UI 型名「无衣物定妆」而引擎 bases.json 十型
 * 已四副本随更名(10-26)——别名表恒等(源提示词四副本已随更名)。
 */
export const ENGINE_BASE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  // 10-26 源提示词四副本已随更名:引擎键=UI 名=无衣物定妆,别名表恒等(留函数口
  // 供未来再遇 UI 名≠引擎键场景;当前空表)
};

export function engineBaseTypeFor(kind: string): string {
  return ENGINE_BASE_TYPE_ALIASES[kind] ?? kind;
}

/** 单轨型谱:节序(含早期未分类沉底)+核心/扩展分级(完整度面板两行分级同款)。 */
export interface AssetImageKindSpectrum {
  order: readonly AssetImageKind[];
  core: readonly AssetImageKind[];
  extended: readonly AssetImageKind[];
}

/**
 * 三轨型谱表(Round 3 扩展令⑤,归属按十四型真源):
 * - role(不变):核心=无衣物定妆/人物海报/人物多视图/高清人头/表情差分;扩展=设定卡/美宣/人脸基准/自由;
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

/**
 * 单图型集合(10-25 用户令:很多类型最多 1 张图——高清人脸/表情差分/无衣物定妆等,
 * "等我以后扩展了再搞多张图"):这些型再生成=替换(生成成功先清该型旧图再收编),
 * 多图型(人物海报/人物多视图分境界族、自由、场景/道具族)不受限。以后某型要
 * 支持多张,从此集合摘除即恢复堆图语义。
 * 1122 多张化解禁(11-22 用户令「设定卡不止1张」,10-25 预埋扩展口到岗):设定卡
 * 摘出本集合——通用清旧路对设定卡归零(堆图语义地基),多张纪律改走格式槽轴
 * (四档各一槽,同档再生成=槽内替换,槽语义见 sheetCardSlotReplacementFilePaths;
 * PRD .trellis/tasks/11-22-asset-sheet-multi)。
 */
export const SINGLE_IMAGE_KINDS: ReadonlySet<AssetImageKind> = new Set([
  "无衣物定妆",
  "高清人头",
  "表情差分",
  "人脸基准",
  "美宣",
]);

/**
 * 单图型替换清扫(10-25 用户令):kind 属单图型时,返回 images 中该型全部条目的
 * filePath(供调用方在收编新图前逐条 removeImage——替换语义);非单图型恒空表
 * (多图型零干预)。归型走 classifyAssetImage 三层解析(与展示节同口径)。
 */
export function singleKindReplacementFilePaths(
  images: ReadonlyArray<Pick<AssetImage, "name" | "kind" | "filePath">>,
  kind: AssetImageKind,
): string[] {
  if (!SINGLE_IMAGE_KINDS.has(kind)) return [];
  return images
    .filter((image) => classifyAssetImage(image) === kind && image.filePath)
    .map((image) => image.filePath!);
}

// ─── 设定卡格式槽轴(1122 多张化解禁,PRD .trellis/tasks/11-22-asset-sheet-multi)───

/**
 * 设定卡格式四档(裁定A:格式四档各一张):书写序逐字对齐引擎注册表真源
 * sheet_card_formats.py formats_list——「全卡」恒首键=缺省档契约(新增格式只能
 * 尾部追加);简版/竖版(2160×3840)/无装备(1114 用户令,武器区+装备区全撤)。
 * App 侧消费轴:产物名插格式段(R4 `_设定卡_{格式}_中文日期`)/同档再生成=槽内
 * 替换(R1)/设定卡节生成入口四选一(R2)。
 */
export const SHEET_CARD_FORMATS = ["全卡", "简版", "竖版", "无装备"] as const;

/** 格式档类型(四键字面量并集)。 */
export type SheetCardFormat = (typeof SHEET_CARD_FORMATS)[number];

/** 缺省档(=真源首键「全卡」契约;历史无格式段名同归此槽,裁定E 零迁移)。 */
export const SHEET_CARD_FORMAT_DEFAULT: SheetCardFormat = "全卡";

/** 格式档合法校验(UI 选择/持久边界值防野值)。 */
export function isSheetCardFormat(value: unknown): value is SheetCardFormat {
  return typeof value === "string" && (SHEET_CARD_FORMATS as readonly string[]).includes(value);
}

/**
 * 产物名→格式槽解析(R4):`_设定卡_{格式}_` 四键匹配取**最右**标记;无格式段
 * (含归档 `_2` 名与历史名)缺省归全卡槽(与缺省档契约同构)。日期段为
 * `YYYY年MM月DD日` 形,与四档键(仅四个中文词)恒不撞;四键互不为子串。
 * 最右标记=classifyAssetImageName 10-25 深审修同款语义:设定卡命名锚=轮播当前
 * 图名(actions inputImageName),锚名常含上一轮 `_设定卡_{旧档}_` 标记,链式名
 * `…_设定卡_{F1}_日期_设定卡_{F2}_日期` 首中会判成旧档 F1(异档卡归错槽→被同档
 * 清旧路物理误删),最右=最近一次生成动作的格式档,链式语义恒对。
 */
export function sheetCardSlotFormatOfName(name: string): SheetCardFormat {
  let best: SheetCardFormat | null = null;
  let bestAt = -1;
  for (const format of SHEET_CARD_FORMATS) {
    const at = name.lastIndexOf(`_设定卡_${format}_`);
    if (at > bestAt) {
      bestAt = at;
      best = format;
    }
  }
  return best ?? SHEET_CARD_FORMAT_DEFAULT;
}

/**
 * 格式槽替换清扫(1122 槽纪律,R1):设定卡已摘出 SINGLE_IMAGE_KINDS(通用清旧
 * 归零),同档再生成=仅清该档槽内旧图(异档零干预);归型走 classifyAssetImage
 * 三层解析(与展示节同口径),槽归属按名内格式段(sheetCardSlotFormatOfName)。
 * excludeFilePath=收编验收后按刷新库重算时排除新卡本体(行级主图位)。
 */
export function sheetCardSlotReplacementFilePaths(
  images: ReadonlyArray<Pick<AssetImage, "name" | "kind" | "filePath">>,
  format: SheetCardFormat,
  options?: { excludeFilePath?: string },
): string[] {
  const paths = new Set<string>();
  for (const image of images) {
    if (!image.filePath || image.filePath === options?.excludeFilePath) continue;
    if (classifyAssetImage(image) !== "设定卡") continue;
    if (sheetCardSlotFormatOfName(image.name) !== format) continue;
    paths.add(image.filePath);
  }
  return [...paths];
}

/**
 * 型锚图查找(10-25 用户令·派生流水线):返回 images 中该型最新一张(尾部=追加
 * 序最新)的 url/名——高清人头·图生图与表情差分以无衣物定妆图为锚生图,不再随
 * 轮播当前图漂。归型走 classifyAssetImage 三层解析;无该型图返回 null。
 */
export function latestKindImage<T extends Pick<AssetImage, "name" | "kind" | "url">>(
  images: readonly T[],
  kind: AssetImageKind,
): { url: string; name: string } | null {
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const image = images[i]!;
    if (classifyAssetImage(image) === kind && image.url) {
      return { url: image.url, name: image.name };
    }
  }
  return null;
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

/** 命名规则分类(表序先专后泛;识别不出=自由,10-25 用户裁定)。
 * 10-25 深审修(链式生成错节):多个型标记同现时取**最右**标记——生成产物名=
 * `锚图名_{新型}_日期`,锚图名常含上一轮 `_人脸_`/`_表情差分_` 等旧标记,首命中
 * 会把新产物判成旧型(重开弹窗/族兄弟视图即错节+补缺死循环);最右标记=最近一次
 * 生成动作的型,链式语义恒对。 */
export function classifyAssetImageName(name: string): AssetImageKind {
  let best: AssetImageKind | null = null;
  let bestAt = -1;
  for (const [kind, markers] of ASSET_IMAGE_NAME_KIND_TABLE) {
    for (const marker of markers) {
      const at = name.lastIndexOf(marker);
      if (at > bestAt) {
        bestAt = at;
        best = kind;
      }
    }
  }
  return best ?? "自由";
}

/** 存量持久值别名归并(1120 用户令:型名高清人脸→高清人头):改型名后 images[]
 * 里已持久化的旧 kind 值在此归位,免 DB 迁移(命名标记别名同款思路,10-26 先例)。 */
const LEGACY_ASSET_IMAGE_KIND_ALIASES: Readonly<Record<string, AssetImageKind>> = {
  高清人脸: "高清人头",
};

/** 三层解析单源:持久值(别名归并后合法且非遗留「早期未分类」)→命名规则→自由。
 * 10-25 用户裁定:无类型图落自由;回填脚本持久化的遗留「早期未分类」值在此重解析归自由。 */
export function classifyAssetImage(entry: Pick<AssetImage, "name" | "kind">): AssetImageKind {
  const rawKind = entry.kind ? (LEGACY_ASSET_IMAGE_KIND_ALIASES[entry.kind] ?? entry.kind) : entry.kind;
  if (rawKind && isAssetImageKind(rawKind) && rawKind !== "早期未分类") return rawKind;
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
