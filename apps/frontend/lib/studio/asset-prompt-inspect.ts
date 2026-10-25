import type { AssetImageKind } from "@/types/studio-assets";
import { classifyAssetImage } from "@/lib/studio/asset-image-kind";

/**
 * 提示词 tEXt 查询纯函数族(10-25-asset-prompt-layered-panel A-2③/B-3):
 * ③实发终稿候选回溯序、B-1 IPC reason→降级文案矩阵、族兄弟产物归属标注。
 * 零 IO/零组件——弹层组件与详情弹窗共用,纯函数可单测。
 */

/** B-1 只读通道失败 reason(electron.d.ts AssetImagePromptTextResult 的窄视图)。 */
export type PromptTextFailReason =
  | "path-rejected"
  | "file-missing"
  | "not-png"
  | "no-texr"
  | "read-failed"
  | "oversize";

/** 桥缺席(非桌面/旧 preload):非 B-1 reason 域,单列标签。 */
export const PROMPT_TEXT_BRIDGE_MISSING_LABEL = "当前环境不支持读取提示词元数据";

/**
 * 降级文案矩阵(PRD §4.4 全路径,禁编造):
 * - no-texr(实证 1/32)→「该图无提示词元数据」
 * - not-png(JPEG/其他格式)→「仅引擎 PNG 产物携带提示词元数据」
 * - file-missing(断链/被移)→「原图文件不可读」;path-rejected(受管根外)/
 *   read-failed(结构损坏)对用户同为「读不到原图」,并轨同文案
 * - oversize(超 256KB 护栏)→ 如实标超限
 */
export const PROMPT_TEXT_DEGRADATION_LABELS: Record<PromptTextFailReason, string> = {
  "no-texr": "该图无提示词元数据",
  "not-png": "仅引擎 PNG 产物携带提示词元数据",
  "file-missing": "原图文件不可读",
  "path-rejected": "原图文件不可读",
  "read-failed": "原图文件不可读",
  oversize: "提示词元数据超出读取上限",
};

/** 查词/实发终稿弹层的产物候选(展示序条目的窄投影;assetId/assetName 供族兄弟标注)。 */
export interface PromptInspectCandidate {
  filePath: string;
  imageName: string;
  assetId?: string;
  assetName?: string;
}

/**
 * ③实发终稿候选序(PRD §4.1 A-2③):displayImages(族聚显口径,与用户所见一致)
 * 按 classifyAssetImage 归型 → focusKind 组,数组序**最后一张为首位**(数组序=append
 * 序,尾部=最新),向前回溯排列——调用方依序读 tEXt,首个 ok 即「该型最近实发」。
 * 空文件路径条目不可读,滤除;组空返回空数组(调用方按「该型尚无产物」置灰)。
 */
export function buildFinalDraftCandidates<
  T extends { name: string; filePath: string; kind?: AssetImageKind; assetId?: string; assetName?: string },
>(images: T[], kind: AssetImageKind): PromptInspectCandidate[] {
  return images
    .filter((image) => image.filePath && classifyAssetImage(image) === kind)
    .map((image) => ({
      filePath: image.filePath,
      imageName: image.name,
      assetId: image.assetId,
      assetName: image.assetName,
    }))
    .reverse();
}

/**
 * 族兄弟归属标注(§4.4 矩阵行「族兄弟图:正常查词+标注『来自同族资产 {名}』」):
 * 条目带 assetId 且 ≠当前资产 → 标注;名缺(旧数据路径防御位)只标「来自同族资产」;
 * 本行条目/无归属信息 → null(不标注)。
 */
export function resolvePromptOwnerNote(
  candidate: Pick<PromptInspectCandidate, "assetId" | "assetName">,
  currentAssetId: string | undefined,
): string | null {
  if (!candidate.assetId || !currentAssetId || candidate.assetId === currentAssetId) {
    return null;
  }
  return candidate.assetName ? `来自同族资产 ${candidate.assetName}` : "来自同族资产";
}
