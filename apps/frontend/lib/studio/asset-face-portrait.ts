import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";

/**
 * 角色资产高清人脸 service(10-21 用户令:人物弹窗要生成高清人脸,图生图+文生图都要)。
 *
 * 两路接线(零引擎/零工作流改动,全走 qwen-image-2-1 本地渠道既有装配):
 * - 图生图路(mode="image"):轮播当前图作唯一参考,引擎自动路由 i2i 模板
 *   (组装用途=道劫美术风格转换,装配产物=指令+美术风格底座);身份锚在图,指令负责
 *   重构成头肩特写——与「自由出图改上衣」同款重构机理,底座保证画风不跑。
 * - 文生图路(mode="text"):无参考走 t2i 模板,extraParams.base_type=高清人脸
 *   (十型真源 qi21_bases.json 既有型:1:1 正面头肩特写素材,排布语言/负面/
 *   画幅 WhSuggest 全由型层承载);主体句=角色描述,PE 链自动拼美术风格底座。
 *
 * 纪律与 asset-style-transfer 同源:指令即终稿(promptPolicy=raw,禁传输层
 * 追加英文清洗词);单段中文、肯定式、无否定式词、比例禁入正文、负面不写;
 * 诊断打点四点(构造/发起/成功/失败),operationId 贯通。
 */

/** 本地直通渠道模型名(与画风转换同渠道,1010「只留 qwen-image-2-1」裁定)。 */
export const FACE_PORTRAIT_MODEL = "qwen-image-2-1";

/** 文生图路注入的道劫型(十型真源既有「高清人脸」型,1:1 正面头肩特写素材)。 */
export const FACE_PORTRAIT_BASE_TYPE = "高清人脸";

/**
 * 图生图路固定指令(取景语言借自「高清人脸」型文:正面平视/直视镜头/
 * 头肩上缘/轮廓完整)。保真段先行+重构段收束;i2i 否定式门只查中文,
 * 「不变」为标准保真措辞与画风转换指令同款,过门无虞。
 */
export const FACE_I2I_INSTRUCTION =
  "保持画中人物的面部身份、五官特征、发型与气质不变；以正面平视机位生成该角色的高清人脸特写，视线直视镜头，取景为头部与肩部上缘，头顶、发型外轮廓与下颌完整，面部是画面焦点，五官与眉眼轮廓清晰锐利，面部细节密度最高，头发概括为清晰成组的发束。";

export type AssetFacePortraitMode = "image" | "text";

export interface AssetFacePortraitTask {
  assetId: string;
  assetName: string;
  /** image=图生图路(参考图锚身份);text=文生图路(描述锚身份,型层承载取景)。 */
  mode: AssetFacePortraitMode;
  /** mode="image" 必填:轮播当前图 url(引擎层统一缩略/去 canvas 污染)。 */
  referenceImage?: string;
  /** mode="text" 必填:角色描述主体句(出图提示词优先,描述兜底)。 */
  subjectText?: string;
  projectId?: string;
  chapterId?: string;
  isDerivative?: boolean;
  /** 诊断贯通 id(调用方造;缺省自造兜底,事件链恒有 operationId)。 */
  operationId?: string;
}

export interface AssetFacePortraitProgress {
  phase: "generating" | "saving" | "done" | "failed";
  message?: string;
  imageLocalPath?: string;
  error?: string;
}

/**
 * 高清人脸生成(角色轨专用):固定式两路 → qwen-image-2-1 本地渠道直通
 * → 复用 saveGeneratedAssetImage 落盘 + updateStoreWithResult(character 轨)写回。
 * 异常透传为 {phase:"failed", error}(禁静默);成功返回落盘本地路径。
 */
export async function generateAssetFacePortrait(
  task: AssetFacePortraitTask,
  onProgress?: (progress: AssetFacePortraitProgress) => void,
): Promise<AssetFacePortraitProgress> {
  const operationId = task.operationId ?? createOperationId("asset-face-portrait");
  const isImageMode = task.mode === "image";
  const prompt = isImageMode ? FACE_I2I_INSTRUCTION : (task.subjectText || "").trim();
  if (!isImageMode && !prompt) {
    return { phase: "failed", error: "文生图人脸缺少可用的角色描述或提示词" };
  }
  void logEvent({
    level: "info",
    category: "ai",
    operationId,
    message: "Asset face portrait instruction built",
    context: {
      mode: task.mode,
      chars: prompt.length,
      head: prompt.slice(0, 24),
      baseType: isImageMode ? null : FACE_PORTRAIT_BASE_TYPE,
    },
  });
  let stage: "generating" | "saving" = "generating";
  const actionLabel = isImageMode ? "图生图" : "文生图";
  try {
    onProgress?.({ phase: "generating", message: `正在生成 ${task.assetName} 的高清人脸(${actionLabel})...` });
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Asset face portrait generation started",
      context: {
        model: FACE_PORTRAIT_MODEL,
        mode: task.mode,
        assetId: task.assetId,
        assetName: task.assetName,
        referenceImage: task.referenceImage?.slice(0, 120),
        baseType: isImageMode ? null : FACE_PORTRAIT_BASE_TYPE,
      },
    });
    const imageResult = await aiManager.generateImage(
      isImageMode
        ? {
            model: FACE_PORTRAIT_MODEL,
            prompt,
            // 指令即终稿(与画风转换同款纪律):raw=传输层禁 normalize 再追加,
            // 否则英文清洗词会被拼进指令槽发往引擎绑入 [400],终稿静默漂移
            promptPolicy: "raw",
            referenceImages: [task.referenceImage!],
          }
        : {
            model: FACE_PORTRAIT_MODEL,
            prompt,
            promptPolicy: "raw",
            // 文生图路:型层走 base_type 注入(节点级优先于全局设置),高清人脸型
            // 承载 1:1 取景/排布语言/型负面,画幅由型层 WhSuggest 建议值决定
            extraParams: { base_type: FACE_PORTRAIT_BASE_TYPE },
          },
    );
    if (!imageResult.url) {
      void logEvent({
        level: "error",
        category: "asset",
        operationId,
        message: "Asset face portrait failed",
        context: { stage, mode: task.mode, assetName: task.assetName, reason: "no-url" },
      });
      return { phase: "failed", error: "图片生成未返回 URL" };
    }
    stage = "saving";
    onProgress?.({ phase: "saving", message: `正在保存 ${task.assetName} 的高清人脸...` });
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
      message: "Asset face portrait image saved",
      context: { assetId: task.assetId, assetName: task.assetName, mode: task.mode, imageLocalPath: localPath },
    });
    return { phase: "done", imageLocalPath: localPath };
  } catch (err: unknown) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Asset face portrait failed",
      context: { stage, mode: task.mode, assetName: task.assetName },
      error: err,
    });
    return {
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
