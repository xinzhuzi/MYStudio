import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";

/**
 * 角色资产表情差分 service(10-21 用户令:资产库弹窗角色要有「表情差分」生图,
 * 图生图逻辑)。镜像 asset-face-portrait 图生图路:
 * - 轮播当前图作唯一参考,引擎自动路由 i2i 模板(组装用途=画风转换,
 *   装配产物=指令+美术风格底座);身份锚在图,指令承载九宫格取景语言
 *   (取景语言借自十型真源「表情差分」型文:三行三列/头顶至下颌/机位占比一致)。
 * - i2i 路结构上不出透明 Alpha(型层不注入,baked base=人物):本路产物为
 *   纯色底九宫格;型层透明底口径的产品走 t2i+base_type=表情差分(后续役)。
 * - 纪律与画风转换/人脸同源:指令即终稿(promptPolicy=raw);单段中文、
 *   肯定式、无否定式词、比例禁入正文、负面不写;诊断四点 operationId 贯通。
 */

/** 本地直通渠道模型名(与画风转换/人脸同渠道)。 */
export const EXPRESSION_SHEET_MODEL = "qwen-image-2-1";

/**
 * 图生图固定指令(取景语言借自「表情差分」型文 rgba_positive):保真段先行
 * +九宫格重构段收束;九格情绪为固定枚举(型 purpose 要求逐格指定情绪,
 * 按钮式功能取常用九情绪)。
 */
export const EXPRESSION_I2I_INSTRUCTION =
  "保持画中人物的面部身份、五官特征、发型与气质不变；生成该角色的九宫格脸部表情差分表，三行三列共九格，九格均为正面平视的脸部特写，取景从头顶至下颌，头顶、两侧耳部、下颌与发型外轮廓在各格内完整呈现；头部在各格中的位置与占比一致，机位一致正面平视；眉眼、眼睑、鼻颊与嘴部形态随各格情绪清晰变化，九格情绪依次为平静、微笑、大笑、严肃、愤怒、悲伤、惊讶、疑惑、坚毅；各格四周留出空边，面部是每格焦点，五官轮廓清晰锐利，头发概括为清晰成组的发束。";

export interface AssetExpressionSheetTask {
  assetId: string;
  assetName: string;
  /** 轮播当前图 url(引擎层统一缩略/去 canvas 污染)。 */
  referenceImage: string;
  projectId?: string;
  chapterId?: string;
  isDerivative?: boolean;
  /** 诊断贯通 id(调用方造;缺省自造兜底)。 */
  operationId?: string;
}

export interface AssetExpressionSheetProgress {
  phase: "generating" | "saving" | "done" | "failed";
  message?: string;
  imageLocalPath?: string;
  error?: string;
}

/**
 * 表情差分生成(角色轨专用,图生图单路):固定指令 → qwen-image-2-1 本地渠道
 * 直通 → 复用 saveGeneratedAssetImage 落盘 + updateStoreWithResult 写回。
 * 异常透传为 {phase:"failed", error}(禁静默);成功返回落盘本地路径。
 */
export async function generateAssetExpressionSheet(
  task: AssetExpressionSheetTask,
  onProgress?: (progress: AssetExpressionSheetProgress) => void,
): Promise<AssetExpressionSheetProgress> {
  const operationId = task.operationId ?? createOperationId("asset-expression-sheet");
  const prompt = EXPRESSION_I2I_INSTRUCTION;
  void logEvent({
    level: "info",
    category: "ai",
    operationId,
    message: "Asset expression sheet instruction built",
    context: { chars: prompt.length, head: prompt.slice(0, 24) },
  });
  let stage: "generating" | "saving" = "generating";
  try {
    onProgress?.({ phase: "generating", message: `正在生成 ${task.assetName} 的表情差分...` });
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Asset expression sheet generation started",
      context: {
        model: EXPRESSION_SHEET_MODEL,
        assetId: task.assetId,
        assetName: task.assetName,
        referenceImage: task.referenceImage?.slice(0, 120),
      },
    });
    const imageResult = await aiManager.generateImage({
      model: EXPRESSION_SHEET_MODEL,
      prompt,
      // 指令即终稿(与画风转换/人脸同款纪律):raw=传输层禁 normalize 再追加
      promptPolicy: "raw",
      referenceImages: [task.referenceImage],
    });
    if (!imageResult.url) {
      void logEvent({
        level: "error",
        category: "asset",
        operationId,
        message: "Asset expression sheet failed",
        context: { stage, assetName: task.assetName, reason: "no-url" },
      });
      return { phase: "failed", error: "图片生成未返回 URL" };
    }
    stage = "saving";
    onProgress?.({ phase: "saving", message: `正在保存 ${task.assetName} 的表情差分...` });
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
      message: "Asset expression sheet image saved",
      context: { assetId: task.assetId, assetName: task.assetName, imageLocalPath: localPath },
    });
    return { phase: "done", imageLocalPath: localPath };
  } catch (err: unknown) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Asset expression sheet failed",
      context: { stage, assetName: task.assetName },
      error: err,
    });
    return {
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
