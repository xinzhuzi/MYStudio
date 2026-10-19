import { aiManager } from "@/lib/ai/ai-manager";
import type { AssetType } from "@/lib/ai/prompt-polisher";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import type { ImageCategory } from "@/lib/media/image-storage";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";

/**
 * 道劫资产详情图生图·画风转换 service(10-19-daojie-ui-i2i-style-convert)。
 *
 * 与 generateAsset(润色→道劫编译→生成)分道:画风转换指令为固定式三轨变体,
 * 不走润色/道劫编译链——美术风格底座由 qwen21 引擎 i2i 工作流装配层自动追加
 * (组装用途=画风转换,装配产物=主体句+\n+锁层A全文),槽内禁复写底座画法词
 * (09 篇 :50 禁双写)。经 aiManager.generateImage 直通本地 sidecar
 * (LOCAL_IMAGE_MODELS 已含 qwen-image-2-1,零 provider 改动);参考图由引擎层
 * prepareReferenceImagesForTransfer 统一过 ≤768px/<1MB 缩略与 readUrlDataUrl
 * 去 canvas 污染,调用方只传 url。
 */

/** 本地直通渠道模型名(1010「只留 qwen-image-2-1」渠道裁定,不新增模型名)。 */
export const STYLE_TRANSFER_MODEL = "qwen-image-2-1";

/**
 * 主体句槽注入文本(提示词终稿,差异仅在首段保真主语)。
 * 纪律自检:保真段先行+操作段收束(1015 定谳两式并存,本役取保真先行);
 * 身份指图不描字;未点名内容一句话保留;单段中文无换行;肯定式无 hedge、
 * 无否定式词(i2i 路走 Assembly 否定式门);比例禁入正文;负面不写(cfg=1)。
 */
const STYLE_TRANSFER_INSTRUCTIONS: Record<AssetType, string> = {
  character:
    "保持画中人物的身份、姿态与构图不变,画面全部内容与元素位置原样保留;在此前提下,将整幅画面的绘画风格整体转换为美术风格底座所定的画风。",
  scene:
    "保持画中场景的空间结构与构图不变,画面全部内容与元素位置原样保留;在此前提下,将整幅画面的绘画风格整体转换为美术风格底座所定的画风。",
  prop:
    "保持画中道具的形态与构图不变,画面全部内容与元素位置原样保留;在此前提下,将整幅画面的绘画风格整体转换为美术风格底座所定的画风。",
};

/** 画风转换指令构造器(单一真源,三轨变体)。 */
export function buildDaojieStyleTransferInstruction(assetType: AssetType): string {
  return STYLE_TRANSFER_INSTRUCTIONS[assetType];
}

export interface AssetStyleTransferTask {
  assetId: string;
  assetType: AssetType;
  assetName: string;
  /** 轮播当前图 url(唯一参考;引擎层统一缩略/去 canvas 污染)。 */
  referenceImage: string;
  projectId?: string;
  chapterId?: string;
  isDerivative?: boolean;
  /** 诊断贯通 id(调用方 handleImageToImageStyle 造;缺省自造兜底,事件链恒有 operationId)。 */
  operationId?: string;
}

export interface AssetStyleTransferProgress {
  phase: "generating" | "saving" | "done" | "failed";
  message?: string;
  imageLocalPath?: string;
  error?: string;
}

const CATEGORY_BY_ASSET_TYPE: Record<AssetType, ImageCategory> = {
  character: "characters",
  scene: "scenes",
  prop: "props",
};

/**
 * 画风转换生成:固定式指令 → qwen-image-2-1 本地渠道直通(单参考)
 * → 复用 saveGeneratedAssetImage 落盘 + updateStoreWithResult 写回。
 * 异常透传为 {phase:"failed", error}(禁静默);成功返回落盘本地路径。
 */
export async function generateAssetStyleTransferImage(
  task: AssetStyleTransferTask,
  onProgress?: (progress: AssetStyleTransferProgress) => void,
): Promise<AssetStyleTransferProgress> {
  const operationId = task.operationId ?? createOperationId("asset-style-transfer");
  const prompt = buildDaojieStyleTransferInstruction(task.assetType);
  // 诊断打点(10-19 用户令:图生图链路要日志;共享生成通道自带的打点之外,
  // 本层按 orchestrator createOperationId+logEvent 惯例补四点,operationId 贯通)
  void logEvent({
    level: "info",
    category: "ai",
    operationId,
    message: "Daojie style-transfer instruction built",
    context: { assetType: task.assetType, chars: prompt.length, head: prompt.slice(0, 24) },
  });
  let stage: "generating" | "saving" = "generating";
  try {
    onProgress?.({ phase: "generating", message: `正在转换 ${task.assetName} 的画风...` });
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Asset style transfer generation started",
      context: {
        model: STYLE_TRANSFER_MODEL,
        assetId: task.assetId,
        assetName: task.assetName,
        referenceImage: task.referenceImage.slice(0, 120),
      },
    });
    const imageResult = await aiManager.generateImage({
      model: STYLE_TRANSFER_MODEL,
      prompt,
      // 指令即终稿(道劫编译产物同款纪律,先例 asset-generation-orchestrator.ts:212-214):
      // raw=传输层禁 normalize 再追加——否则 CLEAN_IMAGE_PROMPT_TERMS 六条英文清洗词
      // 会被拼进主体句槽发往引擎绑入 [400],终稿静默漂移(装配层否定式门只查中文,
      // 英文词条静默放行)。单段中文指令+底座由工作流装配层追加,槽内一字符不可增。
      promptPolicy: "raw",
      referenceImages: [task.referenceImage],
    });
    if (!imageResult.url) {
      void logEvent({
        level: "error",
        category: "asset",
        operationId,
        message: "Asset style transfer failed",
        context: { stage, assetType: task.assetType, assetName: task.assetName, reason: "no-url" },
      });
      return { phase: "failed", error: "图片生成未返回 URL" };
    }
    stage = "saving";
    onProgress?.({ phase: "saving", message: `正在保存 ${task.assetName} 的画风转换图...` });
    const localPath = await saveGeneratedAssetImage({
      source: imageResult.url,
      assetType: task.assetType,
      assetId: task.assetId,
      assetName: task.assetName,
      projectId: task.projectId,
      isDerivative: task.isDerivative ?? false,
      chapterId: task.chapterId,
      category: CATEGORY_BY_ASSET_TYPE[task.assetType],
    });
    updateStoreWithResult(task.assetId, task.assetType, { imageLocalPath: localPath });
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset style transfer image saved",
      context: { assetId: task.assetId, assetName: task.assetName, imageLocalPath: localPath },
    });
    return { phase: "done", imageLocalPath: localPath };
  } catch (err: unknown) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Asset style transfer failed",
      context: { stage, assetType: task.assetType, assetName: task.assetName },
      error: err,
    });
    return {
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
