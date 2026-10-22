import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";

/**
 * 角色资产表情差分 service(10-21 用户令:资产库弹窗角色要有「表情差分」生图,
 * 图生图逻辑)。10-22 起切换型层注入路(桥已通:i2i 带 base_type 切「道劫美术
 * 类型」全拼档):
 * - 轮播当前图作唯一参考锚身份;型层走 extraParams.base_type=表情差分——
 *   九宫格版式/机位一致锁/透明底/型负面全由型文承载(指令不再手搓取景语言),
 *   RGBA 透明链由 6:180 跟型自动激活,产物=真 Alpha 透明底九宫格。
 * - 指令只写保真段+九格情绪枚举(逐格配五官物理描述——手册 §8「只有情绪名
 *   =无效」纪律);纪律与画风转换/人脸同源:指令即终稿(promptPolicy=raw)、
 *   单段中文、肯定式、无否定式词、比例禁入正文、负面不写;诊断四点 operationId 贯通。
 */

/** 本地直通渠道模型名(与画风转换/人脸同渠道)。 */
export const EXPRESSION_SHEET_MODEL = "qwen-image-2-1";

/** 型层注入的十型真源型名(九宫格版式/透明底/型负面/画幅全由型文承载)。 */
export const EXPRESSION_SHEET_BASE_TYPE = "表情差分";

/**
 * 图生图指令(型层注入路):保真段先行+九格情绪枚举逐格配五官物理描述
 * (手册 §8 纪律——只有情绪名=无效,会滑回沉静默认脸);取景/版式语言
 * 归型层,指令零取景词防与型文双写。
 */
export const EXPRESSION_I2I_INSTRUCTION =
  "保持画中人物的面部身份、五官特征、乌黑长发发型与气质不变；九格情绪按左上至右下点位依次为平静、微笑、大笑、严肃、愤怒、悲伤、惊讶、疑惑、坚毅——平静格双目平和微垂、眉舒展、唇线平直；微笑格眼角弯起、嘴角上扬轻抿、眉梢微挑；大笑格双眼弯起、嘴角张开上扬；严肃格眉峰下压、目光平视、唇线平直；愤怒格剑眉倒竖、怒目圆睁、牙关紧咬嘴角下压；悲伤格眉梢下垂呈八字、眼睑低垂、嘴角下弯；惊讶格眉毛高高挑起、双眼睁大、唇微张；疑惑格一侧眉梢上挑、目光斜视、唇角微撇；坚毅格目光坚定直视、眉宇紧锁、嘴角平直。";

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
      // 型层注入(10-22):i2i 桥带 base_type 切「道劫美术类型」全拼档——
      // 九宫格版式/透明底/型负面归型文,RGBA 跟型自动激活(节点级优先于全局设置)
      extraParams: { base_type: EXPRESSION_SHEET_BASE_TYPE },
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
