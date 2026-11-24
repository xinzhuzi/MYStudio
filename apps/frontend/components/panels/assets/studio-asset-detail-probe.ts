/**
 * 实发终稿探针(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * displayImages 按 focusKind 组回溯读 tEXt,状态机 idle/no-products/probing/
 * unreadable/bridge-missing/ready。逻辑零改动。
 */
import { useEffect, useState } from "react";
import type { AssetImageKind } from "@/types/studio-assets";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { buildFinalDraftCandidates } from "@/lib/studio/asset-prompt-inspect";
import type { FamilyDisplayImageEntry } from "@/lib/studio/asset-family-images";
import type { FinalDraftProbe } from "./studio-asset-detail-helpers";

export function useFinalDraftProbe({
  focusKind,
  displayImages,
}: {
  focusKind: AssetImageKind | null;
  displayImages: FamilyDisplayImageEntry[];
}) {
  const [finalDraftProbe, setFinalDraftProbe] = useState<FinalDraftProbe>({ status: "idle" });
  // ③ 实发终稿探针(10-25 分层面板役 A-2③,PRD §4.1 算法):displayImages(族聚显
  // 口径,与用户所见一致)按 classifyAssetImage 归型→focusKind 组最后一张(数组序)
  // 起向前回溯,读原图 tEXt(B-1 只读通道)首个 ok 即「该型最近实发」;组内全无
  // tEXt→unreadable;无产物→no-products;无聚焦→idle——按钮按此置灰注明。
  // 生成完成 displayImages 变更即重探(新产物自动成为候选)。竞态用 cancelled 旗
  // 防旧轮探针覆写新一轮结果。
  useEffect(() => {
    if (!focusKind) {
      setFinalDraftProbe({ status: "idle" });
      return;
    }
    const candidates = buildFinalDraftCandidates(displayImages, focusKind);
    if (candidates.length === 0) {
      setFinalDraftProbe({ status: "no-products" });
      return;
    }
    const bridge = getStudioAssetsBridge();
    if (!bridge?.readImagePromptText) {
      setFinalDraftProbe({ status: "bridge-missing" });
      return;
    }
    let cancelled = false;
    setFinalDraftProbe({ status: "probing" });
    void (async () => {
      for (const candidate of candidates) {
        try {
          const result = await bridge.readImagePromptText!({ filePath: candidate.filePath });
          if (cancelled) return;
          if (result.ok) {
            setFinalDraftProbe({ status: "ready", candidate });
            return;
          }
        } catch {
          // 单张读取异常按无 tEXt 续走回溯(下一张同型产物)
        }
      }
      if (!cancelled) setFinalDraftProbe({ status: "unreadable" });
    })();
    return () => {
      cancelled = true;
    };
  }, [focusKind, displayImages]);

  return { finalDraftProbe, setFinalDraftProbe };
}
