import { aiManager } from "@/lib/ai/ai-manager";
import type { AssetType } from "@/lib/ai/prompt-polisher";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { ImageCategory } from "@/lib/media/image-storage";
import type { AssetImage, AssetImageKind } from "@/types/studio-assets";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";
import {
  ASSET_IMAGE_KIND_ASPECTS,
  ASSET_IMAGE_KIND_SPECTRA,
  groupAssetImagesByKind,
  type AssetImageTrack,
  engineBaseTypeFor,
} from "./asset-image-kind";

/**
 * 按型出图 service(10-24 批3,PRD §①「按型出图按钮族」型驱动通用件;
 * Round 3 扩展令⑤推广图片三轨/令⑥ Phase 2 收尾)。
 *
 * 型档案表=单一真源(role 七型:无衣物定妆/人物海报/人物多视图/人脸基准/自由/设定卡/美宣;
 * Round 3 ⑤ 新增 scene 三型[场景/概念气氛图/3D剖面场景图]+tool 一型[道具,rgba 透明型],
 * 自由=三轨通用),档案字段对齐十型真源 qi21_bases.json(zh 名/画幅/rgba_default/
 * tracks 轨道归属/route)。
 * - route 分流(grill Round 1 裁定3,禁一刀切):设定卡/美宣/道具=t2i+base_type(身份要素
 *   主要来自文字设定,型文收益>参考图收益);余型=i2i(参考图锚身份+型层注入)。
 * - Phase 2(10-24 Round 3 ⑥,桥役 3718e469 已落地并实弹验收):TYPE_SHOT_I2I_USE_BASE_TYPE
 *   已置 true——i2i 路统一切 extraParams:{base_type} 型层注入(桥覆写 4010 注型+
 *   4011/4022 组装用途→型画幅),终稿=指令+类型句+美术风格底座三段,型负面 merge 进
 *   负面槽,透明型(无衣物定妆/人物多视图/人脸基准/道具)RGBA 由 6:180 跟型自动激活;
 *   指令瘦身为「保真段+差异要点」(取景/版式/背景语言归还型层,零取景词防与型文双写)。
 *
 * 纪律与画风转换/人脸/表情差分同源:指令即终稿(promptPolicy=raw,传输层禁 normalize
 * 再追加);单段中文、肯定式、无否定式词(i2i 路 Assembly 否定式门,「不变」为标准保真
 * 措辞在册)、比例禁入正文、负面不写;诊断四点 operationId 贯通。
 */

/** 本地直通渠道模型名(与画风转换/人脸/表情差分同渠道)。 */
export const ASSET_TYPE_SHOT_MODEL = "qwen-image-2-1";

/** 型档案 track 归属沿用图片三轨单源(Round 3 ⑤)。 */
export type AssetTypeShotTrack = AssetImageTrack;

/**
 * Phase 2 单点开关(10-24 Round 3 ⑥ 置 true:桥役 3718e469 i2i 吃 base_type 已落地
 * 实弹):i2i 路统一 base_type 型层注入。保留开关形态供回滚(置 false 即回 Phase 1 借语)。
 */
export const TYPE_SHOT_I2I_USE_BASE_TYPE = true;

/** 型档案 route 生成路(grill Round 1 裁定3;Round 3 ⑤:道具=t2i,scene 三型=i2i)。 */
export type AssetTypeShotRoute = "i2i" | "t2i";

export interface AssetTypeShotProfile {
  /** 型名(=AssetImageKind 枚举成员,亦为 base_type 注入名)。 */
  kind: Exclude<AssetImageKind, "早期未分类">;
  /** track 归属(Round 3 ⑤;自由=三轨通用,role 谱回归零变化)。 */
  tracks: readonly AssetTypeShotTrack[];
  /** 画幅徽标(3:4/16:9/1:1;复用批2 型谱画幅单源)。 */
  aspect: string;
  /** 透明徽标(真源=qi21_bases.json rgba_default;Phase2 型层注入直出真 Alpha)。 */
  rgba: boolean;
  /** 生成路:i2i=参考图锚身份+型层注入;t2i=描述主体句+base_type 型层承载取景。 */
  route: AssetTypeShotRoute;
  /** i2i 路指令(Phase 2 瘦身态:保真段+差异要点;取景语言归还型层)。 */
  i2iInstruction?: string;
  /**
   * 构图约束句(10-26 用户令「美宣/设定卡 16:9 主体句换横幅构图语言」):
   * 写句层约束真源(示例句手册同款纪律),发车不注入(取景/构图语言归型层,
   * 指令槽零取景词防双写——本文件 Phase 2 纪律);UI 透出(主体句写作提示)候令。
   */
  compositionRule?: string;
}

