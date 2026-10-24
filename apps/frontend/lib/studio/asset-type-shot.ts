import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { AssetImage, AssetImageKind } from "@/types/studio-assets";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";
import {
  ASSET_IMAGE_KIND_ASPECTS,
  CORE_ASSET_IMAGE_KINDS,
  groupAssetImagesByKind,
} from "./asset-image-kind";

/**
 * 按型出图 service(10-24 批3,PRD §①「按型出图按钮族」型驱动通用件)。
 *
 * 型档案表=单一真源(七型:全身定妆/人物海报/人物多视图/人脸基准/自由/设定卡/美宣),
 * 档案字段对齐十型真源 qi21_bases.json 角色相关子集(zh 名/画幅/rgba_default/取景借语/route)。
 * - route 分流(grill Round 1 裁定3,禁一刀切):设定卡/美宣=t2i+base_type(身份要素主要
 *   来自文字设定,型文收益>参考图收益,且 Phase 1 即得型层正途);余五型=i2i(Phase1 借语)。
 * - Phase 1(10-24 批3军令):i2i 路借语模式(指令承载取景,纯色底),与表情差分 335000bd
 *   同款;i2i 现结构=画风转换硬编码+画幅跟参考 AR×2(既定边界,注释在档)。
 * - Phase 2(桥役实弹验收后,PRD F 节衔接):TYPE_SHOT_I2I_USE_BASE_TYPE 单点置 true,
 *   五型一起升级 extraParams:{base_type} 型文全拼+型负面+真透明底+型画幅,届时指令瘦身。
 *
 * 纪律与画风转换/人脸/表情差分同源:指令即终稿(promptPolicy=raw,传输层禁 normalize
 * 再追加);单段中文、肯定式、无否定式词(i2i 路 Assembly 否定式门,「不变」为标准保真
 * 措辞在册)、比例禁入正文、负面不写;诊断四点 operationId 贯通。
 */

/** 本地直通渠道模型名(与画风转换/人脸/表情差分同渠道)。 */
export const ASSET_TYPE_SHOT_MODEL = "qwen-image-2-1";

/** Phase 2 单点开关(候桥役实弹验收后置 true):i2i 路统一切 base_type 型层注入。 */
export const TYPE_SHOT_I2I_USE_BASE_TYPE = false;

/** 型档案 route 生成路(grill Round 1 裁定3)。 */
export type AssetTypeShotRoute = "i2i" | "t2i";

export interface AssetTypeShotProfile {
  /** 型名(=AssetImageKind 枚举成员,亦为 base_type 注入名)。 */
  kind: Exclude<AssetImageKind, "早期未分类">;
  /** 画幅徽标(3:4/16:9/1:1;复用批2 型谱画幅单源)。 */
  aspect: string;
  /** 透明徽标(真源=qi21_bases.json rgba_default;Phase1 借语产物为纯色底,Phase2 得真透明)。 */
  rgba: boolean;
  /** 生成路:i2i=参考图锚身份+取景借语;t2i=描述主体句+base_type 型层承载取景。 */
  route: AssetTypeShotRoute;
  /** i2i 路取景借语(借自该型 qi21_bases positive_text 取景语言;保真段先行+取景段收束)。 */
  i2iInstruction?: string;
}

/**
 * 型档案表(节序=grill Round 1 裁定2 型谱节序)。rgba 逐字对齐十型真源
 * qi21_bases.json rgba_default(全身定妆/人物多视图/人脸基准=透明;海报/自由/
 * 设定卡/美宣=不透明);取景借语逐条借自同真源 positive_text 的取景段。
 */
