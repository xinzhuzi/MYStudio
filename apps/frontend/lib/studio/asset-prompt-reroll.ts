import { aiManager } from "@/lib/ai/ai-manager";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";
import { classifyAssetImageName, asAssetImageTrack } from "./asset-image-kind";
import type { AssetImageKind, StudioAssetKind } from "@/types/studio-assets";
import type { AssetType } from "@/lib/ai/prompt-polisher";
import type { ImageCategory } from "@/lib/media/image-storage";

/**
 * 用此词重掷(B-4,10-25 追加令):以查词/实发终稿弹层解析出的引擎实收正向终稿为
 * 指令,按原路(i2i 带原参考图/原 base_type)再掷一张。
 * - 指令=tEXt 正向终稿逐字(promptPolicy=raw,指令即终稿纪律);
 * - base_type=按原图名归型(注入层在场=原产物有型层注入,faithful 重发;无注入层
 *   的产物如画风转换不发 base_type——但引擎全局默认型兜底开启时仍可能被注入,
 *   属既有全局设置语义,不在此拦截);
 * - seed 不复用:重掷语义=同配方新掷(需复现可在弹层看原 seed 手动重发);
 * - 命名沿「废主图名号」令:原图名_重掷_中文日期(「重掷」非型标记,右最标记
 *   仍=原型号,新产物归原节);
 * - 生成行为=显式参数直发,不触碰任何既有生成路(零侵入)。
 */

/** 本地直通渠道模型名(与表情差分/人脸同渠道)。 */
export const PROMPT_REROLL_MODEL = "qwen-image-2-1";

/** track→落盘目标(与 asset-type-shot TRACK_SAVE_TARGETS 同款三轨映射,本地复刻防跨模块私有导出)。 */
const REROLL_SAVE_TARGETS: Record<"role" | "scene" | "tool", { assetType: AssetType; category: ImageCategory }> = {
  role: { assetType: "character", category: "characters" },
  scene: { assetType: "scene", category: "scenes" },
  tool: { assetType: "prop", category: "props" },
};

export interface AssetPromptRerollTask {
  assetId: string;
  assetName: string;
  /** 资产轨(三轨外拒收)。 */
  assetType: StudioAssetKind;
  /** 原图名(归型+重掷命名基准)。 */
  imageName: string;
  /** tEXt 解析出的正向终稿(引擎实收,逐字重发)。 */
  finalText: string;
  /** 原路:i2i=带参考图重发;t2i=纯文字重发。 */
  routeHint: "i2i" | "t2i";
  /** 原产物 tEXt 是否含注入层(锁层X)——true 才带 base_type faithful 重发。 */
  hasInjectedLayers: boolean;
  /** routeHint="i2i" 必填:原图 url(引擎层统一缩略;asset-file:// 或桥返回形态)。 */
  referenceImageUrl?: string;
  projectId?: string;
  chapterId?: string;
  /** 诊断贯通 id(调用方造;缺省自造兜底)。 */
  operationId?: string;
}

export interface AssetPromptRerollProgress {
  phase: "generating" | "saving" | "done" | "failed";
  message?: string;
  imageLocalPath?: string;
  /** 落库命名(原图名_重掷_中文日期),调用方收编 images[] 用。 */
  resultImageName?: string;
  /** 重掷产物归型(=原图名归型,调用方 kind 落值用)。 */
  resultKind?: AssetImageKind;
  error?: string;
}

export function buildPromptRerollImageName(imageName: string, now = new Date()): string {
  const dateSuffix = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
  return `${imageName}_重掷_${dateSuffix}`;
}

export async function rerollAssetImageFromPromptText(
  task: AssetPromptRerollTask,
  onProgress?: (progress: AssetPromptRerollProgress) => void,
): Promise<AssetPromptRerollProgress> {
  const operationId = task.operationId ?? createOperationId("asset-prompt-reroll");
  const track = asAssetImageTrack(task.assetType);
  const kind = classifyAssetImageName(task.imageName);
  const finalText = task.finalText.trim();
  const resultImageName = buildPromptRerollImageName(task.imageName);
  if (!track) {
    return { phase: "failed", error: "重掷仅角色/场景/道具三轨资产可用" };
  }
  if (!finalText) {
    return { phase: "failed", error: "正向终稿为空,无法重掷" };
  }
  if (task.routeHint === "i2i" && !task.referenceImageUrl) {
    return { phase: "failed", error: "图生图路重掷缺少参考图" };
  }
  void logEvent({
    level: "info",
    category: "ai",
    operationId,
    message: "Asset prompt reroll instruction built",
    context: {
      kind,
      route: task.routeHint,
      baseType: task.hasInjectedLayers ? kind : null,
      chars: finalText.length,
      head: finalText.slice(0, 24),
    },
  });
  let stage: "generating" | "saving" = "generating";
  try {
    onProgress?.({ phase: "generating", message: `正在按原词重掷 ${task.assetName} 的${kind}...` });
    void logEvent({
      level: "info",
      category: "ai",
      operationId,
      message: "Asset prompt reroll generation started",
      context: { model: PROMPT_REROLL_MODEL, assetId: task.assetId, kind, route: task.routeHint },
    });
    const imageResult = await aiManager.generateImage({
      model: PROMPT_REROLL_MODEL,
      // 终稿=tEXt 实收正向串逐字;raw 纪律(传输层禁 normalize 再追加)
      prompt: finalText,
      promptPolicy: "raw",
      ...(task.routeHint === "i2i" ? { referenceImages: [task.referenceImageUrl!] } : {}),
      // faithful 重发:原产物带注入层→按原图名归型重注 base_type(全局默认型
      // 兜底对显式 base_type 无效,不构成污染);无注入层产物不注(画风转换族)
      ...(task.hasInjectedLayers ? { extraParams: { base_type: kind } } : {}),
    });
    if (!imageResult.url) {
      void logEvent({
        level: "error",
        category: "asset",
        operationId,
        message: "Asset prompt reroll failed",
        context: { stage, kind, assetName: task.assetName, reason: "no-url" },
      });
      return { phase: "failed", error: "图片生成未返回 URL" };
    }
    stage = "saving";
    onProgress?.({ phase: "saving", message: `正在保存 ${task.assetName} 的重掷产物...` });
    const saveTarget = REROLL_SAVE_TARGETS[track];
    const localPath = await saveGeneratedAssetImage({
      source: imageResult.url,
      assetType: saveTarget.assetType,
      assetId: task.assetId,
      assetName: task.assetName,
      projectId: task.projectId,
      isDerivative: false,
      chapterId: task.chapterId,
      category: saveTarget.category,
    });
    updateStoreWithResult(task.assetId, saveTarget.assetType, { imageLocalPath: localPath });
    void logEvent({
      level: "info",
      category: "asset",
      operationId,
      message: "Asset prompt reroll image saved",
      context: { assetId: task.assetId, assetName: task.assetName, imageLocalPath: localPath },
    });
    return { phase: "done", imageLocalPath: localPath, resultImageName, resultKind: kind };
  } catch (err: unknown) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Asset prompt reroll failed",
      context: { stage, assetName: task.assetName },
      error: err,
    });
    return { phase: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