/**
 * 型档案表(role 七型节序=grill Round 1 裁定2 型谱节序,Round 3 ⑤ 追加 scene 三型+道具,
 * 追加序不扰 role 谱)。rgba/画幅逐字对齐十型真源 qi21_bases.json(无衣物定妆/人物多视图/
 * 人脸基准/道具=透明;海报/自由/设定卡/美宣/场景三型=不透明)。
 */
export const ASSET_TYPE_SHOT_PROFILES: readonly AssetTypeShotProfile[] = [
  {
    kind: "无衣物定妆",
    tracks: ["role"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["无衣物定妆"],
    rgba: true,
    // 10-25 用户令(流水线定谳):无衣物定妆=文生图(角色身份源头,主体句+型层承载);
    // 高清人脸·图生图/表情差分改锚定妆图派生——原 i2i 固定指令(素体保真段)随路退役
    route: "t2i",
  },
  {
    kind: "人物海报",
    tracks: ["role"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["人物海报"],
    rgba: false,
    route: "i2i",
    // Phase 2 瘦身:保真段+立绘密度差异要点(全身入画/头顶足底取景归还型层)
    i2iInstruction:
      "保持画中人物的面部身份、五官特征、发型与服饰设定不变；将该角色重构成人物细节密度最高的单人立绘，人物比例服从其年龄与体型设定，解剖结构清晰。",
  },
  {
    kind: "人物多视图",
    tracks: ["role"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["人物多视图"],
    rgba: true,
    route: "i2i",
    // Phase 2 瘦身:保真段+跨视图一致性差异要点(四幅版式/机位语言归还型层)
    i2iInstruction:
      "保持画中人物的面部身份、五官特征、发型、服饰与体型设定不变；同一角色在各视图中面部特征、身形比例、发型、服装与配饰保持一致，表情自然中性。",
  },
  {
    kind: "人脸基准",
    tracks: ["role"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["人脸基准"],
    rgba: true,
    route: "i2i",
    // Phase 2 瘦身:保真段+光洁头颅差异要点(止颈取景/透明底归还型层;「光洁的头颅」
    // 为真源 purpose 钦定的主体句职责,型文不载,须留在指令)
    i2iInstruction:
      "保持画中人物的面部身份与五官特征不变；呈现该角色的人脸基准底版，头颅光洁呈现，零发型零衣领零衣物，五官与眉眼轮廓清晰锐利。",
  },
  {
    kind: "自由",
    tracks: ["role", "scene", "tool"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["自由"],
    rgba: false,
    route: "i2i",
    // 自由型无型文约束(真源 positive_text 恒空):保真段+自由构图交代
    // (1:1 型画幅由型层 WhSuggest 承载,比例禁入正文纪律随 Phase 2 解除双写)
    i2iInstruction:
      "保持画中主体的身份特征与设定不变；构图与取景自由，主体完整清晰。",
  },
  {
    kind: "设定卡",
    tracks: ["role"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["设定卡"],
    rgba: false,
    route: "t2i",
    // 10-26 用户令(设定卡变体):三视图格固有全身禁半身化,落「格内占比饱满+手脚可辨」
    compositionRule: "版式格人物主体占比饱满,手脚完整可辨(三视图固有全身,禁半身化)",
  },
  {
    kind: "美宣",
    tracks: ["role"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["美宣"],
    rgba: false,
    route: "t2i",
    // 10-26 用户令:16:9 横幅构图语言(半身特写/大场景气势),全身立绘归 3:4 海报路
    compositionRule: "横幅构图:半身特写或大场景气势立势,人物主体占比大,双手清晰醒目",
  },
  {
    kind: "场景",
    tracks: ["scene"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["场景"],
    rgba: false,
    route: "i2i",
    // Phase 2 出生即型层注入(桥役已落):保真段+空镜差异要点(前中远三层语言归还型层)
    i2iInstruction:
      "保持画中场景的空间结构、地物布局与时段氛围不变；以空镜场景呈现，环境即画面主体。",
  },
  {
    kind: "概念气氛图",
    tracks: ["scene"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["概念气氛图"],
    rgba: false,
    route: "i2i",
    // Phase 2:保真段+气氛构图差异要点(色彩分层/焦点色措辞归还型层)
    i2iInstruction:
      "保持画中场景的空间结构与色调氛围不变；以气氛为主的画面呈现，主体落在画面偏侧，以少数焦点色点睛。",
  },
  {
    kind: "3D剖面场景图",
    tracks: ["scene"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["3D剖面场景图"],
    rgba: false,
    route: "i2i",
    // Phase 2:保真段+剖切敞开差异要点(等距俯瞰/剖切方式/界画程式语言归还型层;
    // 层数与房间间数服从主体句=真源 purpose 钦定,按型出图无逐建筑输入,由参考图锚)
    i2iInstruction:
      "保持画中场景的建筑结构与空间布局不变；以立体剖面场景呈现，正面外墙与前侧屋面剖开，室内空间整体敞开完整可见，家具器物逐件安放在所属房间内。",
  },
  {
    kind: "道具",
    tracks: ["tool"],
    aspect: ASSET_IMAGE_KIND_ASPECTS["道具"],
    rgba: true,
    route: "t2i",
  },
];

const PROFILE_BY_KIND = new Map<string, AssetTypeShotProfile>(
  ASSET_TYPE_SHOT_PROFILES.map((profile) => [profile.kind, profile]),
);

/** 型档案查表(未入族型名返回 undefined,调用方守卫)。 */
export function getAssetTypeShotProfile(kind: AssetImageKind): AssetTypeShotProfile | undefined {
  return PROFILE_BY_KIND.get(kind);
}

/** 轨道型档案列(Round 3 ⑤:下拉菜单/型谱装配按当前资产轨取谱;自由=三轨通用恒在列)。 */
export function getAssetTypeShotProfilesForTrack(track: AssetTypeShotTrack): readonly AssetTypeShotProfile[] {
  return ASSET_TYPE_SHOT_PROFILES.filter((profile) => profile.tracks.includes(track));
}

/** 一键补缺队列计划(纯函数):按轨道型谱核心必备节序返回缺失型序列(计数=展示图集分组)。 */
export function planAssetTypeFillMissingQueue(
  images: Array<Pick<AssetImage, "name" | "kind">>,
  track: AssetTypeShotTrack = "role",
): AssetImageKind[] {
  const spectrum = ASSET_IMAGE_KIND_SPECTRA[track];
  const groups = groupAssetImagesByKind(images, spectrum.order);
  return spectrum.core.filter((kind) => (groups.get(kind)?.length ?? 0) === 0);
}

/** track→落盘/写回目标(与画风转换 CATEGORY_BY_ASSET_TYPE 同款三轨映射)。 */
const TRACK_SAVE_TARGETS: Record<AssetTypeShotTrack, { assetType: AssetType; category: ImageCategory }> = {
  role: { assetType: "character", category: "characters" },
  scene: { assetType: "scene", category: "scenes" },
  tool: { assetType: "prop", category: "props" },
};

/**
 * 多视图排布句裁尾(10-25 用户令·定妆单立绘语义):db 主体句尾常带「同一画面从
 * 左至右并排四视图:…」设定卡时代排布句,与无衣物定妆单立绘语义打架(模型产出
 * 三视图页而非单人立绘)。t2i 定妆路发车前自此组标记起裁到句尾;无标记原文
 * 返回(其他型/其他调用方零干预)。纯函数,晏燎 318 字实名钉测试。
 */
const MULTI_VIEW_LAYOUT_MARKERS = [
  "同一画面从左至右",
  "从左至右并排",
  "并排四视图",
  "并排三视图",
  "并排多视图",
] as const;

export function stripMultiViewLayoutClause(subject: string): string {
  let cutAt = -1;
  for (const marker of MULTI_VIEW_LAYOUT_MARKERS) {
    const at = subject.indexOf(marker);
    if (at >= 0 && (cutAt === -1 || at < cutAt)) cutAt = at;
  }
  if (cutAt === -1) return subject;
  return subject
    .slice(0, cutAt)
    .replace(/[，,。;；\s]+$/, "")
    .trimEnd();
}

export interface AssetTypeShotTask {
  assetId: string;
  assetName: string;
  /** 型名(单一参数,查型档案表分流)。 */
  kind: AssetImageKind;
  /** 图片三轨归属(Round 3 ⑤;缺省 role=既有调用方零变化,落盘/写回随轨分流)。 */
  track?: AssetTypeShotTrack;
  /** route="i2i" 必填:全局选中图 url(引擎层统一缩略/去 canvas 污染)。 */
  referenceImage?: string;
  /** route="t2i" 必填:主体描述句(出图提示词优先,描述兜底;按型槽覆盖优先,Phase C)。 */
  subjectText?: string;
  /** route="i2i" 可选:指令覆盖(10-25 追加令·i2i 指令可编辑)。非空时替代型档案
   * i2iInstruction 作为终稿指令发送(指令即终稿纪律不变,promptPolicy 恒 raw);
   * 空/缺省=引擎级固定指令(既有行为零变)。会话态,不持久化。 */
  instructionOverride?: string;
  /**
   * 画幅取向(10-26 用户裁定「人物海报横竖皆可」):缺省/竖=跟型(bases 型画幅);
   * "landscape"=手动横幅 1824×1024(桥 manual_width/height 通道,cfc672dd),
   * 主体句须配横幅构图语言(构图约束见型档案 compositionRule)。
   */
  orientation?: "landscape";
  projectId?: string;
  chapterId?: string;
  isDerivative?: boolean;
  /** 诊断贯通 id(调用方造;缺省自造兜底)。 */
  operationId?: string;
}

export interface AssetTypeShotProgress {
  phase: "generating" | "saving" | "done" | "failed";
  message?: string;
  imageLocalPath?: string;
  error?: string;
}

/**
 * 按型出图(型驱动通用件,Round 3 ⑤ 起图片三轨通用):查档案分流 route →
 * qwen-image-2-1 本地渠道直通(i2i 路 Phase 2 带 base_type 型层注入)→ 复用
 * saveGeneratedAssetImage 按 track 落盘 + updateStoreWithResult 写回。
 * 异常透传为 {phase:"failed", error}(禁静默);成功返回落盘本地路径。
 */
export async function generateAssetTypeShot(
  task: AssetTypeShotTask,
  onProgress?: (progress: AssetTypeShotProgress) => void,
): Promise<AssetTypeShotProgress> {
  const operationId = task.operationId ?? createOperationId("asset-type-shot");
  const profile = getAssetTypeShotProfile(task.kind);
  if (!profile) {
    return { phase: "failed", error: `未知型名「${task.kind}」，按型出图型档案未收录` };
  }
  const track: AssetTypeShotTrack = task.track ?? "role";
  const saveTarget = TRACK_SAVE_TARGETS[track];
  const isI2i = profile.route === "i2i";
  // 指令取值(10-25 追加令):i2i 路=会话级覆盖优先,空回退型档案固定指令;
  // 覆盖即终稿(沿用 raw 纪律),日志带 override 标记供审计
  // t2i 定妆路(10-25 用户令·单立绘语义):主体句裁掉多视图排布尾(与单人立绘
  // 构图打架,产出三视图页);按型槽覆写句同样过裁(用户槽句若带排布句同病同治)
  const prompt = isI2i
    ? (task.instructionOverride?.trim() || profile.i2iInstruction || "")
    : task.kind === "无衣物定妆"
      ? stripMultiViewLayoutClause((task.subjectText || "").trim())
      : (task.subjectText || "").trim();
  if (isI2i && !task.referenceImage) {
    return { phase: "failed", error: "按型出图 i2i 路缺少可作参考的图片" };
  }
  if (!isI2i && !prompt) {
    return { phase: "failed", error: "按型出图 t2i 路缺少可用的资产描述或提示词" };
  }
  void logEvent({
    level: "info",
    category: "ai",
    operationId,
    message: "Asset type shot instruction built",
    context: {
      kind: task.kind,
      track,
      route: profile.route,
      chars: prompt.length,
      head: prompt.slice(0, 24),
    },
  });
  let stage: "generating" | "saving" = "generating";
  try {
    onProgress?.({ phase: "generating", message: `正在生成 ${task.assetName} 的${task.kind}...` });
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Asset type shot generation started",
      context: {
        model: ASSET_TYPE_SHOT_MODEL,
        kind: task.kind,
        track,
        route: profile.route,
        assetId: task.assetId,
        assetName: task.assetName,
        referenceImage: task.referenceImage?.slice(0, 120),
        baseType: isI2i && !TYPE_SHOT_I2I_USE_BASE_TYPE ? null : task.kind,
      },
    });
    const imageResult = await aiManager.generateImage(
      isI2i
        ? {
            model: ASSET_TYPE_SHOT_MODEL,
            prompt,
            // 指令即终稿(与画风转换/人脸/表情差分同款纪律):raw=传输层禁 normalize
            // 再追加,英文清洗词被拼进指令槽发往引擎绑入 [400],终稿静默漂移
            promptPolicy: "raw",
            referenceImages: [task.referenceImage!],
            // Phase 2 型层注入(10-24 Round 3 ⑥,桥 3718e469 已落地):i2i 带 base_type
            // 切「道劫美术类型」全拼档——型文全拼+型负面+真透明底+型画幅(4010 注型+
            // 4011/4022 同覆写),指令只写保真段+差异要点;开关保留供回滚 Phase 1 借语
            ...(TYPE_SHOT_I2I_USE_BASE_TYPE ? { extraParams: { base_type: engineBaseTypeFor(task.kind) } } : {}),
            // 10-26 横竖皆可:横幅取向走桥 manual_width/height 手动槽(cfc672dd)
            ...(task.orientation === "landscape" ? { extraParams: { manual_width: 1824, manual_height: 1024 } } : {}),
          }
        : {
            model: ASSET_TYPE_SHOT_MODEL,
            prompt,
            promptPolicy: "raw",
            // t2i 路(设定卡/美宣/道具,裁定3+Round 3 ⑤):型层走 base_type 注入,
            // 排布语言/型负面/透明底全由型文承载,画幅由型层 WhSuggest 决定
            extraParams: {
              base_type: engineBaseTypeFor(task.kind),
              // 10-26 横竖皆可:横幅取向走桥 manual_width/height 手动槽(cfc672dd)
              ...(task.orientation === "landscape" ? { manual_width: 1824, manual_height: 1024 } : {}),
            },
          },
    );
    if (!imageResult.url) {
      void logEvent({
        level: "error",
        category: "asset",
        operationId,
        message: "Asset type shot failed",
        context: { stage, kind: task.kind, assetName: task.assetName, reason: "no-url" },
      });
      return { phase: "failed", error: "图片生成未返回 URL" };
    }
    stage = "saving";
    onProgress?.({ phase: "saving", message: `正在保存 ${task.assetName} 的${task.kind}...` });
    const localPath = await saveGeneratedAssetImage({
      source: imageResult.url,
      assetType: saveTarget.assetType,
      assetId: task.assetId,
      assetName: task.assetName,
      projectId: task.projectId,
      isDerivative: task.isDerivative ?? false,
      chapterId: task.chapterId,
      category: saveTarget.category,
    });
    updateStoreWithResult(task.assetId, saveTarget.assetType, { imageLocalPath: localPath });
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset type shot image saved",
      context: { assetId: task.assetId, assetName: task.assetName, kind: task.kind, track, imageLocalPath: localPath },
    });
    return { phase: "done", imageLocalPath: localPath };
  } catch (err: unknown) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Asset type shot failed",
      context: { stage, kind: task.kind, assetName: task.assetName },
      error: err,
    });
    return {
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