export const ASSET_TYPE_SHOT_PROFILES: readonly AssetTypeShotProfile[] = [
  {
    kind: "全身定妆",
    aspect: ASSET_IMAGE_KIND_ASPECTS["全身定妆"],
    rgba: true,
    route: "i2i",
    i2iInstruction:
      "保持画中人物的面部身份、五官特征、发型与体型轮廓不变；将画面重构成该角色的全身定妆立绘：正面直立站姿，双臂自然垂于身侧，双手放松自然，头顶至足底全身完整入画，人物比例与解剖结构清晰；通身素体呈现，零衣物零配饰零鞋履，肌肤匀净，人物主体边缘干净完整，背景为纯色。",
  },
  {
    kind: "人物海报",
    aspect: ASSET_IMAGE_KIND_ASPECTS["人物海报"],
    rgba: false,
    route: "i2i",
    i2iInstruction:
      "保持画中人物的面部身份、五官特征、发型与服饰设定不变；将画面重构成该角色的单人全身立绘海报：全身完整入画，头顶与足底完整呈现，人物比例服从其年龄与体型设定，解剖结构清晰；身体姿态呈自然直立站姿，双手自然垂于身侧，人物细节密度最高，背景为纯色。",
  },
  {
    kind: "人物多视图",
    aspect: ASSET_IMAGE_KIND_ASPECTS["人物多视图"],
    rgba: true,
    route: "i2i",
    i2iInstruction:
      "保持画中人物的面部身份、五官特征、发型、服饰与体型设定不变；将画面重构成同一角色的多视图设定参考图，共四幅：左侧为一张较大的完整头肩特写，正面朝向观众，双眼平视镜头；右侧为同一角色的正面、纯90度侧面与背面全身三视图，三视图并排等宽等高排列，全身可见，同姿势、同服装、同尺度，机位一致正交平视，表情自然中性，站姿稳定，背景为纯色。",
  },
  {
    kind: "人脸基准",
    aspect: ASSET_IMAGE_KIND_ASPECTS["人脸基准"],
    rgba: true,
    route: "i2i",
    i2iInstruction:
      "保持画中人物的面部身份与五官特征不变；将画面重构成该角色的人脸基准底版：正面平视机位，视线直视镜头，取景为头部与颈部、止于颈根，头顶、头颅外轮廓与下颌完整；头颅光洁呈现，零发型零衣领零衣物，面部是画面焦点，五官与眉眼轮廓清晰锐利，背景为纯色。",
  },
  {
    kind: "自由",
    aspect: ASSET_IMAGE_KIND_ASPECTS["自由"],
    rgba: false,
    route: "i2i",
    // 自由型无型文约束(真源 positive_text 恒空):借语只留保真段+1:1 方形画幅交代
    i2iInstruction:
      "保持画中人物的面部身份、五官特征、发型与服饰设定不变；以 1:1 方形画幅重新呈现该角色，构图与取景自由，人物主体完整清晰，背景为纯色。",
  },
  {
    kind: "设定卡",
    aspect: ASSET_IMAGE_KIND_ASPECTS["设定卡"],
    rgba: false,
    route: "t2i",
  },
  {
    kind: "美宣",
    aspect: ASSET_IMAGE_KIND_ASPECTS["美宣"],
    rgba: false,
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

/** 一键补缺队列计划(纯函数):按核心五必备节序返回缺失型序列(计数=展示图集分组)。 */
export function planAssetTypeFillMissingQueue(
  images: Array<Pick<AssetImage, "name" | "kind">>,
): AssetImageKind[] {
  const groups = groupAssetImagesByKind(images);
  return CORE_ASSET_IMAGE_KINDS.filter((kind) => (groups.get(kind)?.length ?? 0) === 0);
}

export interface AssetTypeShotTask {
  assetId: string;
  assetName: string;
  /** 型名(单一参数,查型档案表分流)。 */
  kind: AssetImageKind;
  /** route="i2i" 必填:全局选中图 url(引擎层统一缩略/去 canvas 污染)。 */
  referenceImage?: string;
  /** route="t2i" 必填:角色描述主体句(出图提示词优先,描述兜底)。 */
  subjectText?: string;
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
 * 按型出图(角色轨专用,型驱动通用件):查档案分流 route → qwen-image-2-1 本地渠道
 * 直通 → 复用 saveGeneratedAssetImage 落盘 + updateStoreWithResult(character 轨)写回。
 * 异常透传为 {phase:"failed", error}(禁静默);成功返回落盘本地路径。
 */
export async function generateAssetTypeShot(
  task: AssetTypeShotTask,
  onProgress?: (progress: AssetTypeShotProgress) => void,
): Promise<AssetTypeShotProgress> {
  const operationId = task.operationId ?? createOperationId("asset-type-shot");
  const profile = getAssetTypeShotProfile(task.kind);
  if (!profile) {
    return { phase: "failed", error: `未知型名「${task.kind}」，按型出图七型档案未收录` };
  }
  const isI2i = profile.route === "i2i";
  const prompt = isI2i
    ? (profile.i2iInstruction ?? "")
    : (task.subjectText || "").trim();
  if (isI2i && !task.referenceImage) {
    return { phase: "failed", error: "按型出图 i2i 路缺少可作参考的图片" };
  }
  if (!isI2i && !prompt) {
    return { phase: "failed", error: "按型出图 t2i 路缺少可用的角色描述或提示词" };
  }
  void logEvent({
    level: "info",
    category: "ai",
    operationId,
    message: "Asset type shot instruction built",
    context: {
      kind: task.kind,
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
            // Phase 1 借语模式零 base_type;Phase 2 单点开关打开即五型一起升级
            // 型文全拼档(取景归还型层+真透明底+型画幅),指令届时瘦身
            ...(TYPE_SHOT_I2I_USE_BASE_TYPE ? { extraParams: { base_type: task.kind } } : {}),
          }
        : {
            model: ASSET_TYPE_SHOT_MODEL,
            prompt,
            promptPolicy: "raw",
            // t2i 路(设定卡/美宣,裁定3):型层走 base_type 注入,16:9 排布语言/
            // 分栏结构/型负面全由型文承载,画幅由型层 WhSuggest 决定(与人脸 t2i 同款)
            extraParams: { base_type: task.kind },
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
      assetType: "character",
      assetId: task.assetId,
      assetName: task.assetName,
      projectId: task.projectId,
      isDerivative: task.isDerivative ?? false,
      chapterId: task.chapterId,
      category: "characters",
    });
    updateStoreWithResult(task.assetId, "character", { imageLocalPath: localPath });
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset type shot image saved",
      context: { assetId: task.assetId, assetName: task.assetName, kind: task.kind, imageLocalPath: localPath },
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
